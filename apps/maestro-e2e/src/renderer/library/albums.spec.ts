import { expect, test, type Page } from '@playwright/test'
import type { QueryAlbumsRequest, QuerySongsRequest } from '@release-maestro/core'
import {
    createAlbumDetail,
    createAlbumRow,
    createAlbumRows,
    createRendererScenario,
    createSongRow,
    rendererScenarios,
    scenarioBuilder,
    type RendererScenarioController,
} from '../scenario-harness'

/**
 * The albums grid and the album detail page against mocked IPC.
 *
 * As with the track list, these tests assert two different things: what the page
 * *renders* from a window it was handed, and what it *asks for* when the user sorts,
 * filters, searches or scrolls. Only the second is the real contract with the read side.
 *
 * The grid's own contribution over the table is geometry — the column count is measured
 * rather than declared, so the row height and every scroll calculation depend on the
 * viewport. Tests that care about that derive their expectations from the measured
 * layout rather than hard-coding a column count that a different window size would break.
 */

const openAlbums = (page: Page, scenario = rendererScenarios.albums.withAlbums()) =>
    createRendererScenario(page, scenario, '/albums')

const lastQuery = async (controller: RendererScenarioController): Promise<QueryAlbumsRequest | undefined> => {
    const call = await controller.lastCall('library:query-albums')
    return call?.payload as QueryAlbumsRequest | undefined
}

const lastSongQuery = async (
    controller: RendererScenarioController,
): Promise<QuerySongsRequest | undefined> => {
    const call = await controller.lastCall('library:query-songs')
    return call?.payload as QuerySongsRequest | undefined
}

const grid = (page: Page) => page.getByRole('grid', { name: 'Albums' })
const tile = (page: Page, name: string) => page.getByRole('link', { name: new RegExp(`^${name}`) })

/** Narrowest a tile may be before the grid drops a column — `MIN_TILE_WIDTH` in the component. */
const MIN_TILE_WIDTH = 156

const tileWidth = (page: Page) =>
    grid(page).evaluate(
        element =>
            element.querySelector<HTMLElement>('[role="gridcell"]')?.getBoundingClientRect().width ?? 0,
    )

/**
 * Each track row as `[title, track number]`, in render order.
 *
 * Read off the cells rather than the row's `aria-label`, which carries the title and the
 * artist and not the number — so the pairing is what the user actually sees lined up.
 */
const trackNumbersByTitle = (page: Page): Promise<[string, string][]> =>
    page
        .getByRole('grid', { name: 'Tracks' })
        .evaluate(element =>
            [...element.querySelectorAll('[role="row"][aria-selected]')].map(row => [
                row.querySelector('.song-table__title')?.textContent?.trim() ?? '',
                row.querySelector('.song-table__track-number')?.textContent?.trim() ?? '',
            ]),
        ) as Promise<[string, string][]>

/** One row of tiles plus the gap beneath it — the step every scroll calculation takes. */
const rowPitchOf = (page: Page) =>
    grid(page).evaluate(element => {
        const [first, second] = element.querySelectorAll<HTMLElement>('[role="row"]')
        if (!first || !second) return 0
        return second.getBoundingClientRect().top - first.getBoundingClientRect().top
    })

test.describe('rendering a window', () => {
    test('shows the albums in the window and the total of the whole library', async ({ page }) => {
        await openAlbums(page, scenarioBuilder().albums(createAlbumRows(), { total: 428 }).build())

        await expect(grid(page)).toBeVisible()
        await expect(
            page.getByRole('status', { name: 'Result count' }).filter({ hasText: '428 albums' }),
        ).toBeVisible()
        await expect(tile(page, 'Daybreak')).toBeVisible()
        await expect(tile(page, 'Afterglow')).toBeVisible()
    })

    test('names a tile for assistive tech with its artist, year and track count', async ({ page }) => {
        await openAlbums(page)

        await expect(
            page.getByRole('link', { name: 'Daybreak by Aurora Fields, 2019, 9 tracks' }),
        ).toBeVisible()
    })

    test('says "1 track" rather than "1 tracks"', async ({ page }) => {
        await openAlbums(
            page,
            scenarioBuilder()
                .albums([createAlbumRow({ trackCount: 1 })])
                .build(),
        )

        await expect(page.getByRole('link', { name: /1 track$/ })).toBeVisible()
    })

    test('renders an album with no artist, year or label rather than dropping the tile', async ({ page }) => {
        await openAlbums(page)

        // The dash stands in for the album artist; the meta line falls back to the count.
        const bare = tile(page, 'Untitled Tape')
        await expect(bare).toBeVisible()
        await expect(bare.getByText('—')).toBeVisible()
    })

    test('sizes the scrollbar from the total, not from the tiles it was given', async ({ page }) => {
        await openAlbums(page, scenarioBuilder().albums(createAlbumRows(), { total: 5_000 }).build())

        const { scrollHeight, clientHeight } = await grid(page).evaluate(element => ({
            scrollHeight: element.scrollHeight,
            clientHeight: element.clientHeight,
        }))

        // Far taller than one row of tiles — the spacer accounts for all 5,000.
        expect(scrollHeight).toBeGreaterThan(clientHeight * 10)
    })
})

/**
 * What the grid does between being created and standing still.
 *
 * The grid is measured rather than declared, and it is created by the shell only once a
 * window has landed — so there is a moment where it exists, has been handed rows, and
 * does not yet know how wide it is. Everything here is about that moment: it used to be
 * visible as a screen of full-width covers, then a single row, then the real grid.
 *
 * These assert over *every frame*, not the settled state, because the settled state was
 * always right.
 */
test.describe('the first paint', () => {
    /**
     * Record every distinct shape the grid is drawn in, from before it exists.
     *
     * Installed as an init script so it is running before the page has navigated;
     * `createRendererScenario` adds its own and then navigates, so this has to come first.
     */
    const recordPaints = (page: Page) =>
        page.addInitScript(() => {
            const paints: GridPaint[] = []
            ;(window as WindowWithPaints).__gridPaints = paints

            const measurePaint = (): GridPaint | null => {
                const element = document.querySelector('[role="grid"]')
                if (!element) return null

                const rows = element.querySelectorAll<HTMLElement>('[role="row"]')
                const first = rows[0]
                if (!first) return null

                return {
                    rows: rows.length,
                    columns: getComputedStyle(first).gridTemplateColumns.split(' ').length,
                    tiles: element.querySelectorAll('[role="gridcell"]').length,
                    rowHeight: first.getBoundingClientRect().height,
                    viewportHeight: element.clientHeight,
                }
            }

            const samePaint = (left: GridPaint | undefined, right: GridPaint) =>
                left != null &&
                (Object.keys(right) as (keyof GridPaint)[]).every(key => left[key] == right[key])

            const sample = () => {
                const paint = measurePaint()
                if (paint && !samePaint(paints.at(-1), paint)) paints.push(paint)
                requestAnimationFrame(sample)
            }
            requestAnimationFrame(sample)
        })

    const paintsOf = (page: Page): Promise<GridPaint[]> =>
        page.evaluate(() => (window as WindowWithPaints).__gridPaints ?? [])

    test('is at the measured column count, never at the placeholder geometry', async ({ page }) => {
        // The grid opens against a one-column placeholder so the scroll maths never
        // divides by zero. Drawing anything against it puts one enormous cover per row on
        // screen for a frame or two, which is what this catches.
        await page.setViewportSize({ width: 1600, height: 1000 })
        await recordPaints(page)
        await openAlbums(page, scenarioBuilder().albumCatalog(page, 2_000).build())
        await expect(tile(page, 'Album 0')).toBeVisible()

        const paints = await paintsOf(page)
        const settledColumns = Number(await grid(page).getAttribute('aria-colcount'))

        expect(settledColumns).toBeGreaterThan(1)
        expect(paints.length).toBeGreaterThan(0)
        expect(paints.map(paint => paint.columns)).toEqual(paints.map(() => settledColumns))
    })

    test('arrives full, rather than filling the viewport a few rows at a time', async ({ page }) => {
        // The window the page opens with is sized to the browser window, so the rows the
        // grid is handed already cover the screen when it first draws them. A fixed guess
        // covers a small display and fills a large one in two waves.
        await page.setViewportSize({ width: 1600, height: 1000 })
        await recordPaints(page)
        await openAlbums(page, scenarioBuilder().albumCatalog(page, 2_000).build())
        await expect(tile(page, 'Album 0')).toBeVisible()

        const paints = await paintsOf(page)
        const fillsTheViewport = paints.map(paint => paint.rows * paint.rowHeight >= paint.viewportHeight)

        expect(paints.length).toBeGreaterThan(0)
        expect(fillsTheViewport).toEqual(paints.map(() => true))
    })

    test('asks for nothing until it knows its own geometry', async ({ page }) => {
        // A window computed against the placeholder is a screenful of a one-column grid —
        // a handful of albums — and it *replaces* the one the page opened with. That is
        // what left a single row of tiles on screen with empty space below it.
        await page.setViewportSize({ width: 1600, height: 1000 })
        const controller = await openAlbums(page, scenarioBuilder().albumCatalog(page, 2_000).build())
        await expect(tile(page, 'Album 0')).toBeVisible()

        const columns = Number(await grid(page).getAttribute('aria-colcount'))
        const pitch = await rowPitchOf(page)
        const visibleRows = Math.ceil((await grid(page).evaluate(element => element.clientHeight)) / pitch)

        const limits = (await controller.calls('library:query-albums')).map(
            call => (call.payload as QueryAlbumsRequest).window.limit,
        )

        expect(limits.length).toBeGreaterThan(0)
        for (const limit of limits) expect(limit).toBeGreaterThanOrEqual(columns * visibleRows)
    })
})

interface GridPaint {
    rows: number
    columns: number
    tiles: number
    rowHeight: number
    viewportHeight: number
}

type WindowWithPaints = typeof globalThis & { __gridPaints?: GridPaint[] }

test.describe('sorting', () => {
    test('asks the read side for the chosen column, and puts it in the URL', async ({ page }) => {
        const controller = await openAlbums(page)

        await page.getByLabel('Sort by').selectOption('year')

        await expect.poll(async () => (await lastQuery(controller))?.query.sort.field).toBe('year')
        expect(new URL(page.url()).searchParams.get('sort')).toBe('year')
    })

    test('starts a year sort at the newest, because that is what someone clicking it wants', async ({
        page,
    }) => {
        const controller = await openAlbums(page)

        await page.getByLabel('Sort by').selectOption('year')

        await expect.poll(async () => (await lastQuery(controller))?.query.sort.direction).toBe('desc')
    })

    test('starts a title sort A–Z', async ({ page }) => {
        const controller = await openAlbums(page, scenarioBuilder().albums(createAlbumRows()).build())

        await page.getByLabel('Sort by').selectOption('year')
        await expect.poll(async () => (await lastQuery(controller))?.query.sort.field).toBe('year')
        await page.getByLabel('Sort by').selectOption('title')

        await expect.poll(async () => (await lastQuery(controller))?.query.sort.direction).toBe('asc')
    })

    test('opens on the newest additions, without saying so in the URL', async ({ page }) => {
        const controller = await openAlbums(page)

        await expect
            .poll(async () => (await lastQuery(controller))?.query.sort)
            .toEqual({ field: 'dateAdded', direction: 'desc' })
        await expect(page.getByLabel('Sort by')).toHaveValue('dateAdded')
        // A default is not state to carry — a bare `/albums` and the URL the page sits
        // on afterwards have to be the same link.
        expect(new URL(page.url()).searchParams.get('sort')).toBeNull()
        expect(new URL(page.url()).searchParams.get('dir')).toBeNull()
    })

    test('the direction toggle flips the current sort', async ({ page }) => {
        const controller = await openAlbums(page)

        await page.getByRole('button', { name: /^Sorted descending/ }).click()

        await expect.poll(async () => (await lastQuery(controller))?.query.sort.direction).toBe('asc')
        await expect(page.getByRole('button', { name: /^Sorted ascending/ })).toBeVisible()
    })

    test('restores the sort from the URL, so a shared link opens the same order', async ({ page }) => {
        const controller = await createRendererScenario(
            page,
            rendererScenarios.albums.withAlbums(),
            '/albums?sort=recordLabel&dir=desc',
        )

        await expect
            .poll(async () => (await lastQuery(controller))?.query.sort)
            .toEqual({
                field: 'recordLabel',
                direction: 'desc',
            })
        await expect(page.getByLabel('Sort by')).toHaveValue('recordLabel')
    })
})

test.describe('search', () => {
    test('sends a settled term to the read side and writes it to the URL', async ({ page }) => {
        const controller = await openAlbums(page)

        await page.getByRole('searchbox', { name: 'Search albums' }).fill('untrue')

        await expect.poll(async () => (await lastQuery(controller))?.query.search).toBe('untrue')
        expect(new URL(page.url()).searchParams.get('q')).toBe('untrue')
    })

    test('costs one query for a word rather than one per keystroke', async ({ page }) => {
        const controller = await openAlbums(page)
        await expect
            .poll(async () => (await controller.calls('library:query-albums')).length)
            .toBeGreaterThan(0)
        const before = (await controller.calls('library:query-albums')).length

        await page.getByRole('searchbox', { name: 'Search albums' }).pressSequentially('hyperdub')

        await expect.poll(async () => (await lastQuery(controller))?.query.search).toBe('hyperdub')
        const after = (await controller.calls('library:query-albums')).length
        // Eight keystrokes, nowhere near eight queries.
        expect(after - before).toBeLessThan(5)
    })
})

test.describe('filtering by entity', () => {
    test('applies a filter from the URL and names its chip', async ({ page }) => {
        const scenario = scenarioBuilder()
            .albums(createAlbumRows())
            .albumFilterDescription({ recordLabels: [{ id: 'label-2', name: 'Hardwire' }] })
            .build()
        const controller = await createRendererScenario(page, scenario, '/albums?recordLabel=label-2')

        await expect
            .poll(async () => (await lastQuery(controller))?.query.filter.recordLabelIds)
            .toEqual(['label-2'])
        await expect(page.getByRole('button', { name: 'Remove Record label filter Hardwire' })).toBeVisible()
    })

    test('removing a chip drops that id from the query', async ({ page }) => {
        const scenario = scenarioBuilder()
            .albums(createAlbumRows())
            .albumFilterDescription({ albumArtists: [{ id: 'artist-2', name: 'Night Cartel' }] })
            .build()
        const controller = await createRendererScenario(page, scenario, '/albums?albumArtist=artist-2')

        await page.getByRole('button', { name: 'Remove Album artist filter Night Cartel' }).click()

        await expect
            .poll(async () => (await lastQuery(controller))?.query.filter.albumArtistIds)
            .toBeUndefined()
    })

    test('resolves the filter names once, not on every window', async ({ page }) => {
        const controller = await createRendererScenario(
            page,
            rendererScenarios.albums.withAlbums(),
            '/albums?albumArtist=artist-2',
        )
        await expect
            .poll(async () => (await controller.calls('library:describe-album-filter')).length)
            .toBe(1)

        await page.getByLabel('Sort by').selectOption('year')
        await expect.poll(async () => (await lastQuery(controller))?.query.sort.field).toBe('year')

        expect(await controller.calls('library:describe-album-filter')).toHaveLength(1)
    })

    test('still renders the grid when the filter names cannot be resolved', async ({ page }) => {
        const scenario = scenarioBuilder()
            .albums(createAlbumRows())
            .handler('library:describe-album-filter', {
                kind: 'reject',
                message: 'Backend failed to describe the filter',
            })
            .build()
        await createRendererScenario(page, scenario, '/albums?albumArtist=artist-2')

        await expect(tile(page, 'Daybreak')).toBeVisible()
        // Unnamed, but not inescapable — the filter is still applied to the query.
        await expect(page.getByRole('button', { name: 'Clear all' })).toBeVisible()
    })
})

test.describe('virtual scrolling', () => {
    test('asks for a later window as the viewport moves down', async ({ page }) => {
        const controller = await openAlbums(
            page,
            scenarioBuilder().albums(createAlbumRows(), { total: 20_000 }).build(),
        )
        await expect(tile(page, 'Daybreak')).toBeVisible()

        await grid(page).evaluate(element => element.scrollTo({ top: element.scrollHeight / 2 }))

        await expect.poll(async () => (await lastQuery(controller))?.window.offset).toBeGreaterThan(1_000)
    })

    test('asks for whole rows of tiles, so the loaded block lines up with the grid', async ({ page }) => {
        // The offset has to be a multiple of the column count. The window is positioned
        // by whole rows, so one starting mid-row would draw its first tiles in the wrong
        // column and shift every tile after them.
        const controller = await openAlbums(
            page,
            scenarioBuilder().albums(createAlbumRows(), { total: 20_000 }).build(),
        )
        await expect(tile(page, 'Daybreak')).toBeVisible()

        await grid(page).evaluate(element => element.scrollTo({ top: element.scrollHeight / 3 }))
        await expect.poll(async () => (await lastQuery(controller))?.window.offset).toBeGreaterThan(0)

        const columns = Number(await grid(page).getAttribute('aria-colcount'))
        const offset = (await lastQuery(controller))?.window.offset ?? 0
        expect(columns).toBeGreaterThan(0)
        expect(offset % columns).toBe(0)
    })

    test('renders the tiles the scroll position actually lands on', async ({ page }) => {
        const controller = await openAlbums(page, scenarioBuilder().albumCatalog(page, 10_000).build())
        await expect(tile(page, 'Album 0')).toBeVisible()

        const columns = Number(await grid(page).getAttribute('aria-colcount'))
        // The pitch, not a row's height: the gap between rows sits between them rather
        // than inside them, so one row is a tile tall and the next starts a gap later.
        const rowPitch = await rowPitchOf(page)
        expect(rowPitch).toBeGreaterThan(0)

        await grid(page).evaluate(top => window.scrollTo(0, 0) ?? top, 0)
        await grid(page).evaluate(
            (element, offsetTop) => element.scrollTo({ top: offsetTop }),
            rowPitch * 100,
        )

        // Row 100 holds albums `100 * columns` onwards — the tile the maths says is there.
        await expect(tile(page, `Album ${100 * columns}`)).toBeVisible()
        await expect(controller.lastCall('library:query-albums')).resolves.toBeDefined()
    })

    test('replaces the window rather than accumulating it, however far you scroll', async ({ page }) => {
        // The memory claim behind ADR 0004: the renderer holds one window, not the library.
        await openAlbums(page, scenarioBuilder().albumCatalog(page, 200_000).build())
        const tiles = page.locator('[role="gridcell"]')
        await expect(tiles.first()).toBeVisible()
        const initial = await tiles.count()

        for (const fraction of [0.2, 0.4, 0.6, 0.8]) {
            await grid(page).evaluate(
                (element, part) => element.scrollTo({ top: element.scrollHeight * part }),
                fraction,
            )
            await expect(tiles.first()).toBeVisible()
        }

        expect(await tiles.count()).toBeLessThanOrEqual(initial * 2)
    })

    test('re-measures its columns when the window is resized', async ({ page }) => {
        const controller = await openAlbums(
            page,
            scenarioBuilder().albums(createAlbumRows(), { total: 20_000 }).build(),
        )
        await expect(tile(page, 'Daybreak')).toBeVisible()
        const wideColumns = Number(await grid(page).getAttribute('aria-colcount'))

        await page.setViewportSize({ width: 520, height: 720 })

        await expect
            .poll(async () => Number(await grid(page).getAttribute('aria-colcount')))
            .toBeLessThan(wideColumns)
        // And the window it asks for follows the new geometry.
        await expect.poll(async () => (await lastQuery(controller))?.window.limit).toBeGreaterThan(0)
    })

    test('drops a column rather than letting the tiles shrink past their minimum', async ({ page }) => {
        // The measured column count and the CSS track both carry the minimum, so a
        // measurement that has not landed yet cannot silently shrink every tile — which
        // is what a grid that has stopped re-measuring looks like.
        await openAlbums(page, scenarioBuilder().albumCatalog(page, 2_000).build())
        await expect(tile(page, 'Album 0')).toBeVisible()

        for (const width of [1360, 940, 1180, 760, 1040, 620, 1440]) {
            await page.setViewportSize({ width, height: 720 })
            await expect.poll(() => tileWidth(page)).toBeGreaterThanOrEqual(MIN_TILE_WIDTH)
        }
    })

    test('leaves a gap between one row of tiles and the next', async ({ page }) => {
        // The row is exactly as tall as the tile in it and the gap sits between rows. A
        // row as tall as the whole pitch would hand the gap to the tile to fill, and the
        // covers would run into each other down the grid.
        await openAlbums(page, scenarioBuilder().albumCatalog(page, 2_000).build())
        await expect(tile(page, 'Album 0')).toBeVisible()

        const pitch = await rowPitchOf(page)
        const rowHeight = await grid(page).evaluate(
            element =>
                element.querySelector<HTMLElement>('[role="row"]')?.getBoundingClientRect().height ?? 0,
        )

        expect(rowHeight).toBeGreaterThan(0)
        expect(pitch - rowHeight).toBeGreaterThan(8)
    })
})

test.describe('keyboard', () => {
    /**
     * The index of the tile that actually has DOM focus.
     *
     * The grid uses a roving tabindex with real focus rather than
     * `aria-activedescendant`, which is what lets a tile be a plain link — so "where am
     * I" is a question for the document, and asserting it here is asserting the thing
     * Enter and cmd-click depend on.
     */
    const focusedIndex = async (page: Page): Promise<number> => {
        const id = await page.locator('a:focus').getAttribute('id')
        return Number(id?.split('-').at(-1))
    }

    /** Put focus on the grid's single tab stop, the way Tab would. */
    const focusFirstTile = async (page: Page) => {
        await page.locator('[role="gridcell"] a[tabindex="0"]').focus()
        await expect(page.locator('a:focus')).toHaveCount(1)
    }

    test('is one tab stop, with the arrows moving between tiles', async ({ page }) => {
        await openAlbums(page, scenarioBuilder().albumCatalog(page, 500).build())
        await expect(tile(page, 'Album 0')).toBeVisible()

        // One tab stop for the whole grid, not one per rendered tile.
        await expect(page.locator('[role="gridcell"] a[tabindex="0"]')).toHaveCount(1)

        await focusFirstTile(page)
        const before = await focusedIndex(page)
        await page.keyboard.press('ArrowRight')

        expect(await focusedIndex(page)).toBe(before + 1)
    })

    test('moves a whole row on the vertical arrows', async ({ page }) => {
        await openAlbums(page, scenarioBuilder().albumCatalog(page, 500).build())
        await expect(tile(page, 'Album 0')).toBeVisible()
        const columns = Number(await grid(page).getAttribute('aria-colcount'))

        await focusFirstTile(page)
        const before = await focusedIndex(page)
        await page.keyboard.press('ArrowDown')

        expect(await focusedIndex(page)).toBe(before + columns)
    })

    test('opens the focused album on Enter, because a tile is a link', async ({ page }) => {
        const scenario = scenarioBuilder().albumCatalog(page, 500).albumDetail(createAlbumDetail()).build()
        await openAlbums(page, scenario)
        await expect(tile(page, 'Album 0')).toBeVisible()

        await focusFirstTile(page)
        const focused = await focusedIndex(page)
        await page.keyboard.press('Enter')

        await expect.poll(() => new URL(page.url()).pathname).toBe(`/albums/album-${focused}`)
    })

    test('keeps a tab stop after the focused tile scrolls out of the window', async ({ page }) => {
        // Otherwise the grid's only tab stop leaves with the tile, and the whole grid
        // becomes unreachable from the keyboard.
        await openAlbums(page, scenarioBuilder().albumCatalog(page, 10_000).build())
        await expect(tile(page, 'Album 0')).toBeVisible()
        await focusFirstTile(page)

        await grid(page).evaluate(element => element.scrollTo({ top: element.scrollHeight / 2 }))
        await expect(tile(page, 'Album 0')).toBeHidden()

        await expect(page.locator('[role="gridcell"] a[tabindex="0"]')).toHaveCount(1)
    })
})

test.describe('loading, empty and error states', () => {
    test('says it is loading before the first window lands', async ({ page }) => {
        await openAlbums(page, rendererScenarios.albums.loadPending())

        await expect(page.getByText('Loading albums…')).toBeVisible()
    })

    test('distinguishes an empty library from a filter that matches nothing', async ({ page }) => {
        await openAlbums(page, rendererScenarios.albums.empty())

        await expect(page.getByText('No albums yet')).toBeVisible()
    })

    test('offers a way out when a filter matches nothing', async ({ page }) => {
        await createRendererScenario(page, scenarioBuilder().albums([]).build(), '/albums?q=nothing')

        await expect(page.getByText('No albums match these filters')).toBeVisible()
        await page.getByRole('button', { name: 'Clear filters' }).click()

        await expect.poll(() => new URL(page.url()).searchParams.get('q')).toBeNull()
    })

    test('surfaces a failure with the reason and a retry', async ({ page }) => {
        const controller = await openAlbums(page, rendererScenarios.albums.loadError())

        await expect(page.getByText('Could not reach the library')).toBeVisible()
        await controller.setHandler('library:query-albums', {
            kind: 'resolve',
            value: { rows: createAlbumRows(), offset: 0, total: 3 },
        })
        await page.getByRole('button', { name: 'Try again' }).click()

        await expect(tile(page, 'Daybreak')).toBeVisible()
    })
})

test.describe('the album detail page', () => {
    const openDetail = (page: Page, scenario = rendererScenarios.albums.detail(), albumId = 'album-1') =>
        createRendererScenario(page, scenario, `/albums/${albumId}`)

    test('shows the album’s own attributes in the header', async ({ page }) => {
        await openDetail(page)

        await expect(page.getByRole('heading', { name: 'Daybreak', level: 1 })).toBeVisible()
        await expect(page.getByText('KOS012')).toBeVisible()
        await expect(page.getByText('2019-03-01')).toBeVisible()
    })

    test('gives the running time in words, not as a timecode', async ({ page }) => {
        // A sum, beside a track count. `10:17` there reads as a position in something
        // playing, and the seconds of a whole record are noise.
        await openDetail(page)

        await expect(page.getByText('10 min')).toBeVisible()
        await expect(page.getByText('10:17')).toHaveCount(0)
    })

    test('shows the tracks in the shared table, asking for them by album', async ({ page }) => {
        const controller = await openDetail(page)

        await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()
        await expect(page.getByRole('row').filter({ hasText: 'Dawn' })).toBeVisible()
        await expect
            .poll(async () => (await lastSongQuery(controller))?.query.filter.albumIds)
            .toEqual(['album-1'])
    })

    test('numbers each track from its own tag, not from where it sits in the list', async ({ page }) => {
        const controller = await openDetail(page)
        await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()

        // The scenario serves Dawn first and tags it track 2, so a page reading positions
        // would show 1 here. Only the tag can produce this.
        await expect(trackNumbersByTitle(page)).resolves.toEqual([
            ['Dawn', '2'],
            ['Noon', '1'],
        ])
        await expect(controller.lastCall('library:query-songs')).resolves.toBeDefined()
    })

    test('marks a track whose file carries no number rather than inventing one', async ({ page }) => {
        const scenario = scenarioBuilder()
            .albumDetail(createAlbumDetail())
            .songs([
                createSongRow({ id: 'song-1', title: 'Dawn', trackNumber: null }),
                createSongRow({ id: 'song-2', title: 'Noon', trackNumber: 2 }),
            ])
            .build()
        await openDetail(page, scenario)
        await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()

        await expect(trackNumbersByTitle(page)).resolves.toEqual([
            ['Dawn', '—'],
            ['Noon', '2'],
        ])
        // And it says so, rather than leaving a bare dash for a screen reader to read out
        // as whatever a dash is.
        await expect(page.getByRole('gridcell', { name: 'No track number' })).toBeVisible()
    })

    test('leaves out the album column, which the header above the table already says', async ({ page }) => {
        await openDetail(page)
        await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()

        await expect(page.getByRole('button', { name: 'Sort by Album' })).toBeHidden()
        // Every other column is still there — this is one column dropped, not a different table.
        await expect(page.getByRole('button', { name: 'Sort by Artist' })).toBeVisible()
    })

    test('orders the tracks by track number', async ({ page }) => {
        const controller = await openDetail(page)

        await expect
            .poll(async () => (await lastSongQuery(controller))?.query.sort)
            .toEqual({
                field: 'trackNumber',
                direction: 'asc',
            })
    })

    test('re-sorts when a column heading is clicked, rather than leaving it inert', async ({ page }) => {
        const controller = await openDetail(page)
        await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()

        await page.getByRole('button', { name: 'Sort by Title' }).click()

        await expect.poll(async () => (await lastSongQuery(controller))?.query.sort.field).toBe('title')
    })

    test('links the album artist to that artist’s tracks', async ({ page }) => {
        await openDetail(page)

        await page.getByRole('link', { name: 'Aurora Fields' }).click()

        await expect.poll(() => new URL(page.url()).pathname).toBe('/tracks')
        expect(new URL(page.url()).searchParams.get('artist')).toBe('artist-1')
    })

    test('links the record label to that label’s tracks', async ({ page }) => {
        await openDetail(page)

        await page.getByRole('link', { name: 'Kosmische' }).click()

        await expect.poll(() => new URL(page.url()).searchParams.get('recordLabel')).toBe('label-1')
    })

    test('links a track’s own artist to that artist’s tracks', async ({ page }) => {
        await openDetail(page)

        await page.getByRole('button', { name: 'Aurora Fields', exact: true }).first().click()

        await expect.poll(() => new URL(page.url()).pathname).toBe('/tracks')
    })

    test('explains an album whose files have all gone, rather than showing an empty table', async ({
        page,
    }) => {
        await openDetail(page, rendererScenarios.albums.detailWithoutTracks())

        await expect(page.getByText('No tracks on this album')).toBeVisible()
    })

    test('explains a link to an album that no longer exists', async ({ page }) => {
        await openDetail(page, rendererScenarios.albums.detailMissing(), 'album-gone')

        await expect(page.getByText('This album is no longer in your library')).toBeVisible()
        await page.getByRole('link', { name: 'Back to albums' }).click()

        await expect.poll(() => new URL(page.url()).pathname).toBe('/albums')
    })

    test('distinguishes a failure to load from an album that is gone', async ({ page }) => {
        await openDetail(page, rendererScenarios.albums.detailError())

        await expect(page.getByText('Could not load this album')).toBeVisible()
    })
})

test.describe('reaching the detail page', () => {
    test('a tile opens its album', async ({ page }) => {
        await openAlbums(
            page,
            scenarioBuilder().albums(createAlbumRows()).albumDetail(createAlbumDetail()).build(),
        )

        await tile(page, 'Daybreak').click()

        await expect.poll(() => new URL(page.url()).pathname).toBe('/albums/album-1')
    })

    test('the track list’s album cell navigates now that this page exists', async ({ page }) => {
        // MAE-118 made this cell filter the track list, because the album page did not
        // exist. It does now, so the cell is a real link — the promotion that slice left
        // for this one.
        const scenario = scenarioBuilder()
            .songs([createSongRow({ albumId: 'album-1', albumTitle: 'Daybreak' })])
            .albumDetail(createAlbumDetail())
            .build()
        await createRendererScenario(page, scenario, '/tracks')

        await page.getByRole('link', { name: 'Daybreak' }).click()

        await expect.poll(() => new URL(page.url()).pathname).toBe('/albums/album-1')
    })
})

import { expect, test, type Page } from '@playwright/test'
import type { LibraryScanStatus, QuerySongsRequest } from '@release-maestro/core'
import {
    createRendererScenario,
    createSongRow,
    createSongRows,
    rendererScenarios,
    scenarioBuilder,
    type RendererScenarioController,
} from '../scenario-harness'

/**
 * The track list against mocked IPC.
 *
 * The scenario harness answers `library:query-songs` with a fixed window, so these
 * tests assert two different things depending on what is under test: what the page
 * *renders* from a window it was given, and what it *asks for* when the user sorts,
 * filters, searches or scrolls. The second is the real contract with the read side —
 * asserting that a fake windowed correctly would prove nothing.
 */

const openTracks = (page: Page, scenario = rendererScenarios.tracks.withSongs()) =>
    createRendererScenario(page, scenario, '/tracks')

/**
 * The most recent window request, or `undefined` before the first one lands. It has to
 * be undefined rather than throw: `expect.poll` surfaces a thrown error immediately
 * instead of retrying, which turns "not asked yet" into a flake.
 */
const lastQuery = async (controller: RendererScenarioController): Promise<QuerySongsRequest | undefined> => {
    const call = await controller.lastCall('library:query-songs')
    return call?.payload as QuerySongsRequest | undefined
}

const rowByTitle = (page: Page, title: string) => page.getByRole('row').filter({ hasText: title })

/**
 * Click a row where nothing else is interactive. The cover cell never is, and a press
 * that lands on an entity link belongs to that link rather than to the selection — so
 * clicking a row's centre is not a reliable way to select it.
 */
const clickRow = (page: Page, title: string, modifiers?: ('Shift' | 'ControlOrMeta')[]) =>
    rowByTitle(page, title)
        .getByRole('gridcell')
        .first()
        .click(modifiers ? { modifiers } : undefined)

test.describe('rendering a window', () => {
    test('shows the tracks in the window and the total of the whole library', async ({ page }) => {
        await openTracks(page, scenarioBuilder().songs(createSongRows(), { total: 1_204 }).build())

        await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()
        await expect(
            page.getByRole('status', { name: 'Result count' }).filter({ hasText: '1,204 tracks' }),
        ).toBeVisible()
        await expect(rowByTitle(page, 'Dawn')).toBeVisible()
        await expect(rowByTitle(page, 'Dusk')).toBeVisible()
    })

    test('sizes the scrollbar from the total, not from the rows it was given', async ({ page }) => {
        await openTracks(page, scenarioBuilder().songs(createSongRows(), { total: 5_000 }).build())

        const scrollHeight = await page
            .getByRole('grid', { name: 'Tracks' })
            .evaluate(element => element.scrollHeight)

        // 5,000 rows at 40px each — far taller than three rows of DOM.
        expect(scrollHeight).toBeGreaterThan(100_000)
    })

    test('renders a multi-name credit verbatim while still addressing one artist', async ({ page }) => {
        await openTracks(page)

        await expect(
            page.getByRole('button', { name: 'Night Cartel & Aurora Fields', exact: true }),
        ).toBeVisible()
    })

    test('marks a missing track for sighted and assistive users alike', async ({ page }) => {
        await openTracks(page)

        const missingRow = rowByTitle(page, 'Void')
        await expect(missingRow).toHaveAttribute('aria-label', /missing/i)
        // The badge is an icon, so its accessible name is what carries the meaning.
        await expect(missingRow.getByRole('button', { name: /^Missing/ })).toBeVisible()
        await expect(rowByTitle(page, 'Dawn').getByRole('button', { name: /^Missing/ })).toHaveCount(0)
    })

    test('shows cover art at the start of a row that has any', async ({ page }) => {
        const withCover = createSongRow({ coverPath: '/scenario/covers/daybreak.png' })
        await openTracks(page, scenarioBuilder().songs([withCover]).build())

        const cover = rowByTitle(page, 'Dawn').locator('img')
        await expect(cover).toHaveAttribute('src', 'file:///scenario/covers/daybreak.png')
        // Decorative: the title beside it already names the row.
        await expect(cover).toHaveAttribute('alt', '')
    })

    test('holds the cover column open when a track has no art, so rows stay aligned', async ({ page }) => {
        await openTracks(page, scenarioBuilder().songs([createSongRow()]).build())

        await expect(rowByTitle(page, 'Dawn').locator('img')).toHaveCount(0)
        await expect(rowByTitle(page, 'Dawn')).toBeVisible()
    })

    test('ellipsises an overlong genre rather than cutting it off mid-letter', async ({ page }) => {
        const longGenre = createSongRow({
            id: 'song-long',
            title: 'Sprawling',
            genres: [{ id: 'g1', name: 'Deep Progressive Melodic Organic House' }],
        })
        await openTracks(page, scenarioBuilder().songs([longGenre]).build())

        // The ellipsis has to live on the link itself. A cell-level `truncate` cannot
        // produce one, because Chrome refuses `display: inline` on a `<button>` and
        // `text-overflow` has nothing to trim when the overflowing child is atomic —
        // which is why the value used to be clipped mid-letter with no ellipsis.
        const genreLink = page.getByRole('button', { name: 'Deep Progressive Melodic Organic House' })

        await expect(genreLink).toHaveCSS('text-overflow', 'ellipsis')
        const { scrollWidth, clientWidth } = await genreLink.evaluate(link => ({
            scrollWidth: link.scrollWidth,
            clientWidth: link.clientWidth,
        }))
        expect(scrollWidth).toBeGreaterThan(clientWidth)

        // And it stays inside its column rather than widening the table.
        const cellWidth = await rowByTitle(page, 'Sprawling')
            .getByRole('gridcell')
            .filter({ hasText: 'Deep Progressive' })
            .evaluate(cell => cell.clientWidth)
        expect(clientWidth).toBeLessThanOrEqual(cellWidth)
    })

    test('shows a dash where a tag is absent instead of an empty cell', async ({ page }) => {
        const untagged = createSongRow({
            id: 'song-bare',
            title: 'Untagged',
            artistText: null,
            albumId: null,
            albumTitle: null,
            genres: [],
            genreText: null,
            recordLabelId: null,
            recordLabelText: null,
            bpm: null,
            musicalKey: null,
            duration: null,
            year: null,
            dateAdded: null,
        })
        await openTracks(page, scenarioBuilder().songs([untagged]).build())

        await expect(rowByTitle(page, 'Untagged').getByText('—').first()).toBeVisible()
    })
})

test.describe('sorting', () => {
    test('asks for a new ordering when a column heading is clicked', async ({ page }) => {
        const controller = await openTracks(page)

        await page.getByRole('button', { name: 'Sort by BPM' }).click()

        await expect
            .poll(() => lastQuery(controller))
            .toMatchObject({
                query: { sort: { field: 'bpm', direction: 'desc' } },
            })
    })

    test('flips the direction when the same heading is clicked again', async ({ page }) => {
        const controller = await openTracks(page)

        await page.getByRole('button', { name: 'Sort by Title' }).click()
        await expect
            .poll(() => lastQuery(controller))
            .toMatchObject({
                query: { sort: { field: 'title', direction: 'asc' } },
            })

        await page.getByRole('button', { name: 'Sort by Title' }).click()
        await expect
            .poll(() => lastQuery(controller))
            .toMatchObject({
                query: { sort: { field: 'title', direction: 'desc' } },
            })
    })

    test('puts the sort in the URL and announces it on the column', async ({ page }) => {
        await openTracks(page)

        await page.getByRole('button', { name: 'Sort by Title' }).click()

        await expect(page).toHaveURL(/sort=title/)
        await expect(page).toHaveURL(/dir=asc/)
        await expect(page.getByRole('columnheader', { name: /Title/ })).toHaveAttribute(
            'aria-sort',
            'ascending',
        )
    })

    test('restores the sort from the URL on load', async ({ page }) => {
        const controller = await createRendererScenario(
            page,
            rendererScenarios.tracks.withSongs(),
            '/tracks?sort=year&dir=asc',
        )

        await expect
            .poll(() => lastQuery(controller))
            .toMatchObject({
                query: { sort: { field: 'year', direction: 'asc' } },
            })
    })
})

test.describe('search', () => {
    test('sends the typed term with the query', async ({ page }) => {
        const controller = await openTracks(page)

        await page.getByRole('searchbox', { name: 'Search tracks' }).fill('dusk')

        await expect.poll(() => lastQuery(controller)).toMatchObject({ query: { search: 'dusk' } })
        await expect(page).toHaveURL(/q=dusk/)
    })

    test('clears the search from its own on-theme button', async ({ page }) => {
        const controller = await openTracks(page)
        const search = page.getByRole('searchbox', { name: 'Search tracks' })

        await expect(page.getByRole('button', { name: 'Clear search' })).toBeHidden()
        await search.fill('dusk')

        await page.getByRole('button', { name: 'Clear search' }).click()

        await expect(search).toHaveValue('')
        await expect.poll(() => lastQuery(controller)).toMatchObject({ query: { search: '' } })
    })

    test('keeps the rows on screen while typing instead of flashing a loading state', async ({ page }) => {
        const controller = await openTracks(page)
        await expect(rowByTitle(page, 'Dawn')).toBeVisible()

        // Hold the next window open, so the in-between state is the one under test.
        await controller.setHandler('library:query-songs', { kind: 'pending' })
        await page.getByRole('searchbox', { name: 'Search tracks' }).fill('dus')

        await expect(page.getByText('Loading tracks…')).toBeHidden()
        await expect(rowByTitle(page, 'Dawn')).toBeVisible()
    })

    test('focuses the search on cmd-F, from wherever you are', async ({ page }) => {
        await openTracks(page)

        // The table holds focus almost all of the time, so the shortcut has to work
        // from there rather than only when the toolbar already has it.
        await clickRow(page, 'Dawn')
        await expect(page.getByRole('grid', { name: 'Tracks' })).toBeFocused()

        await page.keyboard.press('ControlOrMeta+f')

        await expect(page.getByRole('searchbox', { name: 'Search tracks' })).toBeFocused()
    })

    test('selects the existing term on cmd-F, so typing replaces it', async ({ page }) => {
        await openTracks(page)
        const search = page.getByRole('searchbox', { name: 'Search tracks' })
        await search.fill('burial')

        await page.getByRole('grid', { name: 'Tracks' }).click()
        await page.keyboard.press('ControlOrMeta+f')
        await page.keyboard.type('four tet')

        // Replaced rather than appended, which is what selecting on focus buys.
        await expect(search).toHaveValue('four tet')
    })

    test('explains an empty result as a filter problem, not an empty library', async ({ page }) => {
        const controller = await openTracks(page)

        await controller.setHandler('library:query-songs', {
            kind: 'resolve',
            value: { rows: [], offset: 0, total: 0 },
        })
        await page.getByRole('searchbox', { name: 'Search tracks' }).fill('nothing matches this')

        await expect(page.getByText('No tracks match these filters')).toBeVisible()
        await expect(page.getByRole('button', { name: 'Clear filters' })).toBeVisible()
    })
})

test.describe('filtering by entity', () => {
    test('filters by the artist entity when an artist credit is clicked', async ({ page }) => {
        const controller = await openTracks(page)

        await page.getByRole('button', { name: 'Night Cartel', exact: true }).click()

        await expect
            .poll(() => lastQuery(controller))
            .toMatchObject({
                query: { filter: { artistIds: ['artist-2'] } },
            })
        await expect(page).toHaveURL(/artist=artist-2/)
    })

    test('filters by genre and by record label from their cells', async ({ page }) => {
        const controller = await openTracks(page)

        await page.getByRole('button', { name: 'Techno', exact: true }).first().click()
        await expect
            .poll(() => lastQuery(controller))
            .toMatchObject({
                query: { filter: { genreIds: ['genre-2'] } },
            })

        await page.getByRole('button', { name: 'Hardwire', exact: true }).first().click()
        await expect
            .poll(() => lastQuery(controller))
            .toMatchObject({
                query: { filter: { recordLabelIds: ['label-2'] } },
            })
    })

    test('shows an applied filter as a removable chip', async ({ page }) => {
        const scenario = scenarioBuilder()
            .songs(createSongRows())
            .songFilterDescription({ artists: [{ id: 'artist-2', name: 'Night Cartel' }] })
            .build()
        const controller = await createRendererScenario(page, scenario, '/tracks?artist=artist-2')

        const chip = page.getByRole('button', { name: 'Remove Artist filter Night Cartel' })
        await expect(chip).toBeVisible()

        await chip.click()

        // Removing the last id drops the param, and an absent param is an absent
        // filter — not an empty list, so the two compare equal by value.
        await expect(page).not.toHaveURL(/artist=/)
        await expect.poll(async () => (await lastQuery(controller))?.query.filter.artistIds).toBeUndefined()
        await expect(chip).toBeHidden()
    })

    test('scopes to missing tracks from the badge on a missing row', async ({ page }) => {
        const controller = await openTracks(page)

        // The badge is the only entry point, and it exists exactly when there is
        // something to filter for — there is no standing availability control.
        await page.getByRole('button', { name: 'Missing — show only missing tracks' }).click()

        await expect
            .poll(() => lastQuery(controller))
            .toMatchObject({
                query: { filter: { presence: 'missing' } },
            })
        await expect(page.getByRole('button', { name: 'Remove Availability filter Missing' })).toBeVisible()
    })

    test('drops the availability scope when its chip is removed', async ({ page }) => {
        const controller = await createRendererScenario(
            page,
            rendererScenarios.tracks.withSongs(),
            '/tracks?presence=missing',
        )

        await page.getByRole('button', { name: 'Remove Availability filter Missing' }).click()

        await expect.poll(async () => (await lastQuery(controller))?.query.filter.presence).toBeUndefined()
    })

    test('still renders the table when the filter names cannot be resolved', async ({ page }) => {
        // Naming a chip is a second round trip, independent of the rows. If it fails
        // the page has to survive it: the description feeds `chips`, `chips` feeds
        // `filterState`, and an error escaping into a signal takes the whole template
        // down when it is read, not just the chip bar.
        const scenario = scenarioBuilder()
            .songs(createSongRows())
            .handler('library:describe-song-filter', {
                kind: 'reject',
                message: 'Backend failed to describe the filter',
            })
            .build()
        await createRendererScenario(page, scenario, '/tracks?artist=artist-2')

        await expect(rowByTitle(page, 'Dawn')).toBeVisible()
        // Unnamed, but not inescapable — the filter is still applied to the query.
        await expect(page.getByRole('button', { name: 'Clear all' })).toBeVisible()
    })
})

test.describe('virtual scrolling', () => {
    test('asks for a later window as the viewport moves down', async ({ page }) => {
        const controller = await openTracks(
            page,
            scenarioBuilder().songs(createSongRows(), { total: 20_000 }).build(),
        )
        await expect(rowByTitle(page, 'Dawn')).toBeVisible()

        await page
            .getByRole('grid', { name: 'Tracks' })
            .evaluate(element => element.scrollTo({ top: 40 * 5_000 }))

        await expect.poll(async () => (await lastQuery(controller))?.window.offset).toBeGreaterThan(4_000)
    })

    test('asks for a window measured against the real viewport, not the starting guess', async ({ page }) => {
        // The regression: the table used to measure itself once, on a render hook that
        // can fire while the shell still has it detached behind a loading state. It
        // then measured a height of zero, asked for a stub window, and left the list
        // with blank rows until a scroll or resize happened to re-trigger a fetch.
        const controller = await openTracks(page, rendererScenarios.tracks.loadPending())
        // Wait for the first request to actually be in flight before settling it.
        await expect(page.getByText('Loading tracks…')).toBeVisible()
        await controller.resolveAllPending('library:query-songs', {
            rows: createSongRows(),
            offset: 0,
            total: 20_000,
        })
        const grid = page.getByRole('grid', { name: 'Tracks' })
        await expect(grid).toBeVisible()

        const visibleRows = await grid.evaluate(element => Math.ceil(element.clientHeight / 40))

        await expect
            .poll(async () => (await lastQuery(controller))?.window.limit)
            .toBeGreaterThanOrEqual(visibleRows)
    })

    test('replaces the window rather than accumulating it, however far you scroll', async ({ page }) => {
        // The memory claim behind ADR 0004: the renderer holds one window, not the
        // library. If windows accumulated, scrolling would grow the row count without
        // bound and a 500k library would end up in the renderer after all.
        await openTracks(page, scenarioBuilder().songs(createSongRows(), { total: 200_000 }).build())
        const grid = page.getByRole('grid', { name: 'Tracks' })
        const renderedRows = page.locator('[role="row"][aria-label]')

        await expect(renderedRows).toHaveCount(3)

        for (const top of [40_000, 400_000, 4_000_000]) {
            await grid.evaluate((element, scrollTop) => element.scrollTo({ top: scrollTop }), top)
            await expect(renderedRows).toHaveCount(3)
        }
    })

    test('shows rows straight away after filtering from deep in a long list', async ({ page }) => {
        // Reported: the table rendered blank until a scroll or resize. Scrolled 5,000
        // rows down, the window was still translated to where those rows used to be —
        // far below anything visible in a result set that had just shrunk.
        const controller = await openTracks(
            page,
            scenarioBuilder().songs(createSongRows(), { total: 20_000 }).build(),
        )
        const grid = page.getByRole('grid', { name: 'Tracks' })
        await grid.evaluate(element => element.scrollTo({ top: 40 * 5_000 }))
        await expect.poll(async () => (await lastQuery(controller))?.window.offset).toBeGreaterThan(4_000)

        await controller.setHandler('library:query-songs', {
            kind: 'resolve',
            value: { rows: createSongRows(), offset: 0, total: 3 },
        })
        await page.getByRole('searchbox', { name: 'Search tracks' }).fill('dawn')

        // Visible without touching the scroll wheel again.
        await expect(rowByTitle(page, 'Dawn')).toBeVisible()
        await expect.poll(async () => (await lastQuery(controller))?.window.offset).toBe(0)
        await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBe(0)
    })

    test('never asks for more rows than the read side will serve', async ({ page }) => {
        const controller = await openTracks(
            page,
            scenarioBuilder().songs(createSongRows(), { total: 20_000 }).build(),
        )

        await expect.poll(async () => (await lastQuery(controller))?.window.limit).toBeLessThanOrEqual(500)
    })
})

test.describe('selection', () => {
    test('selects one row on click and replaces it on the next click', async ({ page }) => {
        await openTracks(page)

        await clickRow(page, 'Dawn')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')

        await clickRow(page, 'Dusk')
        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('adds a row to the selection on cmd-click', async ({ page }) => {
        await openTracks(page)

        await clickRow(page, 'Dawn')
        await clickRow(page, 'Void', ['ControlOrMeta'])

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')
        await expect(rowByTitle(page, 'Void')).toHaveAttribute('aria-selected', 'true')
    })

    test('selects a range on shift-click', async ({ page }) => {
        await openTracks(page)

        await clickRow(page, 'Dawn')
        await clickRow(page, 'Void', ['Shift'])

        for (const title of ['Dawn', 'Dusk', 'Void']) {
            await expect(rowByTitle(page, title)).toHaveAttribute('aria-selected', 'true')
        }
    })

    test('keeps an earlier range when a cmd-click starts a second one', async ({ page }) => {
        // Reported: shift-range, then cmd-click, then shift again threw the first
        // range away. A shift-click means "and also these" when its anchor came from
        // a cmd-click, and "just these" when it came from a plain click.
        const rows = Array.from({ length: 8 }, (_value, index) =>
            createSongRow({ id: `song-${index}`, title: `Row ${index}` }),
        )
        await openTracks(page, scenarioBuilder().songs(rows).build())

        await clickRow(page, 'Row 1')
        await clickRow(page, 'Row 3', ['Shift'])
        await clickRow(page, 'Row 5', ['ControlOrMeta'])
        await clickRow(page, 'Row 7', ['Shift'])

        const selection = await Promise.all(
            rows.map((_row, index) => rowByTitle(page, `Row ${index}`).getAttribute('aria-selected')),
        )
        expect(selection).toEqual(['false', 'true', 'true', 'true', 'false', 'true', 'true', 'true'])
    })

    test('clears the selection when clicking the blank space below the rows', async ({ page }) => {
        await openTracks(page)
        await clickRow(page, 'Dawn')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')

        // Well below three rows of content, but still inside the scroller.
        await page.getByRole('grid', { name: 'Tracks' }).click({ position: { x: 200, y: 400 } })

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('clears the selection when clicking the canvas margin', async ({ page }) => {
        // Reported: the margin around the canvas belongs to the scroller, and an
        // earlier attempt to spare scrollbar presses treated every press on the
        // scroller as one — leaving strips of the table unable to clear anything.
        await openTracks(page)
        await clickRow(page, 'Dawn')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')

        // The canvas carries a bottom margin, which only comes into view at the end of
        // the scroll. A press there lands on the scroller itself, and still has to
        // clear.
        const grid = page.getByRole('grid', { name: 'Tracks' })
        await grid.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
        const point = await grid.evaluate(element => {
            const bounds = element.getBoundingClientRect()
            return { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height - 24 }
        })
        const landsOnScroller = await grid.evaluate(
            (element, at) => document.elementFromPoint(at.x, at.y) === element,
            point,
        )
        expect(landsOnScroller).toBe(true)

        await page.mouse.click(point.x, point.y)

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('clears the selection when clicking outside the table', async ({ page }) => {
        await openTracks(page)
        await clickRow(page, 'Dawn')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')

        await page.getByRole('heading', { name: 'tracks' }).click()

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('keeps the selection while scrolling', async ({ page }) => {
        await openTracks(page, scenarioBuilder().songs(createSongRows(), { total: 5_000 }).build())
        await clickRow(page, 'Dawn')

        await page.getByRole('grid', { name: 'Tracks' }).evaluate(element => element.scrollTo({ top: 400 }))

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')
    })

    test('clears the selection when a search changes the list underneath it', async ({ page }) => {
        await openTracks(page)
        await clickRow(page, 'Dawn')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')

        await page.getByRole('searchbox', { name: 'Search tracks' }).fill('dawn')

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('does not resurrect a cleared selection when the search is emptied again', async ({ page }) => {
        // Reported: clearing was only projected over the stored selection, so undoing
        // the search brought it back.
        await openTracks(page)
        await clickRow(page, 'Dawn')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')

        const search = page.getByRole('searchbox', { name: 'Search tracks' })
        await search.fill('dawn')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')

        await search.fill('')
        await expect(page).not.toHaveURL(/q=/)
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('does not resurrect a cleared selection when a filter is removed again', async ({ page }) => {
        const scenario = scenarioBuilder()
            .songs(createSongRows())
            .songFilterDescription({ genres: [{ id: 'genre-2', name: 'Techno' }] })
            .build()
        await createRendererScenario(page, scenario, '/tracks')

        await clickRow(page, 'Dawn')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')

        await page.getByRole('button', { name: 'Techno', exact: true }).first().click()
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')

        await page.getByRole('button', { name: 'Remove Genre filter Techno' }).click()
        await expect(page).not.toHaveURL(/genre=/)
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('does not resurrect a cleared selection when the sort returns to the default', async ({ page }) => {
        await openTracks(page)
        await clickRow(page, 'Dawn')

        await page.getByRole('button', { name: 'Sort by Title' }).click()
        await expect(page).toHaveURL(/sort=title/)
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')

        // Back to the default ordering, so the query is byte-for-byte the one the
        // selection was made against — which is exactly when it used to come back.
        await page.getByRole('button', { name: 'Sort by Added' }).click()
        await expect(page).not.toHaveURL(/sort=/)

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('selects the row instead of filtering when a modifier is held over a link', async ({ page }) => {
        const controller = await openTracks(page)
        await clickRow(page, 'Dawn')

        // A cmd-click on the artist link plainly means "add this row", not "filter".
        await rowByTitle(page, 'Dusk')
            .getByRole('button', { name: 'Night Cartel', exact: true })
            .click({ modifiers: ['ControlOrMeta'] })

        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')
        await expect(page).not.toHaveURL(/artist=/)
        expect((await lastQuery(controller))?.query.filter.artistIds).toBeUndefined()
    })

    test('deselects a span with the same cmd-shift pattern that selects one', async ({ page }) => {
        const rows = Array.from({ length: 8 }, (_value, index) =>
            createSongRow({ id: `song-${index}`, title: `Row ${index}` }),
        )
        await openTracks(page, scenarioBuilder().songs(rows).build())

        await clickRow(page, 'Row 0')
        await clickRow(page, 'Row 7', ['Shift'])
        await clickRow(page, 'Row 2', ['ControlOrMeta'])
        await clickRow(page, 'Row 5', ['ControlOrMeta', 'Shift'])

        const selection = await Promise.all(
            rows.map((_row, index) => rowByTitle(page, `Row ${index}`).getAttribute('aria-selected')),
        )
        expect(selection).toEqual(['true', 'true', 'false', 'false', 'false', 'false', 'true', 'true'])
    })

    test('selects the whole library on cmd-A without loading it', async ({ page }) => {
        await openTracks(page, scenarioBuilder().songs(createSongRows(), { total: 500_000 }).build())

        await page.getByRole('grid', { name: 'Tracks' }).click()
        await page.keyboard.press('ControlOrMeta+a')

        await expect(page.getByText('500000 of 500000 tracks selected')).toBeAttached()
    })

    test('clears the selection when the sort changes, because indices moved', async ({ page }) => {
        await openTracks(page)

        await clickRow(page, 'Dawn')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')

        await page.getByRole('button', { name: 'Sort by Title' }).click()

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('moves the selection with the arrow keys, with no second cursor to chase', async ({ page }) => {
        await openTracks(page)

        await clickRow(page, 'Dawn')
        await page.keyboard.press('ArrowDown')

        // One state: arrowing *is* selecting, so there is nothing else to render.
        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'false')
    })

    test('works from the keyboard straight after a click, without tabbing first', async ({ page }) => {
        await openTracks(page)

        await clickRow(page, 'Dawn')

        // Reported as inconsistent: the click used to leave focus elsewhere, so the
        // first arrow key did nothing until the user happened to tab into the grid.
        await expect(page.getByRole('grid', { name: 'Tracks' })).toBeFocused()
        await page.keyboard.press('ArrowDown')
        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')
    })

    test('extends the selection with shift and the arrow keys', async ({ page }) => {
        await openTracks(page)

        await clickRow(page, 'Dawn')
        await page.keyboard.press('Shift+ArrowDown')

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')
        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')
    })

    test('selects the last row on End, far past the loaded window', async ({ page }) => {
        // End on a large library jumps thousands of rows ahead of the data. The row it
        // lands on has no id yet, and a gesture that needed one used to move the
        // viewport while leaving the previous row selected — the list scrolled and the
        // selection stayed behind.
        // A catalog rather than a fixed fixture, so the row End lands on actually
        // exists and can be asserted on. Against a static three-row window the only
        // thing left to check was the count, and whether the old rows were still in
        // the DOM depended on where the scroll ended up.
        await createRendererScenario(page, scenarioBuilder().songCatalog(page, 50_000).build(), '/tracks')

        await clickRow(page, 'Row 0')
        await page.keyboard.press('End')

        await expect(rowByTitle(page, 'Row 49999')).toHaveAttribute('aria-selected', 'true')
        await expect(page.getByText('1 of 50000 tracks selected')).toBeAttached()
    })

    test('keeps arrowing after Escape clears the selection', async ({ page }) => {
        await openTracks(page)

        // Escape resets the cursor to "nowhere yet". The keyboard used to land *on*
        // that non-row, selecting an empty range — and every vertical key after it was
        // then swallowed while the grid still held focus.
        await clickRow(page, 'Dusk')
        await page.keyboard.press('Escape')
        await expect(page.getByRole('row', { selected: true })).toHaveCount(0)

        await page.keyboard.press('ArrowDown')
        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')

        await page.keyboard.press('ArrowDown')
        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')
    })

    test('gives the grid a current row when the keyboard arrives at it', async ({ page }) => {
        await openTracks(page)

        // The grid has no focus ring of its own any more, so landing on it has to put
        // the selection somewhere visible.
        await page.keyboard.press('Tab')
        await page.getByRole('grid', { name: 'Tracks' }).focus()
        await page.keyboard.press('ArrowDown')

        await expect(page.getByRole('grid', { name: 'Tracks' })).toHaveAttribute(
            'aria-activedescendant',
            /song-row-/,
        )
        await expect(page.getByRole('row', { selected: true })).toHaveCount(1)
    })
})

test.describe('what the window actually renders', () => {
    /**
     * The tests above assert what the table *asks for*. These assert what it draws, at
     * several scroll positions against a read side that answers each window honestly.
     * Reported as blank or missing regions that only filled in after a nudge — a table
     * that requests the right window and then translates it to the wrong place asks
     * identically to one that works, so nothing keyed on the request can catch it.
     */
    const openLargeLibrary = (page: Page, total = 50_000) =>
        createRendererScenario(page, scenarioBuilder().songCatalog(page, total).build(), '/tracks')

    /** Every row the user can actually see, top to bottom. */
    const visibleTitles = async (page: Page): Promise<string[]> => {
        const grid = page.getByRole('grid', { name: 'Tracks' })
        return grid.evaluate(element => {
            const bounds = element.getBoundingClientRect()
            return [...element.querySelectorAll('[role="row"][aria-selected]')]
                .filter(row => {
                    const box = row.getBoundingClientRect()
                    return box.bottom > bounds.top + 1 && box.top < bounds.bottom - 1
                })
                .map(row => row.querySelector('.song-table__title')?.textContent?.trim() ?? '')
        })
    }

    /**
     * The indices of the visible rows.
     *
     * Asserted as a contiguous run rather than against an index computed from the
     * scroll position: the exact first row depends on the canvas margins, and pinning
     * those here would make this a layout test. Contiguity is the property under
     * test — a blank region is a gap in this sequence, and a mistranslated window is a
     * sequence starting somewhere it should not.
     */
    const visibleIndices = async (page: Page): Promise<number[]> =>
        (await visibleTitles(page)).map(title => Number(title.replace('Row ', '')))

    const expectContiguousFrom = (indices: number[], expectedFirst: number) => {
        expect(indices.length).toBeGreaterThan(5)
        expect(indices).toEqual(indices.map((_index, position) => indices[0]! + position))
        expect(Math.abs(indices[0]! - expectedFirst)).toBeLessThanOrEqual(2)
    }

    test('fills the viewport at the top, with no gaps', async ({ page }) => {
        await openLargeLibrary(page)
        await expect(rowByTitle(page, 'Row 0')).toBeVisible()

        expectContiguousFrom(await visibleIndices(page), 0)
    })

    test('fills the viewport again after scrolling deep into the list', async ({ page }) => {
        await openLargeLibrary(page)
        await expect(rowByTitle(page, 'Row 0')).toBeVisible()

        const grid = page.getByRole('grid', { name: 'Tracks' })
        for (const top of [8_000, 400_000, 120_000]) {
            await grid.evaluate((element, scrollTop) => element.scrollTo({ top: scrollTop }), top)

            const first = Math.floor(top / 40)
            await expect(rowByTitle(page, `Row ${first}`)).toBeVisible()
            expectContiguousFrom(await visibleIndices(page), first)
        }
    })

    test('fills the viewport after a resize', async ({ page }) => {
        // The other half of the report: it said blank regions filled in after a scroll
        // *or a resize*. A resize re-measures the viewport and issues a different
        // window, which has to land in the right place like any other.
        await openLargeLibrary(page)
        await expect(rowByTitle(page, 'Row 0')).toBeVisible()

        await page.setViewportSize({ width: 1_280, height: 900 })

        await expect(rowByTitle(page, 'Row 0')).toBeVisible()
        expectContiguousFrom(await visibleIndices(page), 0)
    })

    // Not covered: the first window landing *after* the table's branch has been
    // attached and measured, which is the exact state the blank-region report came
    // from. Staging it needs the initial fetch held across a layout pass the harness
    // cannot currently sequence — the `pending` behaviour leaves the call unresolved
    // rather than in flight. The ResizeObserver in `SongTableComponent` is what closes
    // that case, and it is the one thing here still resting on reasoning rather than
    // on a test.
})

test.describe('column alignment', () => {
    /**
     * The one thing this table has always been able to get wrong quietly. Header widths
     * and body widths were two lists of literal classes that had to be edited together,
     * with a comment saying so and nothing enforcing it; they are one constant now, but
     * a cell that forgets to bind it still sizes to its content and shifts every column
     * after it. That is invisible to every other test here, which look cells up by role
     * and never ask where they are.
     */

    /** Every header cell and its opposite body cell, as left edge and width. */
    const measureColumns = (page: Page) =>
        page.getByRole('grid', { name: 'Tracks' }).evaluate(grid => {
            const box = (element: Element) => {
                const rect = element.getBoundingClientRect()
                return { left: Math.round(rect.left), width: Math.round(rect.width) }
            }
            const header = grid.querySelector('.song-table__header')
            const row = grid.querySelector('[role="row"][aria-selected]')
            return {
                header: [...(header?.children ?? [])].map(box),
                body: [...(row?.querySelectorAll('[role="gridcell"]') ?? [])].map(box),
            }
        })

    // Narrow enough that the columns overflow and the table scrolls sideways, wide
    // enough that the title column has slack to grow into, and one in between. The
    // reported drift was specifically "when the viewport shrinks", and a single width
    // cannot see it: header and body sit in different containers, so anything that
    // distributes free space can resolve differently on either side.
    for (const width of [640, 1024, 1800]) {
        test(`every body cell sits under its own header cell at ${width}px`, async ({ page }) => {
            await page.setViewportSize({ width, height: 800 })
            await createRendererScenario(page, scenarioBuilder().songCatalog(page, 500).build(), '/tracks')
            await expect(rowByTitle(page, 'Row 0')).toBeVisible()

            const columns = await measureColumns(page)

            expect(columns.body).toHaveLength(columns.header.length)
            expect(columns.body).toEqual(columns.header)
        })
    }

    test('stays aligned after the table is scrolled sideways', async ({ page }) => {
        // Horizontal scroll is where the two containers are most likely to disagree:
        // the header is sticky vertically but scrolls horizontally with the rows, and
        // it is a sibling of the canvas the rows live in rather than a parent.
        await page.setViewportSize({ width: 640, height: 800 })
        await createRendererScenario(page, scenarioBuilder().songCatalog(page, 500).build(), '/tracks')
        await expect(rowByTitle(page, 'Row 0')).toBeVisible()

        const grid = page.getByRole('grid', { name: 'Tracks' })
        await grid.evaluate(element => element.scrollTo({ left: element.scrollWidth }))

        const columns = await measureColumns(page)

        expect(columns.body).toEqual(columns.header)
        // And the scroll actually went somewhere, so this is not asserting on a table
        // that never overflowed.
        expect(await grid.evaluate(element => element.scrollLeft)).toBeGreaterThan(0)
    })

    test('stays aligned when the viewport is resized under it', async ({ page }) => {
        // The original comment warned they "drift apart when the viewport shrinks" —
        // not on load at a given size, but on the transition.
        await page.setViewportSize({ width: 1800, height: 800 })
        await createRendererScenario(page, scenarioBuilder().songCatalog(page, 500).build(), '/tracks')
        await expect(rowByTitle(page, 'Row 0')).toBeVisible()

        await page.setViewportSize({ width: 700, height: 800 })
        await expect(rowByTitle(page, 'Row 0')).toBeVisible()

        const columns = await measureColumns(page)

        expect(columns.body).toEqual(columns.header)
    })
})

test.describe('the grid for keyboard and assistive tech', () => {
    test('owns its rows through the layout wrappers between them', async ({ page }) => {
        await openTracks(page)

        // The rows sit two layout wrappers below the grid — a canvas sized to the
        // whole result set, and a window translated into place. `role="row"` requires
        // a grid, table or rowgroup parent, and untyped wrappers break that chain, so
        // both are marked presentational and the rows re-parent to the grid.
        //
        // Asserted on the attribute rather than through the accessibility tree on
        // purpose: Chromium exposes the rows either way, so a `getByRole('row')` count
        // passes against the broken markup and proves nothing. Other engines and axe's
        // `aria-required-parent` are less forgiving, and the spec is what we are
        // holding to here.
        const grid = page.getByRole('grid', { name: 'Tracks' })
        await expect(grid.locator('.song-table__canvas')).toHaveAttribute('role', 'presentation')
        await expect(grid.locator('.song-table__window')).toHaveAttribute('role', 'presentation')
        await expect(grid).toHaveAttribute('aria-rowcount', '4') // header + three songs
    })

    test('keeps the cursor row clear of both viewport edges', async ({ page }) => {
        // Scrolling the cursor to the very edge is technically in view and useless to
        // read — the row you are about to arrow onto is off screen. Arrowing down used
        // to leave a sliver of the selected row below the fold.
        await createRendererScenario(page, scenarioBuilder().songCatalog(page, 5_000).build(), '/tracks')
        await clickRow(page, 'Row 0')

        const grid = page.getByRole('grid', { name: 'Tracks' })
        for (let press = 0; press < 40; press++) await page.keyboard.press('ArrowDown')

        const clearance = await grid.evaluate(element => {
            const selected = element.querySelector('[role="row"][aria-selected="true"]')
            if (!selected) return null
            const bounds = element.getBoundingClientRect()
            const row = selected.getBoundingClientRect()
            return { below: bounds.bottom - row.bottom, above: row.top - bounds.top }
        })

        // Four rows of 40px, less a pixel of rounding.
        expect(clearance?.below).toBeGreaterThan(159)
        expect(clearance?.above).toBeGreaterThan(0)
    })

    test('is a single tab stop, with the row controls on the arrow keys', async ({ page }) => {
        await openTracks(page)
        await clickRow(page, 'Dawn')

        // Every control in a row is out of the tab order: a 60-row window would
        // otherwise be ~240 stops, and they change identity as the window scrolls.
        await page.keyboard.press('Tab')
        await expect(page.getByRole('grid', { name: 'Tracks' })).not.toBeFocused()

        // Reachable, though — right steps into the row, left steps back out to the
        // grid, where the arrow keys mean the selection again.
        await page.getByRole('grid', { name: 'Tracks' }).focus()
        await page.keyboard.press('ArrowRight')
        await expect(rowByTitle(page, 'Dawn').getByRole('button').first()).toBeFocused()

        await page.keyboard.press('ArrowLeft')
        await expect(page.getByRole('grid', { name: 'Tracks' })).toBeFocused()
    })
})

test.describe('selection against a moving list', () => {
    /**
     * The unit tests cover the selection model; these cover the wiring, which is where
     * every bug in it actually lived. The model was right and the table kept its own
     * copies of where the selection was — a cursor and a shift-anchor with their own
     * lifetimes — so each one went stale on a different event.
     */
    const scanStatus = (phase: LibraryScanStatus['phase'], revision: number) =>
        ({
            scanId: 1,
            revision,
            trigger: 'manual',
            phase,
            scannedFolders: ['/music'],
            unavailableFolders: [],
            startedAt: Date.now() - 10_000,
            finishedAt: null,
            discovered: 3,
            new: 3,
            changed: 0,
            unchanged: 0,
            readDone: 3,
            readTotal: 3,
            imported: 3,
            failedFiles: 0,
            normalizationIssues: 0,
            terminal: null,
        }) satisfies LibraryScanStatus

    test('keeps the highlight on the song, not the index, when a scan grows the list', async ({ page }) => {
        const controller = await openTracks(page, scenarioBuilder().songs(createSongRows()).build())
        await clickRow(page, 'Dusk')
        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')

        // A scan inserts a row above the selected one: same song, new index. The
        // selection travels as an id, so the highlight has to travel with it — it used
        // to stay on whichever row inherited the old index.
        const shifted = [createSongRow({ id: 'song-new', title: 'Zenith' }), ...createSongRows()]
        await controller.setHandler('library:query-songs', {
            kind: 'resolve',
            value: { rows: shifted, offset: 0, total: shifted.length },
        })
        await controller.emit('library:scan-status', {
            status: scanStatus('completed', 2),
            newAlbums: [],
        })

        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')
        await expect(rowByTitle(page, 'Zenith')).toHaveAttribute('aria-selected', 'false')
        await expect(page.getByText('1 of 4 tracks selected')).toBeAttached()
    })

    test('starts the keyboard over at the top after the sort changes', async ({ page }) => {
        // Reported: select the second row, re-sort, then keep arrowing — it resumed
        // from the old index rather than from the top. Clearing the selection was not
        // enough, because the cursor was a separate field with its own lifetime and
        // nothing reset it.
        await openTracks(page)
        await clickRow(page, 'Dusk')

        await page.getByRole('button', { name: 'Sort by Title' }).click()
        await expect(page.getByRole('row', { selected: true })).toHaveCount(0)

        // Clicking a header takes focus out of the grid, so coming back is part of the
        // gesture. Landing on it with nothing selected puts the cursor somewhere
        // visible — at the top, now that the cursor was cleared along with the
        // selection. It used to land on the second row, wherever that now was.
        //
        // Tab first: the handler only fires for *keyboard* focus, and Chromium will not
        // call a programmatic focus keyboard-driven while the last input was a click.
        await page.keyboard.press('Tab')
        await page.getByRole('grid', { name: 'Tracks' }).focus()

        await expect(rowByTitle(page, 'Dawn')).toHaveAttribute('aria-selected', 'true')
        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'false')

        // And carries on from there.
        await page.keyboard.press('ArrowDown')
        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')
    })

    test('does not rebuild a cleared range from a stale anchor', async ({ page }) => {
        const controller = await openTracks(page, scenarioBuilder().songs(createSongRows()).build())
        await clickRow(page, 'Dawn')
        await clickRow(page, 'Void', ['Shift'])
        await expect(page.getByText('3 of 3 tracks selected')).toBeAttached()

        // The row count changes, so the range is dropped. The anchor it was measured
        // from used to survive that, and the next shift-click re-applied the selection
        // the anchor had captured — resurrecting the range that had just been cleared.
        const grown = [...createSongRows(), createSongRow({ id: 'song-4', title: 'Zenith' })]
        await controller.setHandler('library:query-songs', {
            kind: 'resolve',
            value: { rows: grown, offset: 0, total: grown.length },
        })
        await controller.emit('library:scan-status', {
            status: scanStatus('completed', 2),
            newAlbums: [],
        })
        await expect(page.getByRole('row', { selected: true })).toHaveCount(0)

        await clickRow(page, 'Dusk', ['Shift'])

        // A fresh single selection, not the old span.
        await expect(page.getByText('1 of 4 tracks selected')).toBeAttached()
    })
})

test.describe('live updates during a scan', () => {
    /** A status snapshot in one phase; only the phase and the revision matter here. */
    const scanStatus = (phase: LibraryScanStatus['phase'], revision: number) =>
        ({
            scanId: 1,
            revision,
            trigger: 'manual',
            phase,
            scannedFolders: ['/music'],
            unavailableFolders: [],
            startedAt: Date.now() - 10_000,
            finishedAt: null,
            discovered: 3,
            new: 3,
            changed: 0,
            unchanged: 0,
            readDone: 3,
            readTotal: 3,
            imported: 3,
            failedFiles: 0,
            normalizationIssues: 0,
            terminal: null,
        }) satisfies LibraryScanStatus

    test('refetches once a scan finishes, not only while it runs', async ({ page }) => {
        const controller = await openTracks(page)
        await expect(rowByTitle(page, 'Dawn')).toBeVisible()

        const before = (await controller.calls('library:query-songs')).length

        // The refetch is audited while a scan runs, so it emits the *last* status of
        // each window. Whatever the scan commits after its final progress event lands
        // with nothing left to announce it — the table would hold a stale count and a
        // stale window until the user happened to scroll or navigate.
        await controller.emit('library:scan-status', {
            status: scanStatus('completed', 2),
            newAlbums: [],
        })

        await expect
            .poll(async () => (await controller.calls('library:query-songs')).length)
            .toBeGreaterThan(before)
    })
})

test.describe('loading, empty and error states', () => {
    test('shows a loading state until the first window lands', async ({ page }) => {
        const controller = await openTracks(page, rendererScenarios.tracks.loadPending())

        await expect(page.getByText('Loading tracks…')).toBeVisible()

        // The table asks twice on mount — once for a guessed window, then for the one
        // it measured — and switchMap abandons the first.
        await controller.resolveAllPending('library:query-songs', {
            rows: createSongRows(),
            offset: 0,
            total: 3,
        })

        await expect(rowByTitle(page, 'Dawn')).toBeVisible()
    })

    test('offers a route to the scanner when the library is empty', async ({ page }) => {
        await openTracks(page, rendererScenarios.tracks.empty())

        await expect(page.getByText('No tracks yet')).toBeVisible()
        await expect(page.getByRole('link', { name: 'Library settings' })).toBeVisible()
    })

    test('surfaces a failure and retries on demand', async ({ page }) => {
        const controller = await openTracks(page, rendererScenarios.tracks.loadError())

        await expect(page.getByText('Could not load your tracks')).toBeVisible()
        await expect(page.getByText('Could not reach the library')).toBeVisible()

        await controller.setHandler('library:query-songs', {
            kind: 'resolve',
            value: { rows: createSongRows(), offset: 0, total: 3 },
        })
        await page.getByRole('button', { name: 'Try again' }).click()

        await expect(rowByTitle(page, 'Dawn')).toBeVisible()
    })
})

import { expect, test, type Page } from '@playwright/test'
import type { QuerySongsRequest } from '@release-maestro/core'
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
 * asserting that a fake paged correctly would prove nothing.
 */

const openTracks = (page: Page, scenario = rendererScenarios.tracks.withSongs()) =>
    createRendererScenario(page, scenario, '/tracks')

const lastQuery = async (controller: RendererScenarioController): Promise<QuerySongsRequest> => {
    const call = await controller.lastCall('library:query-songs')
    return call?.payload as QuerySongsRequest
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
        await expect.poll(async () => (await lastQuery(controller)).query.filter.artistIds).toBeUndefined()
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

        await expect.poll(async () => (await lastQuery(controller)).query.filter.presence).toBeUndefined()
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

        await expect.poll(async () => (await lastQuery(controller)).window.offset).toBeGreaterThan(4_000)
    })

    test('asks for a window measured against the real viewport, not the starting guess', async ({ page }) => {
        // The regression: the table used to measure itself once, on a render hook that
        // can fire while the shell still has it detached behind a loading state. It
        // then measured a height of zero, asked for a stub window, and left the list
        // with blank rows until a scroll or resize happened to re-trigger a fetch.
        const controller = await openTracks(page, rendererScenarios.tracks.loadPending())
        await controller.resolveAllPending('library:query-songs', {
            rows: createSongRows(),
            offset: 0,
            total: 20_000,
        })
        const grid = page.getByRole('grid', { name: 'Tracks' })
        await expect(grid).toBeVisible()

        const visibleRows = await grid.evaluate(element => Math.ceil(element.clientHeight / 40))

        await expect
            .poll(async () => (await lastQuery(controller)).window.limit)
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

    test('never asks for more rows than the read side will serve', async ({ page }) => {
        const controller = await openTracks(
            page,
            scenarioBuilder().songs(createSongRows(), { total: 20_000 }).build(),
        )

        await expect.poll(async () => (await lastQuery(controller)).window.limit).toBeLessThanOrEqual(500)
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

    test('moves the selection with the arrow keys', async ({ page }) => {
        await openTracks(page)

        await page.getByRole('grid', { name: 'Tracks' }).click()
        await page.keyboard.press('ArrowDown')
        await page.keyboard.press('Enter')

        await expect(rowByTitle(page, 'Dusk')).toHaveAttribute('aria-selected', 'true')
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

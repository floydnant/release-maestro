import { expect, test, type Page } from '@playwright/test'
import type { QuerySongsRequest } from '@release-maestro/core'
import {
    createAlbumDetail,
    createRendererScenario,
    rendererScenarios,
    scenarioBuilder,
    type RendererScenarioController,
} from '../scenario-harness'

/**
 * The title bar's Back and Forward, against mocked IPC.
 *
 * Three separate contracts, and they fail in different ways:
 *
 * - **The buttons say where you can go.** The platform never exposes whether a forward
 *   entry exists, so `HistoryService` tracks it; the unit spec covers the transitions and
 *   this covers that the chrome is wired to them and that a real browser agrees.
 * - **What counts as an entry.** ADR 0006 says only route changes do, which is only
 *   observable by pressing Back after a sort and landing on the previous *page*.
 * - **Where you land.** Filter and sort come back with the URL, and the scroll position
 *   comes back with the history entry — including, crucially, without a round trip to the
 *   top of the list on the way.
 */

const backButton = (page: Page) => page.getByRole('button', { name: 'Back' })
const forwardButton = (page: Page) => page.getByRole('button', { name: 'Forward' })
const sidebarLink = (page: Page, name: string) => page.getByRole('link', { name, exact: true })

const trackGrid = (page: Page) => page.getByRole('grid', { name: 'Tracks' })
const albumGrid = (page: Page) => page.getByRole('grid', { name: 'Albums' })

const songWindows = async (controller: RendererScenarioController): Promise<QuerySongsRequest[]> =>
    (await controller.calls('library:query-songs')).map(call => call.payload as QuerySongsRequest)

/** A library big enough to scroll, with an album to open at the end of a trail. */
const browsableLibrary = (page: Page) =>
    scenarioBuilder()
        .songCatalog(page, 5_000)
        .albumCatalog(page, 2_000)
        .albumDetail(createAlbumDetail())
        .build()

test.describe('what the buttons offer', () => {
    test('starts with nowhere to go', async ({ page }) => {
        await createRendererScenario(page, rendererScenarios.albums.withAlbums(), '/albums')
        await expect(albumGrid(page)).toBeVisible()

        await expect(backButton(page)).toBeDisabled()
        await expect(forwardButton(page)).toBeDisabled()
    })

    test('offers Forward only between going back and going somewhere new', async ({ page }) => {
        await createRendererScenario(page, browsableLibrary(page), '/albums')
        await expect(albumGrid(page)).toBeVisible()

        await sidebarLink(page, 'Tracks').click()
        await expect(page).toHaveURL(/\/tracks/)
        await expect(backButton(page)).toBeEnabled()
        await expect(forwardButton(page)).toBeDisabled()

        await backButton(page).click()
        await expect(page).toHaveURL(/\/albums/)
        await expect(backButton(page)).toBeDisabled()
        await expect(forwardButton(page)).toBeEnabled()

        await forwardButton(page).click()
        await expect(page).toHaveURL(/\/tracks/)
        await expect(forwardButton(page)).toBeDisabled()
    })

    test('drops the forward entries when a new page is pushed after going back', async ({ page }) => {
        await createRendererScenario(page, browsableLibrary(page), '/albums')
        await sidebarLink(page, 'Tracks').click()
        await expect(page).toHaveURL(/\/tracks/)

        await backButton(page).click()
        await expect(forwardButton(page)).toBeEnabled()

        await sidebarLink(page, 'Home').click()
        await expect(page).toHaveURL(/\/home/)
        await expect(forwardButton(page)).toBeDisabled()
    })

    test('hides the buttons on the onboarding route, which owns the window', async ({ page }) => {
        await createRendererScenario(
            page,
            scenarioBuilder()
                .settings({ library: { folders: [] }, emailPluginConfig: {} })
                .build(),
            '/import',
        )

        await expect(page).toHaveURL(/\/import/)
        await expect(backButton(page)).toHaveCount(0)
        await expect(forwardButton(page)).toHaveCount(0)
    })
})

test.describe('what counts as a history entry', () => {
    test('goes back past a sort, to the previous page', async ({ page }) => {
        await createRendererScenario(page, browsableLibrary(page), '/albums')
        await sidebarLink(page, 'Tracks').click()
        await expect(trackGrid(page)).toBeVisible()

        await page.getByRole('button', { name: 'Sort by Title' }).click()
        await expect(page).toHaveURL(/sort=title/)

        await backButton(page).click()

        await expect(page).toHaveURL(/\/albums/)
    })

    test('goes back past a search, to the previous page', async ({ page }) => {
        await createRendererScenario(page, browsableLibrary(page), '/albums')
        await sidebarLink(page, 'Tracks').click()
        await expect(trackGrid(page)).toBeVisible()

        await page.getByRole('searchbox', { name: 'Search tracks' }).fill('row 1')
        await expect(page).toHaveURL(/q=row/)

        await backButton(page).click()

        await expect(page).toHaveURL(/\/albums/)
    })
})

test.describe('where Back lands', () => {
    test('brings the filter and the sort back with the URL', async ({ page }) => {
        await createRendererScenario(page, browsableLibrary(page), '/tracks?sort=year&dir=desc&q=row%201')
        await expect(trackGrid(page)).toBeVisible()

        await sidebarLink(page, 'Albums').click()
        await expect(albumGrid(page)).toBeVisible()

        await backButton(page).click()

        await expect(page).toHaveURL(/sort=year/)
        await expect(page).toHaveURL(/dir=desc/)
        await expect(page.getByRole('searchbox', { name: 'Search tracks' })).toHaveValue('row 1')
        await expect(page.getByRole('columnheader', { name: /Year/ })).toHaveAttribute(
            'aria-sort',
            'descending',
        )
    })

    test('brings the scroll position back, without a round trip to the top of the list', async ({ page }) => {
        const controller = await createRendererScenario(page, browsableLibrary(page), '/tracks')
        const grid = trackGrid(page)

        // Row 1,000, at the table's fixed 40px row height.
        await grid.evaluate(element => element.scrollTo({ top: 40 * 1_000 }))
        await expect
            .poll(async () => (await songWindows(controller)).at(-1)?.window.offset)
            .toBeGreaterThan(900)

        await sidebarLink(page, 'Albums').click()
        await expect(albumGrid(page)).toBeVisible()
        const windowsBeforeBack = (await songWindows(controller)).length

        await backButton(page).click()
        await expect(grid).toBeVisible()

        await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBe(40 * 1_000)

        // The point of seeding the page's window rather than correcting the table's: the
        // *first* window fetched is the one the user was looking at, so there is no
        // throwaway query at offset 0 and no flash of the top of the list.
        const windowsAfterBack = (await songWindows(controller)).slice(windowsBeforeBack)
        expect(windowsAfterBack.length).toBeGreaterThan(0)
        for (const request of windowsAfterBack) expect(request.window.offset).toBeGreaterThan(900)
    })

    test('brings the grid back to roughly where it was', async ({ page }) => {
        const controller = await createRendererScenario(page, browsableLibrary(page), '/albums')
        const grid = albumGrid(page)
        await expect(grid).toBeVisible()

        await grid.evaluate(element => element.scrollTo({ top: 3_000 }))
        await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBe(3_000)
        // Let the window that position means settle before leaving.
        await expect.poll(async () => (await controller.lastCall('library:query-albums')) != null).toBe(true)

        await sidebarLink(page, 'Tracks').click()
        await expect(trackGrid(page)).toBeVisible()

        await backButton(page).click()

        // Exact, unlike the window it seeds: the grid measures its own geometry before
        // applying the position, so only the *first fetched window* is an estimate.
        await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBe(3_000)
    })

    test('goes back to the top of a list the user then re-sorts', async ({ page }) => {
        const controller = await createRendererScenario(page, browsableLibrary(page), '/tracks')
        const grid = trackGrid(page)

        await grid.evaluate(element => element.scrollTo({ top: 40 * 1_000 }))
        await sidebarLink(page, 'Albums').click()
        await expect(albumGrid(page)).toBeVisible()
        await backButton(page).click()
        await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBe(40 * 1_000)

        // A restore describes one arrival, not the page: the sort that follows it is a
        // new result set, and 1,000 rows down means nothing in it.
        await page.getByRole('button', { name: 'Sort by Title' }).click()

        await expect.poll(() => grid.evaluate(element => element.scrollTop)).toBe(0)
        await expect.poll(async () => (await songWindows(controller)).at(-1)?.window.offset).toBe(0)
    })
})

test.describe('the keyboard', () => {
    test('goes back and forward on the macOS bindings', async ({ page }) => {
        await createRendererScenario(page, browsableLibrary(page), '/albums')
        await sidebarLink(page, 'Tracks').click()
        await expect(trackGrid(page)).toBeVisible()

        await page.keyboard.press('Meta+ArrowLeft')
        await expect(page).toHaveURL(/\/albums/)

        await page.keyboard.press('Meta+ArrowRight')
        await expect(page).toHaveURL(/\/tracks/)
    })

    test('leaves the search box its own caret movement', async ({ page }) => {
        await createRendererScenario(page, browsableLibrary(page), '/albums')
        await sidebarLink(page, 'Tracks').click()
        await expect(trackGrid(page)).toBeVisible()

        const search = page.getByRole('searchbox', { name: 'Search tracks' })
        await search.click()
        await page.keyboard.press('Meta+ArrowLeft')

        await expect(page).toHaveURL(/\/tracks/)
    })
})

import { expect, test } from '@playwright/test'
import { createGenre, GENRE_ROWS, genreCatalog } from '../../fixtures/genres.fixture'
import {
    createAlbumRow,
    createRendererScenario,
    createSongRow,
    respond,
    scenarioBuilder,
} from '../scenario-harness'

const scenario = () =>
    scenarioBuilder()
        .handler('library:query-genres', {
            kind: 'resolve',
            value: { rows: GENRE_ROWS, offset: 0, total: 2 },
        })
        .handler('library:get-genre-detail', { kind: 'resolve', value: createGenre() })
        .songs([
            createSongRow({
                title: 'Dawn',
                genreText: 'Ambient',
                genres: [{ id: 'ambient', name: 'Ambient' }],
            }),
        ])

test('genres show counts, filter by name and sort without adding history entries', async ({ page }) => {
    const controller = await createRendererScenario(page, scenario().build(), '/genres')
    const list = page.getByRole('region', { name: 'Genres', exact: true })
    await expect(list.getByRole('link', { name: /^Ambient/ })).toContainText('2 tracks')
    await expect(list.getByRole('link', { name: /^Techno/ })).toContainText('2 artists')
    const historyLength = await page.evaluate(() => history.length)
    await page.getByRole('button', { name: 'Sort genres Z to A' }).click()
    await expect
        .poll(async () => (await controller.lastCall('library:query-genres'))?.payload)
        .toMatchObject({ query: { sort: { field: 'name', direction: 'desc' } } })
    await page.getByRole('searchbox', { name: 'Search genres' }).fill('Techno')
    await expect
        .poll(async () => (await controller.lastCall('library:query-genres'))?.payload)
        .toMatchObject({ query: { search: 'Techno' } })
    expect(await page.evaluate(() => history.length)).toBe(historyLength)
})

test('genre windows support keyboard jumps and bounded scrolling', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenario()
            .handler('library:query-genres', respond(page, 'genre-catalog', genreCatalog))
            .build(),
        '/genres',
    )
    const list = page.getByRole('region', { name: 'Genres', exact: true })
    await expect(list.getByRole('link', { name: /^Genre 0 / })).toBeVisible()
    await list.focus()
    await page.keyboard.press('End')
    await expect(list.getByRole('link', { name: /^Genre 9999 / })).toBeFocused()
    await expect
        .poll(async () => (await controller.lastCall('library:query-genres'))?.payload)
        .toMatchObject({ window: { offset: expect.any(Number) } })
    expect(await list.getByRole('link').count()).toBeLessThan(100)
    await page.keyboard.press('Home')
    await expect(list.getByRole('link', { name: /^Genre 0 / })).toBeFocused()
})

test('changing the query cancels a pending keyboard focus jump', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenario()
            .handler('library:query-genres', respond(page, 'genre-focus-catalog', genreCatalog))
            .build(),
        '/genres',
    )
    const list = page.getByRole('region', { name: 'Genres', exact: true })
    await expect(list.getByRole('link', { name: /^Genre 0 / })).toBeVisible()
    await controller.setHandler('library:query-genres', { kind: 'pending' })
    await list.focus()
    await page.keyboard.press('End')
    await expect
        .poll(async () => (await controller.lastCall('library:query-genres'))?.payload)
        .not.toMatchObject({ window: { offset: 0 } })
    await controller.setHandler('library:query-genres', respond(page, 'genre-focus-reset', genreCatalog))
    const search = page.getByRole('searchbox', { name: 'Search genres' })
    await search.fill('Genre')
    await expect
        .poll(async () => (await controller.lastCall('library:query-genres'))?.payload)
        .toMatchObject({ query: { search: 'Genre' } })
    await expect(list.getByRole('link', { name: /^Genre 0 / })).toBeVisible()
    await list.evaluate(element => element.scrollTo({ top: element.scrollHeight }))
    await expect(list.getByRole('link', { name: /^Genre 9999 / })).toBeVisible()
    await expect(search).toBeFocused()
})

test('genre detail sorts tracks and recovers a failed related list', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenario().handler('library:query-genre-related', { kind: 'pending' }).build(),
        '/genres/ambient',
    )
    await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()
    await page.getByRole('button', { name: 'Sort by Title' }).click()
    await expect
        .poll(async () => (await controller.lastCall('library:query-songs'))?.payload)
        .toMatchObject({ query: { sort: { field: 'title' }, filter: { genreIds: ['ambient'] } } })
    await page.getByRole('link', { name: /^Artists / }).click()
    await expect(page.getByText('Loading artists…')).toBeVisible()
    await controller.resolveAllPending('library:query-genre-related', { rows: [], total: 0, offset: 0 })
    await expect(page.getByText('No artists linked to this genre')).toBeVisible()
    await controller.setHandler('library:query-genre-related', { kind: 'reject', message: 'Unavailable' })
    await page.getByRole('link', { name: /^Record labels / }).click()
    await expect(page.getByText('Could not load record labels for this genre')).toBeVisible()
    await controller.setHandler('library:query-genre-related', {
        kind: 'resolve',
        value: { rows: [{ id: 'label-1', name: 'Kosmische' }], offset: 0, total: 1 },
    })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(
        page.getByRole('region', { name: 'Record labels' }).getByRole('link', { name: 'Kosmische' }),
    ).toBeVisible()
})

test('shows genreText verbatim with a detail link for each resolved genre', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenarioBuilder()
            .songs([
                createSongRow({
                    genreText: 'Techno; Ambient',
                    genres: [
                        { id: 'techno', name: 'Techno' },
                        { id: 'ambient', name: 'Ambient' },
                    ],
                }),
            ])
            .build(),
        '/tracks',
    )
    await expect(page.getByText('Techno; Ambient', { exact: true })).toBeVisible()
    const ambient = page.getByRole('link', { name: 'View genre Ambient' })
    await expect(ambient).toHaveAttribute('href', '/genres/ambient')
    await expect(page.getByRole('link', { name: 'View genre Techno' })).toHaveAttribute(
        'href',
        '/genres/techno',
    )
    const previousQuery = (await controller.lastCall('library:query-songs'))?.payload
    await ambient.click({ modifiers: ['Shift'] })
    await expect(page).toHaveURL(/\/tracks$/)
    await expect(page.getByRole('row').filter({ has: ambient })).toHaveAttribute('aria-selected', 'true')
    expect((await controller.lastCall('library:query-songs'))?.payload).toEqual(previousQuery)
})

test('list loading, failures and retries have distinct states', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenario().handler('library:query-genres', { kind: 'pending' }).build(),
        '/genres',
    )
    await expect(page.getByText('Loading genres…')).toBeVisible()
    await controller.setHandler('library:query-genres', { kind: 'reject', message: 'Database unavailable' })
    await page.getByRole('searchbox', { name: 'Search genres' }).fill('Ambient')
    await expect(page.getByText('Database unavailable')).toBeVisible()
    await controller.setHandler('library:query-genres', {
        kind: 'resolve',
        value: { rows: GENRE_ROWS, total: 2, offset: 0 },
    })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('region', { name: 'Genres', exact: true })).toBeVisible()
})

test('empty genres explain that the library has none', async ({ page }) => {
    await createRendererScenario(page, scenarioBuilder().build(), '/genres')
    await expect(page.getByText('No genres yet')).toBeVisible()
})

test('a genre search with no matches can be cleared', async ({ page }) => {
    await createRendererScenario(page, scenarioBuilder().build(), '/genres?q=absent')
    await expect(page.getByText('No genres match these filters')).toBeVisible()
    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(page).toHaveURL(/\/genres$/)
})

test('detail failures retry and missing genres offer a way back', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenario().handler('library:get-genre-detail', { kind: 'reject', message: 'Offline' }).build(),
        '/genres/ambient',
    )
    await expect(page.getByText('Could not load this genre')).toBeVisible()
    await controller.setHandler('library:get-genre-detail', { kind: 'resolve', value: null })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByText('This genre is no longer in your library')).toBeVisible()
    await page.getByRole('link', { name: 'Back to genres' }).click()
    await expect(page).toHaveURL(/\/genres$/)
})

test('same-route navigation cannot retain another genre’s tracks', async ({ page }) => {
    const controller = await createRendererScenario(page, scenario().build(), '/genres/ambient')
    await expect(page.getByText('Dawn', { exact: true })).toBeVisible()
    await controller.updateState({
        'library:get-genre-detail': { kind: 'resolve', value: createGenre({ id: 'techno', name: 'Techno' }) },
        'library:query-songs': { kind: 'pending' },
    })
    await page.evaluate(() => {
        history.pushState(null, '', '/genres/techno')
        dispatchEvent(new PopStateEvent('popstate'))
    })
    await expect(page.getByRole('heading', { name: 'Techno' })).toBeVisible()
    await expect(page.getByText('Dawn', { exact: true })).toBeHidden()
    await expect(page.getByText('Loading tracks…')).toBeVisible()
})

test('Back restores a deep genre window after a delayed response', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenario()
            .handler('library:query-genres', respond(page, 'genre-catalog', genreCatalog))
            .build(),
        '/genres',
    )
    const list = page.getByRole('region', { name: 'Genres', exact: true })
    await expect(list.getByRole('link', { name: /^Genre 0 / })).toBeVisible()
    await list.evaluate(element => element.scrollTo({ top: 200_000 }))
    await expect(list.getByRole('link', { name: /^Genre 5000 / })).toBeVisible()
    const scrollTop = await list.evaluate(element => element.scrollTop)
    await list.getByRole('link', { name: /^Genre 5000 / }).click()
    await expect(page.getByRole('heading', { name: 'Ambient' })).toBeVisible()
    await controller.setHandler('library:query-genres', { kind: 'pending' })
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await expect(page.getByText('Loading genres…')).toBeVisible()
    await controller.resolveAllPending('library:query-genres', {
        offset: 4980,
        total: 10_000,
        rows: Array.from({ length: 70 }, (_, i) =>
            createGenre({ id: `genre-${4980 + i}`, name: `Genre ${4980 + i}` }),
        ),
    })
    await expect.poll(() => list.evaluate(element => element.scrollTop)).toBe(scrollTop)
    await expect(list.getByRole('link', { name: /^Genre 5000 / })).toBeVisible()
})

test('genre albums use the shared grid and recover after a failed load', async ({ page }) => {
    const controller = await createRendererScenario(
        page,
        scenario().handler('library:query-albums', { kind: 'pending' }).build(),
        '/genres/ambient?section=albums',
    )
    await expect(page.getByText('Loading albums…')).toBeVisible()
    await controller.resolveAllPending('library:query-albums', { rows: [], total: 0, offset: 0 })
    await expect(page.getByText('No albums linked to this genre')).toBeVisible()
    await controller.setHandler('library:query-albums', { kind: 'reject', message: 'Unavailable' })
    await page
        .getByRole('navigation', { name: 'Genre sections' })
        .getByRole('link', { name: /^Tracks / })
        .click()
    await page.getByRole('link', { name: /^Albums / }).click()
    await expect(page.getByText('Could not load albums for this genre')).toBeVisible()
    await controller.setHandler('library:query-albums', {
        kind: 'resolve',
        value: { rows: [createAlbumRow()], offset: 0, total: 1 },
    })
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(page.getByRole('grid', { name: 'Albums' })).toBeVisible()
    await expect
        .poll(async () => (await controller.lastCall('library:query-albums'))?.payload)
        .toMatchObject({ query: { filter: { genreIds: ['ambient'] } } })
    await page.getByLabel('Sort by').selectOption('title')
    await expect
        .poll(async () => (await controller.lastCall('library:query-albums'))?.payload)
        .toMatchObject({ query: { sort: { field: 'title' }, filter: { genreIds: ['ambient'] } } })
})

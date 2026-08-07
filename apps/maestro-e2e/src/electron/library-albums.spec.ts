import { expect, test } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, ElectronApplication, Page } from 'playwright'
import { buildTaggedLibrary, type TaggedTrackSpec } from '../fixtures/tagged-library.fixture'

/**
 * The albums grid and the album detail page over a real scan.
 *
 * The renderer scenario suite already covers gestures, geometry and states against
 * mocked IPC. What only this can prove is that albums are actually *derived* by the
 * whole path — album grouping in ingest, the denormalized columns the write side
 * maintains, the browse query, the grid — and come back out as the right records with
 * the right track counts.
 *
 * Three of the grid's sortable columns are denormalized onto `albums` rather than counted
 * or joined per query (`track_count`, `record_label_text`, `date_added`), so this is also
 * the only test that can catch the write side failing to keep them true: a repository unit
 * test seeds them, and a scale check only explains the plan.
 */

const workspaceRoot = join(__dirname, '../../../..')
const electronMainPath = join(workspaceRoot, 'dist/apps/maestro-electron/main.js')

const cleanEnv = (): Record<string, string> => {
    const env = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] == 'string'),
    )
    delete env.ELECTRON_RUN_AS_NODE
    return env
}

const launchReleaseMaestro = async (appDataDir: string): Promise<ElectronApplication> =>
    electron.launch({
        args: [electronMainPath],
        cwd: workspaceRoot,
        env: {
            ...cleanEnv(),
            ELECTRON_IS_DEV: '1',
            RELEASE_MAESTRO_APP_DATA_DIR: appDataDir,
        },
    })

const stubFolderPicker = (app: ElectronApplication, directory: string): Promise<void> =>
    app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = (async () => ({
            canceled: false,
            filePaths: [dir],
            bookmarks: [],
        })) as typeof dialog.showOpenDialog
    }, directory)

let electronApp: ElectronApplication | undefined
let page: Page

test.afterEach(async () => {
    await electronApp?.close()
    electronApp = undefined
})

/** Onboard through a real scan of a library folder and land in the app. */
const onboardAndScan = async (
    appDataDir: string,
    libraryDir: string,
    importedTracks: string,
): Promise<void> => {
    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()

    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await stubFolderPicker(electronApp, libraryDir)
    await page.getByRole('button', { name: 'Add folders' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Your library is ready' })).toBeVisible()
    await expect(page.getByLabel('Imported tracks')).toHaveText(importedTracks)
    await page.getByRole('button', { name: 'Take me to my library' }).click()
}

const openAlbums = async (): Promise<void> => {
    await page.getByRole('link', { name: 'Albums' }).click()
    await expect(page).toHaveURL(/\/albums/)
    await expect(page.getByRole('grid', { name: 'Albums' })).toBeVisible()
}

/** Onboard through a real scan of the tagged fixture and land on `/albums`, in title order. */
const scanAndOpenAlbums = async (appDataDir: string, libraryDir: string): Promise<void> => {
    await onboardAndScan(appDataDir, libraryDir, '6')
    await openAlbums()

    // Off the default and onto title order, so everything downstream has a stable one to
    // assert. The default is date added, which comes from filesystem creation times —
    // real, but not what these tests are about. The one test that *is* about it puts the
    // grid back on it, and the track list's assertions sort for the same reason.
    await page.getByLabel('Sort by').selectOption('title')
    await expect.poll(albumTitles).toEqual(['Afterglow', 'Daybreak', 'Filaments', 'Undertow'])
}

/**
 * Album titles in render order, read from each tile's own text rather than its
 * `aria-label` — the label leads with the title but carries the artist and counts too,
 * which makes an ordering assertion read badly on failure.
 */
const albumTitles = (): Promise<string[]> =>
    page
        .locator('[role="gridcell"] a')
        .evaluateAll(tiles => tiles.map(tile => tile.querySelector('span > span')?.textContent?.trim() ?? ''))

/** The `#` cell of each track row, in render order. An em dash means the file carries none. */
const trackNumbers = (): Promise<string[]> =>
    page
        .locator('[role="row"][aria-selected] .song-table__track-number')
        .evaluateAll(cells => cells.map(cell => cell.textContent?.trim() ?? ''))

/** Track titles in render order, from the SongTable's row labels (`<title> by <artist>`). */
const trackTitles = (): Promise<string[]> =>
    page.getByRole('row').evaluateAll(rows =>
        rows
            .map(row => row.getAttribute('aria-label'))
            .filter((label): label is string => label != null)
            .map(label => label.split(' by ')[0] ?? ''),
    )

test('a scanned library becomes a browsable, sortable albums grid', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    await scanAndOpenAlbums(appDataDir, libraryDir)

    // Six tracks grouped into the fixture's four albums by `albumIdentityKey`.
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '4 albums' }),
    ).toBeVisible()
    await expect.poll(albumTitles).toEqual(['Afterglow', 'Daybreak', 'Filaments', 'Undertow'])

    // The album's own attributes came off the tags, through ingest, onto the tile.
    const daybreak = page.getByRole('link', { name: /^Daybreak/ })
    await expect(daybreak).toContainText('Aurora Fields')
    await expect(daybreak).toContainText('2019')
    // Two of the six tracks are on Daybreak — counted over the window against real
    // ingested songs, which nothing else in the suite can prove comes out right.
    await expect(daybreak).toContainText('2 tracks')
    await expect(page.getByRole('link', { name: /^Undertow/ })).toContainText('1 track')

    // Cover art comes from the content-addressed cache the scan populated, so this also
    // proves the path survives all the way to an img the renderer can load.
    await expect(daybreak.locator('img')).toHaveAttribute('src', /^file:\/\/.+/)
    await expect
        .poll(async () => daybreak.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath('albums-grid.png') })

    // Sorting runs in SQL, off the indexes the migration added.
    await page.getByLabel('Sort by').selectOption('year')
    await expect.poll(albumTitles).toEqual(['Filaments', 'Afterglow', 'Daybreak', 'Undertow'])

    // The record label is denormalized onto `albums` rather than joined per query, and the
    // write side is what fills it: Hardwire, Kosmische, then the two Saltmarsh albums.
    //
    // That last pair is compared as a set. The ORDER BY breaks a tie on `albums.id`, which
    // is a random UUID, so the order *within* a group of equal values is genuinely
    // arbitrary — asserting it would pass or fail on which UUIDs a given scan happened to
    // mint.
    await page.getByLabel('Sort by').selectOption('recordLabel')
    await expect.poll(async () => (await albumTitles()).slice(0, 2)).toEqual(['Afterglow', 'Daybreak'])
    expect((await albumTitles()).slice(2).sort()).toEqual(['Filaments', 'Undertow'])
})

/**
 * Two albums, three tracks, written **interleaved** — Ember, Cinder, Ember.
 *
 * The interleaving is the whole point. Ember's tracks bracket Cinder's one, so an album
 * dated by its *newest* track opens Ember first while one dated by its oldest opens
 * Cinder. The default fixture cannot tell those apart: its albums are written in
 * contiguous runs, so `MAX` and `MIN` produce the same order.
 *
 * `Cinder` before `Ember` alphabetically, so the expected order also rules out a grid
 * that quietly fell back to title.
 */
const INTERLEAVED_LIBRARY: TaggedTrackSpec[] = [
    {
        fileName: 'a-first.mp3',
        title: 'First',
        artist: 'Kiln',
        album: 'Ember',
        albumArtist: 'Kiln',
        year: 2020,
    },
    {
        fileName: 'b-only.mp3',
        title: 'Only',
        artist: 'Hearth',
        album: 'Cinder',
        albumArtist: 'Hearth',
        year: 2020,
    },
    {
        fileName: 'c-last.mp3',
        title: 'Last',
        artist: 'Kiln',
        album: 'Ember',
        albumArtist: 'Kiln',
        year: 2020,
    },
]

test('the grid opens on the album whose newest track arrived last', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    // Creation times, spaced by the fixture so each file lands in its own millisecond.
    // This is the one test here that leans on them; see `scanAndOpenAlbums`.
    const libraryDir = await buildTaggedLibrary(testInfo, INTERLEAVED_LIBRARY)

    await onboardAndScan(appDataDir, libraryDir, '3')
    await openAlbums()

    // No sort was chosen — this is the default, and it is `albums.date_added`, which
    // only exists because the ingest transaction wrote it. Nothing else in the suite
    // runs that code.
    await expect.poll(albumTitles).toEqual(['Ember', 'Cinder'])
    expect(new URL(page.url()).searchParams.get('sort')).toBeNull()

    await page.getByRole('button', { name: /^Sorted descending/ }).click()
    await expect.poll(albumTitles).toEqual(['Cinder', 'Ember'])
})

test('searching and filtering an albums grid runs against real SQL', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    await scanAndOpenAlbums(appDataDir, libraryDir)
    await expect.poll(albumTitles).toEqual(['Afterglow', 'Daybreak', 'Filaments', 'Undertow'])

    // Search reaches the album's title, its artist and its record label.
    await page.getByRole('searchbox', { name: 'Search albums' }).fill('saltmarsh')
    await expect.poll(albumTitles).toEqual(['Filaments', 'Undertow'])

    // And the track artists of its own songs, not only the credit on the sleeve.
    // `Void` on Afterglow is credited to "Night Cartel & Aurora Fields" while the album
    // is Night Cartel's, so Aurora Fields finds both the record she is the artist of and
    // the record she appears on — which is what someone typing a name is asking for.
    await page.getByRole('searchbox', { name: 'Search albums' }).fill('aurora')
    await expect.poll(albumTitles).toEqual(['Afterglow', 'Daybreak'])

    // And a genre, which is tagged per file and so reaches the record only this way.
    await page.getByRole('searchbox', { name: 'Search albums' }).fill('techno')
    await expect.poll(albumTitles).toEqual(['Afterglow'])

    // A song title is deliberately not searched — `Dawn` is a track on Daybreak, and
    // returning whole records for one track on them gives no clue which one matched.
    await page.getByRole('searchbox', { name: 'Search albums' }).fill('dawn')
    await expect(page.getByText('No albums match these filters')).toBeVisible()

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect.poll(albumTitles).toEqual(['Afterglow', 'Daybreak', 'Filaments', 'Undertow'])
})

test('an album detail page lists its own tracks in album order', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    await scanAndOpenAlbums(appDataDir, libraryDir)
    await expect.poll(albumTitles).toEqual(['Afterglow', 'Daybreak', 'Filaments', 'Undertow'])

    await page.getByRole('link', { name: /^Daybreak/ }).click()

    await expect(page).toHaveURL(/\/albums\/[0-9a-f-]+$/)
    await expect(page.getByRole('heading', { name: 'Daybreak', level: 1 })).toBeVisible()
    await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()

    // **Noon before Dawn.** The fixture numbers Daybreak's tracks against its file
    // names on purpose, so this ordering can only come from `trackNumber` — by path,
    // by title or by insertion order it would be Dawn first.
    await expect.poll(trackTitles).toEqual(['Noon', 'Dawn'])

    // And the numbers themselves, off the `TRCK` frames the fixture wrote — the whole
    // path from an ID3 tag to a cell, which only this layer runs.
    await expect.poll(trackNumbers).toEqual(['1', '2'])

    // The header's facts are the album's own, summed and collected over its songs.
    // `exact` because the table also keeps an sr-only "0 of 2 tracks selected" status.
    await expect(page.getByText('2 tracks', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Ambient' })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('album-detail.png') })

    // A column heading re-sorts the album's tracks rather than sitting inert.
    await page.getByRole('button', { name: 'Sort by Title' }).click()
    await expect.poll(trackTitles).toEqual(['Dawn', 'Noon'])
})

test('an album detail page links out to its artist and record label', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    await scanAndOpenAlbums(appDataDir, libraryDir)
    await page.getByRole('link', { name: /^Daybreak/ }).click()
    await expect(page.getByRole('heading', { name: 'Daybreak', level: 1 })).toBeVisible()

    // Until the artist page lands (MAE-120), the honest form of this link is the track
    // list scoped to that artist entity — and it has to resolve to real rows.
    await page.getByRole('link', { name: 'Aurora Fields' }).click()

    await expect(page).toHaveURL(/\/tracks\?.*artist=/)
    // Sorted rather than compared in order: the track list opens in its own default order
    // (date added), which comes from filesystem creation times and is not this test's
    // business. What matters is that the link resolved to exactly this artist's tracks.
    await expect.poll(async () => (await trackTitles()).sort()).toEqual(['Dawn', 'Noon'])
    await expect(page.getByRole('button', { name: /^Remove Artist filter Aurora Fields/ })).toBeVisible()
})

test('the track list reaches an album detail page through its album cell', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    await onboardAndScan(appDataDir, libraryDir, '6')

    await page.getByRole('link', { name: 'Tracks' }).click()
    await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()

    // MAE-118 made this cell filter the track list because the album page did not exist.
    // It does now, so the cell navigates — and the album it lands on is the right one.
    await page.getByRole('row').filter({ hasText: 'Dawn' }).getByRole('link', { name: 'Daybreak' }).click()

    await expect(page).toHaveURL(/\/albums\/[0-9a-f-]+$/)
    await expect(page.getByRole('heading', { name: 'Daybreak', level: 1 })).toBeVisible()
})

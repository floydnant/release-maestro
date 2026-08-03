import { expect, test } from '@playwright/test'
import { mkdir, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { _electron as electron, ElectronApplication, Page } from 'playwright'
import { buildTaggedLibrary } from '../fixtures/tagged-library.fixture'

/**
 * The track list over a real scan.
 *
 * The renderer scenario suite already covers gestures and states against mocked IPC.
 * What only this can prove is that tags survive the whole path — metadata engine,
 * ingest, SQLite, the browse query, the table — and come back out as the right
 * values in the right cells, sorted and filtered by real SQL.
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

/** Onboard through a real scan of the tagged fixture and land on `/tracks`. */
const scanAndOpenTracks = async (appDataDir: string, libraryDir: string): Promise<void> => {
    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()

    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await stubFolderPicker(electronApp, libraryDir)
    await page.getByRole('button', { name: 'Add folders' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Your library is ready' })).toBeVisible()
    await expect(page.getByLabel('Imported tracks')).toHaveText('6')
    await page.getByRole('button', { name: 'Take me to my library' }).click()

    await page.getByRole('link', { name: 'Tracks' }).click()
    await expect(page).toHaveURL(/\/tracks/)
    await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()
}

/**
 * Row titles in render order, read from `aria-label` (`<title> by <artist>`). Only
 * body rows carry one, so the header excludes itself.
 *
 * Read in a single `evaluateAll` rather than element by element: the table re-renders
 * whenever a window lands, and reading attributes one at a time can catch a row
 * mid-swap and throw on a detached node.
 */
const rowTitles = (): Promise<string[]> =>
    page
        .locator('[role="row"][aria-label]')
        .evaluateAll(rows => rows.map(row => (row.getAttribute('aria-label') ?? '').split(' by ')[0] ?? ''))

test('a scanned library is browsable, sortable and filterable end to end', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    await scanAndOpenTracks(appDataDir, libraryDir)

    // Every scanned track is counted, and the tags made it through intact.
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '6 tracks' }),
    ).toBeVisible()
    const dawn = page.getByRole('row').filter({ hasText: 'Dawn' })
    await expect(dawn).toContainText('Aurora Fields')
    await expect(dawn).toContainText('Daybreak')
    await expect(dawn).toContainText('Ambient')
    await expect(dawn).toContainText('Kosmische')
    await expect(dawn).toContainText('2019')
    await expect(dawn).toContainText('120')
    await expect(dawn).toContainText('8A')
    // Cover art comes from the content-addressed cache the scan populated, so this
    // also proves the path survives all the way to an img the renderer can load.
    await expect(dawn.locator('img')).toHaveAttribute('src', /^file:\/\/.+/)
    await expect
        .poll(async () => dawn.locator('img').evaluate((img: HTMLImageElement) => img.naturalWidth))
        .toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath('tracks-list.png') })

    // A two-name credit is one artist entity today (MAE-97 owns splitting), and the
    // table prints the tag verbatim rather than inventing a separator.
    await expect(
        page.getByRole('button', { name: 'Night Cartel & Aurora Fields', exact: true }),
    ).toBeVisible()

    // Sorting runs in SQL against the real index.
    await page.getByRole('button', { name: 'Sort by BPM' }).click()
    await expect.poll(rowTitles).toEqual(['Gleam', 'Dusk', 'Void', 'Noon', 'Dawn', 'Tide'])

    await page.getByRole('button', { name: 'Sort by BPM' }).click()
    await expect.poll(rowTitles).toEqual(['Tide', 'Dawn', 'Noon', 'Void', 'Dusk', 'Gleam'])

    await page.getByRole('button', { name: 'Sort by Title' }).click()
    await expect.poll(rowTitles).toEqual(['Dawn', 'Dusk', 'Gleam', 'Noon', 'Tide', 'Void'])
})

test('search and entity filters narrow a real library', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    await scanAndOpenTracks(appDataDir, libraryDir)

    // Search reaches title, artist, album and record label alike.
    await page.getByRole('searchbox', { name: 'Search tracks' }).fill('afterglow')
    await expect.poll(rowTitles).toEqual(expect.arrayContaining(['Dusk', 'Void']))
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '2 tracks' }),
    ).toBeVisible()

    await page.getByRole('searchbox', { name: 'Search tracks' }).fill('')
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '6 tracks' }),
    ).toBeVisible()

    // Clicking a genre cell filters by the genre *entity*, and the chip names it.
    await page.getByRole('button', { name: 'Techno', exact: true }).first().click()
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '2 tracks' }),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: /Remove Genre filter Techno/ })).toBeVisible()

    await page.getByRole('button', { name: /Remove Genre filter Techno/ }).click()
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '6 tracks' }),
    ).toBeVisible()

    // A record label reaches songs through their album — songs carry no record
    // label of their own.
    await page.getByRole('button', { name: 'Saltmarsh', exact: true }).first().click()
    await expect.poll(rowTitles).toEqual(expect.arrayContaining(['Tide', 'Gleam']))
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '2 tracks' }),
    ).toBeVisible()
})

test('a filter that matches nothing says so instead of looking empty', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    await scanAndOpenTracks(appDataDir, libraryDir)

    await page.getByRole('searchbox', { name: 'Search tracks' }).fill('no such track exists')

    await expect(page.getByText('No tracks match these filters')).toBeVisible()

    await page.getByRole('button', { name: 'Clear filters' }).click()
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '6 tracks' }),
    ).toBeVisible()
})

test('tracks whose files went away stay listed, marked, and can be scoped to', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    await scanAndOpenTracks(appDataDir, libraryDir)
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '6 tracks' }),
    ).toBeVisible()

    // Take two files away and let the startup rescan reconcile them to missing —
    // the same thing an unplugged drive does, which is the case the DJ cares about.
    await electronApp?.close()
    await rm(join(libraryDir, '05-tide.mp3'))
    await rm(join(libraryDir, '06-gleam.mp3'))

    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('link', { name: 'Library', exact: true }).click()
    await expect(page.getByLabel('Latest scan result')).toContainText('Completed', { timeout: 20_000 })

    await page.getByRole('link', { name: 'Tracks' }).click()
    await expect(page.getByRole('grid', { name: 'Tracks' })).toBeVisible()

    // Missing tracks are included by default: the count does not drop.
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '6 tracks' }),
    ).toBeVisible()
    await expect(page.getByRole('row').filter({ hasText: 'Tide' })).toHaveAttribute('aria-label', /missing/i)
    await expect(page.getByRole('row').filter({ hasText: 'Dawn' })).not.toHaveAttribute(
        'aria-label',
        /missing/i,
    )
    await page.screenshot({ path: testInfo.outputPath('tracks-missing.png') })

    // The badge on a missing row is the entry point to the availability filter — it
    // exists exactly when there is something to filter for.
    await page.getByRole('button', { name: 'Missing — show only missing tracks' }).first().click()
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '2 tracks' }),
    ).toBeVisible()
    await expect.poll(rowTitles).toEqual(expect.arrayContaining(['Tide', 'Gleam']))

    // Removing the chip is the only way back out, and it restores the full list.
    await page.getByRole('button', { name: 'Remove Availability filter Missing' }).click()
    await expect(
        page.getByRole('status', { name: 'Result count' }).filter({ hasText: '6 tracks' }),
    ).toBeVisible()
})

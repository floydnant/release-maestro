import { expect, test } from '@playwright/test'
import { ElectronApplication, Page } from 'playwright'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { buildTaggedLibrary } from '../fixtures/tagged-library.fixture'
import { launchReleaseMaestro } from './launch-release-maestro'

/** Replace the native folder picker with a stub returning the given directory. */
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

test('first run gates into onboarding, imports a library, and shows the cover mosaic', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)

    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()

    // With no configured folders, the guard routes straight into onboarding.
    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await expect(page).toHaveURL(/\/import$/)
    await expect(page.getByRole('button', { name: 'Continue' })).toBeDisabled()

    await stubFolderPicker(electronApp, libraryDir)
    await page.getByRole('button', { name: 'Add folders' }).click()
    await expect(page.getByText(libraryDir)).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('import-pick.png') })
    await page.getByRole('button', { name: 'Continue' }).click()

    // Scan finishes into the done step: the live stat tiles settle at their final
    // values (the "Imported" ticker lands on 6) and the mosaic is populated.
    await expect(page.getByRole('heading', { name: 'Your library is ready' })).toBeVisible()
    await expect(page.getByLabel('Imported tracks')).toHaveText('6')
    // 4 albums but only 3 distinct artworks (two share identical cover bytes) —
    // the content-addressed dedupe must collapse them to exactly 3 tiles.
    await expect
        .poll(async () => page.getByTestId('import-mosaic').locator('img').count(), { timeout: 10_000 })
        .toBe(3)
    await page.screenshot({ path: testInfo.outputPath('import-done.png') })

    await page.getByRole('button', { name: 'Take me to my library' }).click()
    await expect(page).toHaveURL(/\/home$/)

    // Settings → Library reflects the persisted folder and the session's terminal result.
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('link', { name: 'Library', exact: true }).click()
    await expect(page.getByText(libraryDir)).toBeVisible()
    await expect(page.getByLabel('Latest scan result')).toContainText('Completed')
    await expect(page.getByLabel('Latest scan result')).toContainText('6 imported')
    await expect(page.getByText(/Last completed scan: .*6 tracks/)).toBeVisible()

    // Relaunch: guard passes, startup rescan self-heals (all unchanged).
    await electronApp.close()
    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()
    await expect(page).toHaveURL(/\/home$/)
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('link', { name: 'Library', exact: true }).click()
    // The startup rescan produces a fresh terminal result (nothing new to import),
    // while the persisted aggregate still reports the library size.
    await expect(page.getByLabel('Latest scan result')).toContainText('Completed', { timeout: 20_000 })
    await expect(page.getByText(/Last completed scan: .*6 tracks/)).toBeVisible({ timeout: 20_000 })
})

test('failed files surface in Library Settings, linked from onboarding', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo)
    // A garbage "audio" file: discovered by extension, fails the metadata read.
    await writeFile(join(libraryDir, 'zz-broken.mp3'), 'this is not audio')

    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()

    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await stubFolderPicker(electronApp, libraryDir)
    await page.getByRole('button', { name: 'Add folders' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    // The completion stat tiles count the import and the failure, and link to details.
    await expect(page.getByRole('heading', { name: 'Your library is ready' })).toBeVisible()
    await expect(page.getByLabel('Imported tracks')).toHaveText('6')
    await expect(page.getByLabel('Failed files count')).toHaveText('1')
    await page.getByRole('link', { name: 'View failed files' }).click()

    await expect(page).toHaveURL(/\/settings\/library$/)
    await expect(page.getByRole('heading', { name: 'Failed files' })).toBeVisible()
    const failedList = page.getByLabel('Failed files')
    await expect(failedList).toContainText('zz-broken.mp3')
    await expect(page.getByText('could not be imported.')).toBeVisible()
    await expect(page.getByLabel('Latest scan result')).toContainText('1 failed')
})

test('onboarding can be skipped and keeps nudging via the sidebar CTA', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })

    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()

    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await page.getByRole('button', { name: 'Skip for now' }).click()

    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByText("Your music library isn't set up yet.")).toBeVisible()

    // The CTA re-summons onboarding.
    await page.getByRole('link', { name: 'Set up library' }).click()
    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()

    // Skip persists across relaunches: no gate, CTA still nudges.
    await electronApp.close()
    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()
    await expect(page).toHaveURL(/\/home$/)
    await expect(page.getByText("Your music library isn't set up yet.")).toBeVisible()
})

test('library routes are available after onboarding is skipped', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })

    electronApp = await launchReleaseMaestro(appDataDir)
    page = await electronApp.firstWindow()

    await page.getByRole('button', { name: 'Skip for now' }).click()

    await page.getByRole('link', { name: 'Tracks' }).click()
    await expect(page).toHaveURL(/\/tracks$/)
    await expect(page.getByRole('heading', { name: 'Tracks' })).toBeVisible()

    await page.getByRole('link', { name: 'Library settings' }).click()
    await expect(page).toHaveURL(/\/settings\/library$/)
    await expect(page.getByRole('heading', { name: 'Library folders' })).toBeVisible()

    await page.getByRole('link', { name: 'Set up library' }).click()
    await expect(page).toHaveURL(/\/import$/)
    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
})

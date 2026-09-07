import { expect, test, type TestInfo } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { ElectronApplication, Page } from 'playwright'
import { buildTaggedLibrary, cleanupTaggedLibraries } from '../fixtures/tagged-library.fixture'
import { GENRE_LIBRARY } from '../fixtures/genres.fixture'
import { launchReleaseMaestro } from './launch-release-maestro'

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

test.afterEach(async ({}, testInfo) => {
    try {
        await electronApp?.close()
    } finally {
        electronApp = undefined
        await cleanupTaggedLibraries(testInfo)
    }
})

/** Onboard through a real scan of a library folder and land in the app. */
const onboardAndScan = async (
    testInfo: TestInfo,
    appDataDir: string,
    libraryDir: string,
    importedTracks: string,
): Promise<void> => {
    electronApp = await launchReleaseMaestro(appDataDir, testInfo)
    page = await electronApp.firstWindow()

    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await stubFolderPicker(electronApp, libraryDir)
    await page.getByRole('button', { name: 'Add folders' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Your library is ready' })).toBeVisible()
    await expect(page.getByLabel('Imported tracks')).toHaveText(importedTracks)
    await page.getByRole('button', { name: 'Take me to my library' }).click()
}

test('scanned genres expose counts, tracks and related entities without splitting compound tags', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo, GENRE_LIBRARY)
    await onboardAndScan(testInfo, appDataDir, libraryDir, '8')
    await page.getByRole('link', { name: 'Genres', exact: true }).click()
    const list = page.getByRole('region', { name: 'Genres', exact: true })
    await expect(list.getByRole('link', { name: /^Ambient / })).toContainText('2 tracks')
    await expect(list.getByRole('link', { name: /^Ambient / })).toContainText('1 artist')
    await expect(list.getByRole('link', { name: /^Techno 2/ })).toContainText('2 artists')
    await expect(list.getByRole('link', { name: /^Techno; Ambient/ })).toContainText('1 track')
    const names = () => list.getByRole('link').allTextContents()
    const ascending = await names()
    await page.getByRole('button', { name: 'Sort genres Z to A' }).click()
    await expect.poll(names).toEqual([...ascending].reverse())
    await page.getByRole('searchbox', { name: 'Search genres' }).fill('Ambient')
    await expect(list.getByRole('link')).toHaveCount(2)
    await list.getByRole('link', { name: /^Ambient / }).click()
    await expect(page.getByRole('heading', { name: 'Ambient', level: 1 })).toBeVisible()
    await expect(page.getByRole('row').filter({ has: page.getByRole('gridcell') })).toHaveCount(2)
    await expect(page.getByRole('row', { name: /Dawn by/ })).toBeVisible()
    await expect(page.getByRole('row', { name: /Compound by/ })).toBeHidden()
    await page.getByRole('link', { name: 'Artists (1)', exact: true }).click()
    await expect(
        page.getByRole('region', { name: 'Artists' }).getByRole('link', { name: 'Aurora Fields' }),
    ).toBeVisible()
    await page.getByRole('region', { name: 'Artists' }).getByRole('link', { name: 'Aurora Fields' }).click()
    await expect(page).toHaveURL(/tracks.*genre=.*artist=/)
    await expect(page.getByRole('row').filter({ has: page.getByRole('gridcell') })).toHaveCount(2)
    await page.getByRole('button', { name: 'Back', exact: true }).click()
    await page.getByRole('link', { name: 'Albums (1)', exact: true }).click()
    await expect(
        page.getByRole('grid', { name: 'Albums' }).getByRole('link', { name: /^Daybreak/ }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Record labels (1)', exact: true }).click()
    await page.getByRole('region', { name: 'Record labels' }).getByRole('link', { name: 'Kosmische' }).click()
    await expect(page).toHaveURL(/tracks.*genre=.*recordLabel=/)
    await expect(page.getByRole('row').filter({ has: page.getByRole('gridcell') })).toHaveCount(2)
})

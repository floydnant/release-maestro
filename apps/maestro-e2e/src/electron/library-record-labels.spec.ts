import { expect, test, type TestInfo } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { ElectronApplication, Page } from 'playwright'
import {
    buildTaggedLibrary,
    cleanupTaggedLibraries,
    DEFAULT_LIBRARY,
} from '../fixtures/tagged-library.fixture'
import { launchReleaseMaestro } from './launch-release-maestro'

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

test('scanned record labels show derived stats and linked albums, tracks and artists', async ({}, testInfo: TestInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo, [
        ...DEFAULT_LIBRARY,
        {
            fileName: '07-surge.mp3',
            title: 'Surge',
            artist: 'Seafoam',
            album: 'High Tide',
            albumArtist: 'Shoreline Collective',
            year: 2025,
            recordLabel: 'Saltmarsh',
            genre: 'Dub',
        },
    ])
    electronApp = await launchReleaseMaestro(appDataDir, testInfo)
    page = await electronApp.firstWindow()
    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await electronApp.evaluate(({ dialog }, directory) => {
        dialog.showOpenDialog = (async () => ({
            canceled: false,
            filePaths: [directory],
            bookmarks: [],
        })) as typeof dialog.showOpenDialog
    }, libraryDir)
    await page.getByRole('button', { name: 'Add folders' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Your library is ready' })).toBeVisible()
    await expect(page.getByLabel('Imported tracks')).toHaveText('7')
    await page.getByRole('button', { name: 'Take me to my library' }).click()
    await page.getByRole('link', { name: 'Record labels', exact: true }).click()
    const list = page.getByRole('region', { name: 'Record labels', exact: true })
    await expect(list.getByRole('link', { name: /^Saltmarsh/ })).toContainText('3 albums')
    await expect(list.getByRole('link', { name: /^Saltmarsh/ })).toContainText('2017–2025')
    await list.getByRole('link', { name: /^Saltmarsh/ }).click()
    await expect(page.getByRole('heading', { name: 'Saltmarsh' })).toBeVisible()
    await expect(page.getByRole('row', { name: /Surge by/ })).toBeVisible()
    await page.getByRole('link', { name: 'Albums 3' }).click()
    await expect(
        page.getByRole('grid', { name: 'Albums' }).getByRole('link', { name: /^High Tide/ }),
    ).toBeVisible()
    await page.getByRole('link', { name: 'Artists 3' }).click()
    await expect(
        page.getByRole('region', { name: 'Artists' }).getByRole('link', { name: 'Shoreline Collective' }),
    ).toBeVisible()
    await page
        .getByRole('region', { name: 'Artists' })
        .getByRole('link', { name: 'Shoreline Collective' })
        .click()
    await expect(page).toHaveURL(/albums.*recordLabel=.*albumArtist=/)
    await expect(
        page.getByRole('grid', { name: 'Albums' }).getByRole('link', { name: /^High Tide/ }),
    ).toBeVisible()
})

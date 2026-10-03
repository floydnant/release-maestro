import { expect, test, type TestInfo } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { ElectronApplication, Page } from 'playwright'
import {
    buildTaggedLibrary,
    cleanupTaggedLibraries,
    DEFAULT_LIBRARY,
} from '../fixtures/tagged-library.fixture'
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

const onboardAndScan = async (
    testInfo: TestInfo,
    appDataDir: string,
    libraryDir: string,
    importedTracks = 7,
): Promise<void> => {
    electronApp = await launchReleaseMaestro(appDataDir, testInfo)
    page = await electronApp.firstWindow()
    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await stubFolderPicker(electronApp, libraryDir)
    await page.getByRole('button', { name: 'Add folders' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Your library is ready' })).toBeVisible()
    await expect(page.getByLabel('Imported tracks')).toHaveText(String(importedTracks))
    await page.getByRole('button', { name: 'Take me to my library' }).click()
}

test('scanned artists keep the compound tag whole and separate albums from appearances', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo, [
        ...DEFAULT_LIBRARY,
        {
            fileName: '07-guest.mp3',
            title: 'Guest',
            artist: 'Aurora Fields',
            album: 'Afterglow',
            albumArtist: 'Night Cartel',
            year: 2021,
            recordLabel: 'Hardwire',
            genre: 'Techno',
            trackNumber: 4,
            cover: 'blue',
        },
    ])
    await onboardAndScan(testInfo, appDataDir, libraryDir)
    await page.getByRole('link', { name: 'Artists', exact: true }).click()
    const list = page.getByRole('region', { name: 'Artists', exact: true })
    await expect(list.getByRole('link', { name: /^Night Cartel & Aurora Fields/ })).toBeVisible()
    await expect(list.getByRole('link', { name: /^Aurora Fields/ })).toContainText('3 tracks')
    await list.getByRole('link', { name: /^Aurora Fields/ }).click()
    await expect(page.getByRole('heading', { name: 'Aurora Fields' })).toBeVisible()
    await expect(
        page.getByRole('grid', { name: 'Albums' }).getByRole('link', { name: /^Daybreak/ }),
    ).toBeVisible()
    await expect(
        page.getByRole('grid', { name: 'Albums' }).getByRole('link', { name: /^Afterglow/ }),
    ).toHaveCount(0)
    await page.getByRole('link', { name: /^All tracks/ }).click()
    await expect(
        page.getByRole('grid', { name: 'Tracks' }).getByRole('row', { name: /Guest by/ }),
    ).toBeVisible()
    await page.getByRole('link', { name: /^Released on record labels/ }).click()
    await expect(
        page.getByRole('region', { name: 'Record labels' }).getByRole('link', { name: 'Kosmische' }),
    ).toBeVisible()
    await expect(
        page.getByRole('region', { name: 'Record labels' }).getByRole('link', { name: 'Hardwire' }),
    ).toHaveCount(0)
    await page.getByRole('link', { name: /^Appears on/ }).click()
    await expect(
        page.getByRole('grid', { name: 'Albums' }).getByRole('link', { name: /^Afterglow/ }),
    ).toBeVisible()
    await expect(
        page.getByRole('grid', { name: 'Albums' }).getByRole('link', { name: /^Daybreak/ }),
    ).toHaveCount(0)
})

test('scanned Discogs IDs follow performer and record label credits', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo, [
        {
            fileName: 'references.mp3',
            title: 'Reference song',
            artist: 'Performer',
            album: 'Compilation',
            albumArtist: 'Various Artists',
            recordLabel: 'Reference Records',
            customTags: [
                ['DISCOGS_ARTIST_ID', '456'],
                ['DISCOGS_LABEL_ID', '789'],
            ],
        },
    ])
    await onboardAndScan(testInfo, appDataDir, libraryDir, 1)
    await page.getByRole('link', { name: 'Artists', exact: true }).click()
    const artists = page.getByRole('region', { name: 'Artists', exact: true })
    await artists.getByRole('link', { name: /^Performer/ }).click()
    await expect(page.getByRole('heading', { name: 'Performer' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Discogs' })).toHaveAttribute(
        'href',
        'https://www.discogs.com/artist/456',
    )
    await page.getByRole('link', { name: 'Artists', exact: true }).click()
    await artists.getByRole('link', { name: /^Various Artists/ }).click()
    await expect(page.getByRole('heading', { name: 'Various Artists' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Discogs' })).toHaveCount(0)
    await page.getByRole('link', { name: 'Record labels', exact: true }).click()
    await page
        .getByRole('region', { name: 'Record labels', exact: true })
        .getByRole('link', { name: /^Reference Records/ })
        .click()
    await expect(page.getByRole('heading', { name: 'Reference Records' })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Discogs' })).toHaveAttribute(
        'href',
        'https://www.discogs.com/label/789',
    )
})

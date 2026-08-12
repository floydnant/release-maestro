import { expect, test } from '@playwright/test'
import { ElectronApplication, Page } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { buildTaggedLibrary } from '../fixtures/tagged-library.fixture'
import type { TaggedTrackSpec } from '../fixtures/tagged-library.fixture'
import { launchReleaseMaestro as launch } from './launch-release-maestro'

const colors = ['red', 'green', 'blue', 'gold'] as const

/** Large enough that the deep-read phase is observable (and cancellable) mid-flight. */
const bigLibrary = (count: number): TaggedTrackSpec[] =>
    Array.from({ length: count }, (_, i) => ({
        fileName: `track-${String(i).padStart(4, '0')}.mp3`,
        title: `Track ${i}`,
        artist: `Artist ${i % 25}`,
        album: `Album ${i}`,
        cover: colors[i % colors.length],
    }))

let app: ElectronApplication | undefined

test.afterEach(async () => {
    await app?.close()
    app = undefined
})

test('cancelling an import mid-scan self-heals via the startup rescan', async ({}, testInfo) => {
    test.setTimeout(240_000)
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo, bigLibrary(1500), 100_000)

    app = await launch(appDataDir, testInfo)
    let page: Page = await app.firstWindow()

    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir], bookmarks: [] })) as never
    }, libraryDir)
    await page.getByRole('button', { name: 'Add folders' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Importing your library' })).toBeVisible()
    await expect(page.getByText(/Reading tracks…/)).toBeVisible({ timeout: 30_000 })

    // Cancel as soon as the deep-read phase is observable. Waiting on diagnostic work here lets a
    // fast scan replace the button between an isVisible() check and click(), especially on Windows.
    const cancelButton = page.getByRole('button', { name: 'Cancel import' })
    await expect(cancelButton).toBeVisible()
    await cancelButton.click()
    await expect(page.getByText(/Import cancelled/).first()).toBeVisible({ timeout: 20_000 })
    await expect(page.getByRole('button', { name: 'Retry import' })).toBeVisible()

    // Relaunch: folders are configured, so the guard passes and the startup
    // rescan finishes what the cancelled import left behind.
    await app.close()
    app = await launch(appDataDir, testInfo)
    page = await app.firstWindow()
    await expect(page).toHaveURL(/\/home$/)
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('link', { name: 'Library', exact: true }).click()
    await expect(page.getByText(/Last completed scan: .*1500 tracks/)).toBeVisible({
        timeout: 120_000,
    })

    await app.close()
    app = undefined
})

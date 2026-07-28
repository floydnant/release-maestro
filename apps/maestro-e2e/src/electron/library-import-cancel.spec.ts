import { expect, test } from '@playwright/test'
import { _electron as electron, ElectronApplication, Page } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { buildTaggedLibrary } from '../fixtures/tagged-library.fixture'
import type { TaggedTrackSpec } from '../fixtures/tagged-library.fixture'

const workspaceRoot = join(__dirname, '../../../..')
const electronMainPath = join(workspaceRoot, 'dist/apps/maestro-electron/main.js')

const cleanEnv = (): Record<string, string> => {
    const env = Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => typeof entry[1] == 'string'),
    )
    delete env.ELECTRON_RUN_AS_NODE
    return env
}

const launch = async (appDataDir: string): Promise<ElectronApplication> =>
    electron.launch({
        args: [electronMainPath],
        cwd: workspaceRoot,
        env: { ...cleanEnv(), ELECTRON_IS_DEV: '1', RELEASE_MAESTRO_APP_DATA_DIR: appDataDir },
    })

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

test('cancelling an import mid-scan self-heals via the startup rescan', async ({}, testInfo) => {
    test.setTimeout(240_000)
    const appDataDir = testInfo.outputPath('app-data')
    await mkdir(appDataDir, { recursive: true })
    const libraryDir = await buildTaggedLibrary(testInfo, bigLibrary(1500), 100_000)

    let app = await launch(appDataDir)
    let page: Page = await app.firstWindow()

    await expect(page.getByRole('heading', { name: 'Set up your music library' })).toBeVisible()
    await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [dir], bookmarks: [] })) as never
    }, libraryDir)
    await page.getByRole('button', { name: 'Add folders' }).click()
    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Importing your library' })).toBeVisible()
    await expect(page.getByText(/Reading tracks…/)).toBeVisible({ timeout: 30_000 })
    await page.screenshot({ path: testInfo.outputPath('import-mid-scan.png') })

    // The mosaic is DOM-capped to its (responsive) grid: at most 2 imgs per cell
    // (an entering cover plus the one it replaces), never one per scanned track.
    const mosaic = page.getByTestId('import-mosaic')
    const cellCount = await page.getByTestId('import-mosaic-cell').count()
    expect(cellCount).toBeGreaterThan(0)
    expect(await mosaic.locator('img').count()).toBeLessThanOrEqual(2 * cellCount)

    // Cancel mid-read; if the scan won the race and completed, the cancel branch is moot.
    const cancelButton = page.getByRole('button', { name: 'Cancel import' })
    if (await cancelButton.isVisible()) {
        await cancelButton.click()
        await expect(page.getByText(/Import cancelled/).first()).toBeVisible({ timeout: 20_000 })
        await expect(page.getByRole('button', { name: 'Retry import' })).toBeVisible()
    }

    // Relaunch: folders are configured, so the guard passes and the startup
    // rescan finishes what the cancelled import left behind.
    await app.close()
    app = await launch(appDataDir)
    page = await app.firstWindow()
    await expect(page).toHaveURL(/\/home$/)
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('link', { name: 'Library', exact: true }).click()
    await expect(page.getByText(/Last completed scan: .*1500 tracks/)).toBeVisible({
        timeout: 120_000,
    })

    await app.close()
})

import { expect, test } from '@playwright/test'
import { fixtureCoverPath } from '../../fixtures/cover-art.fixture'
import { LibraryScanStatus, LibraryScanTerminalResult } from '@release-maestro/core'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

const completedStatus = (overrides: Partial<LibraryScanTerminalResult> = {}): LibraryScanStatus => {
    const terminal: LibraryScanTerminalResult = {
        outcome: 'completed',
        scanId: 1,
        trigger: 'onboarding',
        scannedFolders: [],
        startedAt: Date.now() - 1_000,
        finishedAt: Date.now(),
        discovered: 0,
        new: 0,
        changed: 0,
        unchanged: 0,
        missing: 0,
        unavailableFolders: [],
        readTotal: 0,
        readsAttempted: 0,
        imported: 0,
        discoveryFailureCount: 0,
        readFailureCount: 0,
        failures: [],
        failuresTruncated: false,
        normalizationIssues: 0,
        error: null,
        ...overrides,
    }

    return {
        scanId: terminal.scanId,
        revision: 1,
        trigger: terminal.trigger,
        phase: terminal.outcome,
        scannedFolders: terminal.scannedFolders,
        unavailableFolders: terminal.unavailableFolders,
        startedAt: terminal.startedAt,
        finishedAt: terminal.finishedAt,
        discovered: terminal.discovered,
        new: terminal.new,
        changed: terminal.changed,
        unchanged: terminal.unchanged,
        refreshTotal: 0,
        readDone: terminal.readsAttempted,
        readTotal: terminal.readTotal,
        imported: terminal.imported,
        failedFiles: terminal.discoveryFailureCount + terminal.readFailureCount,
        normalizationIssues: terminal.normalizationIssues,
        terminal,
    }
}

test('an unavailable onboarding folder reports missing tracks instead of claiming it is empty', async ({
    page,
}) => {
    const status = completedStatus({
        missing: 42,
        unavailableFolders: ['/usb/library'],
    })
    const scenario = scenarioBuilder()
        .settings({ library: { folders: ['/usb/library'] }, emailPluginConfig: {} })
        .handler('library:start-scan', { kind: 'resolve', value: status })
        .build()
    await createRendererScenario(page, scenario, '/import')

    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'Your library is ready' })).toBeVisible()
    await expect(page.getByLabel('Unavailable folders')).toContainText(
        'Could not reach /usb/library — 42 tracks are marked missing',
    )
    await expect(page.getByRole('heading', { name: 'No audio files found' })).toBeHidden()
})

test('a reachable folder with no supported files still shows the empty-folder result', async ({ page }) => {
    const scenario = scenarioBuilder()
        .settings({ library: { folders: ['/music'] }, emailPluginConfig: {} })
        .handler('library:start-scan', { kind: 'resolve', value: completedStatus() })
        .build()
    await createRendererScenario(page, scenario, '/import')

    await page.getByRole('button', { name: 'Continue' }).click()

    await expect(page.getByRole('heading', { name: 'No audio files found' })).toBeVisible()
})

test('the import dropzone and counters keep their original emphasis', async ({ page }) => {
    const status: LibraryScanStatus = {
        ...completedStatus({ discovered: 12, imported: 3, readTotal: 12, readsAttempted: 3 }),
        phase: 'reading',
        finishedAt: null,
        terminal: null,
    }
    await createRendererScenario(
        page,
        scenarioBuilder()
            .settings({ library: { folders: [] }, emailPluginConfig: {} })
            .handler('library:pick-folders', { kind: 'resolve', value: ['/music'] })
            .handler('library:validate-folders', { kind: 'resolve', value: [] })
            .handler('library:start-scan', { kind: 'resolve', value: status })
            .build(),
        '/import',
    )
    await expect(page.getByText('Drop folders here')).toHaveCSS('font-weight', '600')
    await page.getByRole('button', { name: 'Add folders', exact: true }).click()
    await expect(page.getByText('/music', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Importing your library' })).toBeVisible()
    await expect(page.getByLabel('Imported tracks')).toHaveText('3')
    // Counters are monospaced so their width holds steady while they count up.
    await expect(page.getByLabel('Imported tracks')).toHaveCSS('font-family', /monospace/)
    await expect(page.getByLabel('Failed files count')).toHaveCSS('font-family', /monospace/)
})

test('an inline spinner is exactly its ring and centres on the text beside it', async ({ page }) => {
    const status: LibraryScanStatus = {
        ...completedStatus({ discovered: 412 }),
        phase: 'discovering',
        finishedAt: null,
        terminal: null,
    }
    await createRendererScenario(
        page,
        scenarioBuilder()
            .settings({ library: { folders: ['/music'] }, emailPluginConfig: {} })
            .handler('library:start-scan', { kind: 'resolve', value: status })
            .build(),
        '/import',
    )
    await page.getByRole('button', { name: 'Continue' }).click()
    const line = page.getByText(/Discovering files/)
    await expect(line).toBeVisible()
    const geometry = await line.evaluate(element => {
        const ring = element.querySelector('app-progress-ring')?.getBoundingClientRect()
        const row = element.getBoundingClientRect()
        return (
            ring && { height: ring.height, offset: ring.top + ring.height / 2 - (row.top + row.height / 2) }
        )
    })
    expect(geometry?.height).toBeCloseTo(18, 0)
    expect(Math.abs(geometry?.offset ?? Infinity)).toBeLessThan(1)
})

test('the import page only goes dark once there is cover art to show behind it', async ({ page }) => {
    const status: LibraryScanStatus = {
        ...completedStatus({ discovered: 12, imported: 3, readTotal: 12, readsAttempted: 3 }),
        phase: 'reading',
        finishedAt: null,
        terminal: null,
    }
    const controller = await createRendererScenario(
        page,
        scenarioBuilder()
            .settings({ library: { folders: ['/music'] }, emailPluginConfig: {} })
            .handler('library:start-scan', { kind: 'resolve', value: status })
            .build(),
        '/import',
    )
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Importing your library' })).toBeVisible()

    const backdrop = page.locator('app-library-import > div').first()
    const canvas = await page.evaluate(() => getComputedStyle(document.body).backgroundColor)
    await expect(backdrop).toHaveCSS('background-color', canvas)

    await controller.emit('library:scan-status', {
        status: { ...status, revision: 2 },
        newAlbums: [{ albumTitle: 'Karasu', artist: 'Kodama', coverPath: fixtureCoverPath('karasu') }],
    })
    await expect(backdrop).toHaveCSS('background-color', 'rgb(0, 0, 0)')
})

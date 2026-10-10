import { expect, test } from '@playwright/test'
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

test('the import dropzone and counters retain their token typography', async ({ page }) => {
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
    await expect(page.getByText('Drop folders here')).toHaveCSS('font-weight', '400')
    await page.getByRole('button', { name: 'Add folders', exact: true }).click()
    await expect(page.getByText('/music', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Continue' }).click()
    await expect(page.getByRole('heading', { name: 'Importing your library' })).toBeVisible()
    await expect(page.getByLabel('Imported tracks')).toHaveText('3')
    const family = await page
        .getByRole('heading', { name: 'Importing your library' })
        .evaluate(element => getComputedStyle(element).fontFamily)
    await expect(page.getByLabel('Imported tracks')).toHaveCSS('font-family', family)
    await expect(page.getByLabel('Failed files count')).toHaveCSS('font-family', family)
})

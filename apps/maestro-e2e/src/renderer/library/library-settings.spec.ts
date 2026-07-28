// Failure-state UI matrix for Library Settings, driven through mocked IPC scenarios.
import { expect, test } from '@playwright/test'
import { LibraryScanStatus, LibraryScanTerminalResult } from '@release-maestro/core'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

const terminalResult = (overrides: Partial<LibraryScanTerminalResult> = {}): LibraryScanTerminalResult => ({
    outcome: 'completed',
    scanId: 1,
    trigger: 'startup',
    scannedFolders: ['/music'],
    startedAt: Date.now() - 60_000,
    finishedAt: Date.now() - 30_000,
    discovered: 10,
    new: 2,
    changed: 0,
    unchanged: 8,
    missing: 0,
    unavailableFolders: [],
    readTotal: 2,
    readsAttempted: 2,
    imported: 1,
    discoveryFailureCount: 0,
    readFailureCount: 1,
    failures: [
        {
            stage: 'read',
            path: '/music/albums/broken-track.mp3',
            code: 'PARSE_FAILED',
            message: 'Could not parse the audio stream',
        },
    ],
    failuresTruncated: false,
    normalizationIssues: 1,
    error: null,
    ...overrides,
})

const scanStatus = (terminal: LibraryScanTerminalResult): LibraryScanStatus => ({
    scanId: terminal.scanId,
    revision: 100,
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
    readDone: terminal.readsAttempted,
    readTotal: terminal.readTotal,
    imported: terminal.imported,
    failedFiles: terminal.discoveryFailureCount + terminal.readFailureCount,
    normalizationIssues: terminal.normalizationIssues,
    terminal,
})

test.describe('library settings scenarios', () => {
    // Rescanning with a drive unplugged is how its tracks get marked missing, so an
    // unreachable folder is reported but must never disable the rescan (ADR 0003).
    test('an unavailable folder is reported without blocking a rescan', async ({ page }) => {
        const scenario = scenarioBuilder()
            .settings({ library: { folders: ['/music', '/usb/library'] }, emailPluginConfig: {} })
            .handler('library:validate-folders', {
                kind: 'resolve',
                value: [
                    { path: '/music', canonicalPath: '/music', available: true },
                    {
                        path: '/usb/library',
                        canonicalPath: '/usb/library',
                        available: false,
                        error: 'Folder not found (is the drive connected?)',
                    },
                ],
            })
            .build()
        await createRendererScenario(page, scenario, '/settings/library')

        await expect(page.getByText(/Folder not found \(is the drive connected\?\)/)).toBeVisible()
        await expect(page.getByText('Its tracks are marked missing.')).toBeVisible()
        await expect(page.getByRole('button', { name: /Rescan now|Save and rescan/ })).toBeEnabled()
    })

    test('a nested folder is marked as skipped without blocking saves', async ({ page }) => {
        const scenario = scenarioBuilder()
            .settings({ library: { folders: ['/music', '/music/albums'] }, emailPluginConfig: {} })
            .handler('library:validate-folders', {
                kind: 'resolve',
                value: [
                    { path: '/music', canonicalPath: '/music', available: true },
                    {
                        path: '/music/albums',
                        canonicalPath: '/music/albums',
                        available: true,
                        nestedUnder: '/music',
                    },
                ],
            })
            .build()
        await createRendererScenario(page, scenario, '/settings/library')

        await expect(page.getByText(/Skipping, already covered by \/music/)).toBeVisible()
        await expect(page.getByRole('button', { name: /Rescan now|Save and rescan/ })).toBeEnabled()
    })

    test('failed files from the session terminal result are listed with details', async ({ page }) => {
        const terminal = terminalResult()
        const scenario = scenarioBuilder()
            .settings({ library: { folders: ['/music'] }, emailPluginConfig: {} })
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: scanStatus(terminal), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/settings/library')

        await expect(page.getByLabel('Latest scan result')).toContainText('Completed')
        await expect(page.getByLabel('Latest scan result')).toContainText('1 failed')

        await expect(page.getByRole('heading', { name: 'Failed files' })).toBeVisible()
        const failedList = page.getByLabel('Failed files')
        await expect(failedList).toContainText('broken-track.mp3')
        await expect(failedList).toContainText('Could not parse the audio stream')
        await expect(page.getByText('could not be imported.')).toBeVisible()
    })

    test('long settings content can be scrolled to the end', async ({ page }) => {
        await page.setViewportSize({ width: 1000, height: 500 })
        const failures: LibraryScanTerminalResult['failures'] = Array.from({ length: 20 }, (_, index) => ({
            stage: 'read' as const,
            path: `/music/albums/broken-track-${index + 1}.mp3`,
            code: 'PARSE_FAILED',
            message: `Could not parse audio stream ${index + 1}`,
        }))
        const terminal = terminalResult({
            failures,
            readFailureCount: failures.length,
        })
        const scenario = scenarioBuilder()
            .settings({ library: { folders: ['/music'] }, emailPluginConfig: {} })
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: scanStatus(terminal), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/settings/library')

        const lastFailure = page.getByText('broken-track-20.mp3')
        await expect(lastFailure).not.toBeInViewport()

        await page.getByRole('heading', { name: 'Library folders' }).hover()
        await page.mouse.wheel(0, 10_000)

        await expect(lastFailure).toBeInViewport()
    })

    test('after a relaunch only the persisted aggregate is shown', async ({ page }) => {
        const scenario = scenarioBuilder()
            .settings({ library: { folders: ['/music'] }, emailPluginConfig: {} })
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: {
                    status: null,
                    albums: [],
                    lastScan: {
                        count: 2,
                        total: 10,
                        errors: 1,
                        finishedAt: Date.now() - 3_600_000,
                        scannedFolders: ['/music'],
                    },
                },
            })
            .build()
        await createRendererScenario(page, scenario, '/settings/library')

        await expect(page.getByText(/Last scan: .*10 tracks/)).toBeVisible()
        await expect(page.getByRole('heading', { name: 'Failed files' })).toBeHidden()
    })

    test('a failed scan surfaces its structured terminal error', async ({ page }) => {
        const terminal = terminalResult({
            outcome: 'failed',
            imported: 0,
            failures: [],
            readFailureCount: 0,
            error: {
                code: 'SCAN_ERROR',
                message: 'The metadata engine stopped responding',
            },
        })
        const scenario = scenarioBuilder()
            .settings({ library: { folders: ['/music'] }, emailPluginConfig: {} })
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: scanStatus(terminal), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/settings/library')

        await expect(page.getByLabel('Latest scan result')).toContainText('Failed')
        await expect(page.getByText('The metadata engine stopped responding')).toBeVisible()
    })

    // An unreachable folder is not a failure: the scan completes over what it could
    // reach and the rest reconciles to missing, so the UI has to explain the count.
    test('an unreachable folder completes the scan and explains the missing tracks', async ({ page }) => {
        const terminal = terminalResult({
            outcome: 'completed',
            missing: 42,
            unavailableFolders: ['/usb/library'],
            failures: [],
            readFailureCount: 0,
        })
        const scenario = scenarioBuilder()
            .settings({
                library: { folders: ['/music', '/usb/library'] },
                emailPluginConfig: {},
            })
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: scanStatus(terminal), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/settings/library')

        await expect(page.getByLabel('Latest scan result')).toContainText('Completed')
        await expect(page.getByLabel('Latest scan result')).toContainText('42 missing')
        await expect(page.getByLabel('Unavailable folders')).toContainText('/usb/library')
    })
})

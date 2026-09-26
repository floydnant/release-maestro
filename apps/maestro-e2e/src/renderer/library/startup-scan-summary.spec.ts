import { expect, test } from '@playwright/test'
import { LibraryScanStatus, LibraryScanTerminalResult } from '@release-maestro/core'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

const completedStatus = (
    newSongs: number,
    changedSongs: number,
    trigger: LibraryScanStatus['trigger'] = 'startup',
    failedFiles = 0,
    missingSongs = 0,
): LibraryScanStatus => {
    const terminal: LibraryScanTerminalResult = {
        outcome: 'completed',
        scanId: 1,
        trigger,
        scannedFolders: ['/music'],
        startedAt: 1,
        finishedAt: 2,
        discovered: newSongs + changedSongs,
        new: newSongs,
        changed: changedSongs,
        unchanged: 0,
        missing: missingSongs,
        unavailableFolders: [],
        readTotal: newSongs + changedSongs,
        readsAttempted: newSongs + changedSongs,
        imported: newSongs + changedSongs - failedFiles,
        discoveryFailureCount: 0,
        readFailureCount: failedFiles,
        failures: [],
        failuresTruncated: false,
        normalizationIssues: 0,
        error: null,
    }
    return {
        ...terminal,
        revision: 2,
        phase: 'completed',
        finishedAt: terminal.finishedAt,
        readDone: terminal.readsAttempted,
        failedFiles,
        terminal,
    }
}

test.describe('startup scan summary', () => {
    for (const { newSongs, changedSongs, summary } of [
        { newSongs: 0, changedSongs: 0, summary: 'Nothing new' },
        { newSongs: 0, changedSongs: 2, summary: 'Updated 2 tracks' },
        { newSongs: 3, changedSongs: 1, summary: 'Added 3 tracks · Updated 1 track' },
    ]) {
        test(summary, async ({ page }) => {
            const scenario = scenarioBuilder()
                .handler('library:get-scan-status', {
                    kind: 'resolve',
                    value: { status: completedStatus(newSongs, changedSongs), albums: [], lastScan: null },
                })
                .build()
            await createRendererScenario(page, scenario, '/home')

            await expect(page.getByRole('status')).toHaveText(summary)
        })
    }

    test('does not claim failed reads were added', async ({ page }) => {
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: completedStatus(2, 0, 'startup', 1), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/home')

        await expect(page.getByRole('status')).toHaveText('Scan finished · 1 track failed')
    })

    test('reports missing tracks instead of saying nothing changed', async ({ page }) => {
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: completedStatus(0, 0, 'startup', 0, 5), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/home')

        await expect(page.getByRole('status')).toHaveText('5 tracks missing')
    })

    test('shows additions alongside missing tracks', async ({ page }) => {
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: completedStatus(2, 0, 'startup', 0, 3), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/home')

        await expect(page.getByRole('status')).toHaveText('Added 2 tracks · 3 tracks missing')
    })

    test('announces the result after paced progress, not each progress update', async ({ page }) => {
        const completed = completedStatus(1, 0)
        const reading: LibraryScanStatus = {
            ...completed,
            revision: 1,
            phase: 'reading',
            terminal: null,
            finishedAt: null,
            readDone: 0,
        }
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: reading, albums: [], lastScan: null },
            })
            .build()
        const controller = await createRendererScenario(page, scenario, '/home')

        await expect(page.locator('.scan-indicator')).toContainText('Reading')
        await expect(page.getByRole('status')).toBeEmpty()
        await controller.emit('library:scan-status', { status: completed, newAlbums: [] })
        await expect(page.getByRole('status')).toHaveText('Added 1 track')
    })

    test('manual scan completion does not show a startup summary', async ({ page }) => {
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: completedStatus(1, 0, 'manual'), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/home')

        await expect(page.locator('.scan-indicator')).toHaveCount(0)
    })
})

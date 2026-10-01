import { expect, test } from '@playwright/test'
import { LibraryScanStatus, LibraryScanTerminalResult } from '@release-maestro/core'
import { createRendererScenario, scenarioBuilder } from '../scenario-harness'

const completedStatus = (
    newSongs: number,
    changedSongs: number,
    trigger: LibraryScanStatus['trigger'] = 'startup',
    failedFiles = 0,
    missingSongs = 0,
    resumedReads = 0,
): LibraryScanStatus => {
    const terminal: LibraryScanTerminalResult = {
        outcome: 'completed',
        scanId: 1,
        trigger,
        scannedFolders: ['/music'],
        startedAt: 1,
        finishedAt: 2,
        discovered: newSongs + changedSongs + resumedReads,
        new: newSongs,
        changed: changedSongs,
        unchanged: resumedReads,
        missing: missingSongs,
        unavailableFolders: [],
        readTotal: newSongs + changedSongs + resumedReads,
        readsAttempted: newSongs + changedSongs + resumedReads,
        imported: newSongs + changedSongs + resumedReads - failedFiles,
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
    test('a startup scan can be cancelled from the title bar', async ({ page }) => {
        const reading: LibraryScanStatus = {
            ...completedStatus(0, 1),
            revision: 1,
            phase: 'reading',
            finishedAt: null,
            readDone: 0,
            terminal: null,
        }
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: reading, albums: [], lastScan: null },
            })
            .build()
        const controller = await createRendererScenario(page, scenario, '/home')

        const cancel = page.getByRole('button', { name: 'Cancel scan' })
        await expect(cancel).toBeVisible()
        await cancel.focus()
        await cancel.press('Enter')
        await expect.poll(async () => (await controller.calls('library:cancel-scan')).length).toBe(1)

        await controller.emit('library:scan-status', {
            status: { ...reading, revision: 2, phase: 'cancelled' },
            newAlbums: [],
        })
        await expect(cancel).toBeHidden()
        await expect(page.locator('header.title-bar')).toBeFocused()
    })

    test('hides the completed summary after four seconds', async ({ page }) => {
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: completedStatus(0, 0), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/home')

        const summary = page.getByRole('status')
        await expect(summary).toHaveText('Nothing new')
        await page.waitForTimeout(3000)
        await expect(summary).toHaveText('Nothing new')
        await expect(summary).toBeEmpty({ timeout: 2500 })
    })

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

    test('uses a muted check for an unchanged scan', async ({ page }) => {
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: completedStatus(0, 0), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/home')

        const icon = page.getByRole('status').locator('app-icon')
        await expect(icon).toHaveAttribute('name', 'success')
        await expect(icon).toHaveAttribute('color', 'content.secondary')
    })

    test('counts a resumed metadata read as an update', async ({ page }) => {
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: completedStatus(0, 0, 'startup', 0, 0, 1), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/home')

        await expect(page.getByRole('status')).toHaveText('Updated 1 track')
    })

    test('keeps the completed icon aligned with the running indicator', async ({ page }) => {
        const completed = completedStatus(0, 0)
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

        const running = page.locator('.scan-indicator')
        await expect(running).toContainText('Reading')
        const runningLayout = await running.evaluate(element => {
            const ring = element.querySelector('app-progress-ring')
            if (!ring) throw new Error('Running scan ring is missing')
            const style = getComputedStyle(element)
            return {
                left: element.getBoundingClientRect().left,
                iconLeft: ring.getBoundingClientRect().left,
                iconWidth: ring.getBoundingClientRect().width,
                gap: style.columnGap,
                paddingLeft: style.paddingLeft,
            }
        })

        await controller.emit('library:scan-status', { status: completed, newAlbums: [] })
        const summary = page.getByRole('status')
        await expect(summary).toHaveText('Nothing new')
        const completedLayout = await summary.locator('span').evaluate(element => {
            const icon = element.querySelector('app-icon')
            if (!icon) throw new Error('Completed scan icon is missing')
            const style = getComputedStyle(element)
            return {
                left: element.getBoundingClientRect().left,
                iconLeft: icon.getBoundingClientRect().left,
                iconWidth: icon.getBoundingClientRect().width,
                gap: style.columnGap,
                paddingLeft: style.paddingLeft,
            }
        })

        expect(completedLayout).toEqual(runningLayout)
    })

    for (const { label, status, summary, icon, color } of [
        {
            label: 'successful new reads alongside a failed read',
            status: completedStatus(2, 0, 'startup', 1),
            summary: 'Read 1 track · 1 track failed',
            icon: 'success',
            color: 'content.success',
        },
        {
            label: 'successful updates alongside failed reads',
            status: completedStatus(0, 12, 'startup', 2),
            summary: 'Read 10 tracks · 2 tracks failed',
            icon: 'success',
            color: 'content.success',
        },
        {
            label: 'successful resumed reads alongside failures and missing tracks',
            status: completedStatus(0, 0, 'startup', 1, 3, 2),
            summary: 'Read 1 track · 1 track failed · 3 tracks missing',
            icon: 'success',
            color: 'content.success',
        },
        {
            label: 'all reads failed',
            status: completedStatus(2, 0, 'startup', 2),
            summary: 'Scan finished · 2 tracks failed',
            icon: 'error',
            color: 'content.danger',
        },
    ]) {
        test(label, async ({ page }) => {
            const scenario = scenarioBuilder()
                .handler('library:get-scan-status', {
                    kind: 'resolve',
                    value: { status, albums: [], lastScan: null },
                })
                .build()
            await createRendererScenario(page, scenario, '/home')

            const result = page.getByRole('status')
            await expect(result).toHaveText(summary)
            await expect(result.locator('app-icon')).toHaveAttribute('name', icon)
            await expect(result.locator('app-icon')).toHaveAttribute('color', color)
        })
    }

    test('reports missing tracks instead of saying nothing changed', async ({ page }) => {
        const scenario = scenarioBuilder()
            .handler('library:get-scan-status', {
                kind: 'resolve',
                value: { status: completedStatus(0, 0, 'startup', 0, 5), albums: [], lastScan: null },
            })
            .build()
        await createRendererScenario(page, scenario, '/home')

        await expect(page.getByRole('status')).toHaveText('5 tracks missing')
        await expect(page.getByRole('status').locator('app-icon')).toHaveAttribute('name', 'missingSong')
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

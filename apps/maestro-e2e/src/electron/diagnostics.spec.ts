import { expect, test } from '@playwright/test'
import { ElectronApplication } from 'playwright'
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { launchReleaseMaestro } from './launch-release-maestro'

let electronApp: ElectronApplication | undefined

test.afterEach(async () => {
    await electronApp?.close()
    electronApp = undefined
})

test('keeps renderer and worker events in a local log and exports them', async ({}, testInfo) => {
    const appDataDir = testInfo.outputPath('app-data')
    const exportPath = testInfo.outputPath('diagnostics.jsonl')
    const logPath = join(appDataDir, 'log', 'main.log')
    await mkdir(appDataDir, { recursive: true })

    electronApp = await launchReleaseMaestro(appDataDir, testInfo)
    const page = await electronApp.firstWindow()
    await page.getByRole('button', { name: 'Skip for now' }).click()
    await page.getByRole('link', { name: 'Settings' }).click()
    await page.getByRole('link', { name: 'Diagnostics' }).click()
    await expect(page.getByRole('heading', { name: 'Diagnostics' })).toBeVisible()

    const consoleMessages: string[] = []
    page.on('console', message => consoleMessages.push(message.text()))
    await page.getByRole('button', { name: 'Refresh preview' }).click()
    await expect
        .poll(() =>
            consoleMessages.some(message => message.includes('[diagnostics] diagnostics.preview.refreshed')),
        )
        .toBe(true)

    await page.evaluate(async () => {
        const electron = window.require('electron') as typeof import('electron')
        await electron.ipcRenderer.invoke('metadata:ping')
    })

    await expect
        .poll(async () => {
            const content = await readFile(logPath, 'utf8').catch(() => '')
            return content
                .trim()
                .split('\n')
                .filter(Boolean)
                .map(line => JSON.parse(line) as { source: string; event: string })
        })
        .toEqual(
            expect.arrayContaining([
                expect.objectContaining({ source: 'main', event: 'app.start' }),
                expect.objectContaining({ source: 'renderer', event: 'diagnostics.preview.refreshed' }),
                expect.objectContaining({ source: 'worker', event: 'engine.started' }),
            ]),
        )

    await electronApp.evaluate(({ dialog }, path) => {
        dialog.showSaveDialog = (async () => ({
            canceled: false,
            filePath: path,
        })) as typeof dialog.showSaveDialog
    }, exportPath)
    await writeFile(exportPath, 'old export')
    if (process.platform !== 'win32') await chmod(exportPath, 0o644)
    await page.getByRole('button', { name: 'Export diagnostics' }).click()
    await expect(page.getByRole('status', { name: 'Diagnostics export' })).toContainText(
        'Saved diagnostics to',
    )

    const exported = (await readFile(exportPath, 'utf8')).trim().split('\n')
    if (process.platform !== 'win32') expect((await stat(exportPath)).mode & 0o777).toBe(0o600)
    expect(exported.map(line => JSON.parse(line) as { event: string })).toEqual(
        expect.arrayContaining([expect.objectContaining({ event: 'diagnostics.exported' })]),
    )
})

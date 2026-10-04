import { asAppIpcMain } from '@release-maestro/core'
import { app, dialog, ipcMain, shell } from 'electron'
import { mkdir, open } from 'node:fs/promises'
import { diagnosticLogDirectory, readDiagnosticLines } from './logger'
import App from '../app'

const ipc = asAppIpcMain(ipcMain)

ipc.handle('diagnostics:preview', async () => (await readDiagnosticLines()).slice(-20))

ipc.handle('diagnostics:open-folder', async () => {
    await mkdir(diagnosticLogDirectory(), { recursive: true })
    const error = await shell.openPath(diagnosticLogDirectory())
    if (error) throw new Error(error)
})

ipc.handle('diagnostics:export', async () => {
    const options: Electron.SaveDialogOptions = {
        title: 'Export diagnostics',
        defaultPath: 'release-maestro-diagnostics.jsonl',
        filters: [{ name: 'JSON Lines', extensions: ['jsonl'] }],
    }
    const result = App.mainWindow
        ? await dialog.showSaveDialog(App.mainWindow, options)
        : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null

    const header = JSON.stringify({
        time: new Date().toISOString(),
        level: 'info',
        source: 'diagnostics',
        event: 'diagnostics.exported',
        appVersion: app.getVersion(),
        platform: process.platform,
    })
    const lines = await readDiagnosticLines()
    const file = await open(result.filePath, 'w', 0o600)
    try {
        await file.chmod(0o600)
        await file.writeFile(`${[header, ...lines].join('\n')}\n`)
    } finally {
        await file.close()
    }
    return result.filePath
})

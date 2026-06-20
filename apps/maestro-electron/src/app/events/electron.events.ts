/**
 * This module is responsible on handling all the inter process communications
 * between the frontend to the electron backend.
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import { asAppIpcMain } from '@release-maestro/core'
import { environment } from '../../environments/environment'

const ipc = asAppIpcMain(ipcMain)

export default class ElectronEvents {
    static bootstrapElectronEvents(): Electron.IpcMain {
        return ipcMain
    }
}

// Retrieve app version
ipc.handle('get-app-version', () => {
    console.log(`Fetching application version... [v${environment.version}]`)

    return environment.version
})

// Handle App termination
ipc.on('quit', (event, code) => {
    app.exit(code)
})

ipc.handle('window-minimize', event => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
})

ipc.handle('window-toggle-maximize', event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false

    if (window.isMaximized()) {
        window.unmaximize()
        return false
    }

    window.maximize()
    return true
})

ipc.handle('window-close', event => {
    BrowserWindow.fromWebContents(event.sender)?.close()
})

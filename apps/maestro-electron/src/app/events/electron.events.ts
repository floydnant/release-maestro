/**
 * This module is responsible on handling all the inter process communications
 * between the frontend to the electron backend.
 */

import { app, BrowserWindow, ipcMain } from 'electron'
import { environment } from '../../environments/environment'

export default class ElectronEvents {
    static bootstrapElectronEvents(): Electron.IpcMain {
        return ipcMain
    }
}

// Retrieve app version
ipcMain.handle('get-app-version', event => {
    console.log(`Fetching application version... [v${environment.version}]`)

    return environment.version
})

// Handle App termination
ipcMain.on('quit', (event, code) => {
    app.exit(code)
})

ipcMain.handle('window-minimize', event => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
})

ipcMain.handle('window-toggle-maximize', event => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return false

    if (window.isMaximized()) {
        window.unmaximize()
        return false
    }

    window.maximize()
    return true
})

ipcMain.handle('window-close', event => {
    BrowserWindow.fromWebContents(event.sender)?.close()
})

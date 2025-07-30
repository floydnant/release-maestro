import 'dotenv/config'
import { app, BrowserWindow, ipcMain, screen, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import { diContainer } from './di'
import { FeedBackendService } from './feed/feed.backend.service'
import { HydratedFeedItem } from './feed/feed.schema'
import { DatabaseClient } from './database/database.client'
import { SettingsBackendService } from './settings.backend.service'

let win: BrowserWindow | null = null
const args = process.argv.slice(1),
    serve = args.some(val => val === '--serve')

function createWindow(): BrowserWindow {
    const size = screen.getPrimaryDisplay().workAreaSize

    // Create the browser window.
    win = new BrowserWindow({
        x: 0,
        y: 0,
        width: size.width,
        height: size.height,
        webPreferences: {
            nodeIntegration: true,
            allowRunningInsecureContent: serve,
            contextIsolation: false,
            webSecurity: !serve,
        },
    })

    // Open urls in the user's browser
    win.webContents.setWindowOpenHandler(event => {
        shell.openExternal(event.url)
        return { action: 'deny' }
    })

    if (serve) {
        import('electron-debug').then(debug => {
            debug.default({ isEnabled: true, showDevTools: true })
        })

        import('electron-reloader').then(reloader => {
            const reloaderFn = (reloader as any).default || reloader
            reloaderFn(module)
        })
        win.loadURL('http://localhost:4200')
    } else {
        // Path when running electron executable
        let pathIndex = './index.html'

        if (fs.existsSync(path.join(__dirname, '../dist/index.html'))) {
            // Path when running electron in local folder
            pathIndex = '../dist/index.html'
        }

        const fullPath = path.join(__dirname, pathIndex)
        const url = `file://${path.resolve(fullPath).replace(/\\/g, '/')}`
        win.loadURL(url)
    }

    // Emitted when the window is closed.
    win.on('closed', () => {
        // Dereference the window object, usually you would store window
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        win = null
    })

    return win
}

try {
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    // Added 400 ms to fix the black background issue while using transparent window. More detais at https://github.com/electron/electron/issues/15947
    app.on('ready', async () => {
        // Initialize stuff
        await diContainer.get(DatabaseClient)
        await diContainer.get(SettingsBackendService)

        setTimeout(createWindow, 400)
    })

    // Quit when all windows are closed.
    app.on('window-all-closed', async () => {
        // Cleanup everything: db connection, etc.
        await diContainer.destroyAll()

        // On OS X it is common for applications and their menu bar
        // to stay active until the user quits explicitly with Cmd + Q
        if (process.platform !== 'darwin') {
            app.quit()
        }
    })

    app.on('activate', () => {
        // On OS X it's common to re-create a window in the app when the
        // dock icon is clicked and there are no other windows open.
        if (win === null) {
            createWindow()
        }
    })
} catch (e) {
    // Catch Error
    // throw e;
    console.error('Error during Electron app initialization:', e)
}

// @TODO: we need some kind of controller/type-wrapper for the backend <> frontend comms

ipcMain.handle('open-url', async (_event, url: string) => {
    shell.openExternal(url)
})

ipcMain.handle('trigger-email-import', async event => {
    const abortController = new AbortController()
    const abortHandler = () => abortController.abort()
    ipcMain.once('email-import-abort', abortHandler)

    const feedService = await diContainer.get(FeedBackendService)
    const result$ = await feedService.triggerEmailImport(abortController.signal)

    return new Promise<void>((resolve, reject) => {
        result$.subscribe({
            next: progressEvent => {
                event.sender.send('email-import-progress', progressEvent)
            },
            error: err => {
                reject(err)
                ipcMain.removeListener('email-import-abort', abortHandler)
            },
            complete: () => {
                resolve()
                ipcMain.removeListener('email-import-abort', abortHandler)
            },
        })
    })
})

ipcMain.handle('load-feed', async (_event, index: number, count: number) => {
    const feedService = await diContainer.get(FeedBackendService)
    return await feedService.loadFeed(index, count)
})

ipcMain.handle(
    'mark-feed-item-viewed',
    async (_event, id: string, feedItemType: HydratedFeedItem['type'], isSnoozed: boolean = false) => {
        const feedService = await diContainer.get(FeedBackendService)
        return await feedService.markFeedItemAsViewed(id, feedItemType, isSnoozed)
    },
)

ipcMain.handle('get-settings', async _event => {
    const settingsService = await diContainer.get(SettingsBackendService)
    return settingsService.store.store
})
ipcMain.handle('set-settings', async (_event, store) => {
    const settingsService = await diContainer.get(SettingsBackendService)
    settingsService.store.store = store
})

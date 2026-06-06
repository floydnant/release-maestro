/**
 * This module handles application-specific IPC communications
 * between the frontend and the electron backend.
 */

import { ipcMain, shell } from 'electron'
import { diContainer } from '../di'
// import { DatabaseClient } from '../database/database.client' // TODO: Use when needed
import { SettingsBackendService } from '../services/settings.backend.service'

export default class AppEvents {
    static bootstrapAppEvents(): Electron.IpcMain {
        return ipcMain
    }
}

// Handle opening URLs in external browser
ipcMain.handle('open-url', async (_event, url: string) => {
    shell.openExternal(url)
})

// Settings management
ipcMain.handle('get-settings', async _event => {
    const settingsService = await diContainer.get(SettingsBackendService)
    return settingsService.store.store
})

ipcMain.handle('set-settings', async (_event, store) => {
    const settingsService = await diContainer.get(SettingsBackendService)
    settingsService.store.store = store
})

// Handle email import functionality
ipcMain.handle('trigger-email-import', async event => {
    const abortController = new AbortController()
    const abortHandler = () => abortController.abort()
    ipcMain.once('email-import-abort', abortHandler)

    const { FeedBackendService } = await import('../services/feed/feed.backend.service')
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

// Handle feed loading
ipcMain.handle('load-feed', async (_event, index: number, count: number) => {
    const { FeedBackendService } = await import('../services/feed/feed.backend.service')
    const feedService = await diContainer.get(FeedBackendService)

    return await feedService.loadFeed(index, count).catch(err => {
        console.error('Error loading feed:', err)

        if (err instanceof Error) {
            return {
                isError: true,
                message: err.message,
                name: err.name,
            }
        }

        throw err
    })
})

// Check if feed has items
ipcMain.handle('has-feed', async () => {
    const { FeedBackendService } = await import('../services/feed/feed.backend.service')
    const feedService = await diContainer.get(FeedBackendService)

    return await feedService.hasFeed().catch(err => {
        console.error('Error checking if feed exists:', err)
        return false
    })
})

// Mark feed item as viewed
ipcMain.handle(
    'mark-feed-item-viewed',
    async (_event, id: string, feedItemType: string, isSnoozed = false) => {
        const { FeedBackendService } = await import('../services/feed/feed.backend.service')
        const feedService = await diContainer.get(FeedBackendService)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return await feedService.markFeedItemAsViewed(id, feedItemType as any, isSnoozed)
    },
)

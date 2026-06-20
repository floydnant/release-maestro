/**
 * This module handles application-specific IPC communications
 * between the frontend and the electron backend.
 */

import { ipcMain, shell } from 'electron'
import { diContainer } from '../di'
// import { DatabaseClient } from '../database/database.client' // TODO: Use when needed
import {
    asAppIpcMain,
    FeedLoadError,
    MetadataIpcChannel,
    ScanResult,
    toRendererEmitter,
} from '@release-maestro/core'
import { LibraryBackendService } from '../services/library/library.backend.service'
import { MetadataBackendService } from '../services/metadata/metadata.backend.service'
import { SettingsBackendService } from '../services/settings.backend.service'

const ipc = asAppIpcMain(ipcMain)

export default class AppEvents {
    static bootstrapAppEvents(): Electron.IpcMain {
        return ipcMain
    }
}

// Handle opening URLs in external browser
ipc.handle('open-url', async (_event, url) => {
    shell.openExternal(url)
})

// Settings management
ipc.handle('get-settings', async () => {
    const settingsService = await diContainer.get(SettingsBackendService)
    return settingsService.store.store
})

ipc.handle('set-settings', async (_event, store) => {
    const settingsService = await diContainer.get(SettingsBackendService)
    settingsService.store.store = store
})

// Handle email import functionality
ipc.handle('trigger-email-import', async event => {
    const abortController = new AbortController()
    const abortHandler = () => abortController.abort()
    ipc.once('email-import-abort', abortHandler)

    const { FeedBackendService } = await import('../services/feed/feed.backend.service')
    const feedService = await diContainer.get(FeedBackendService)
    const result$ = await feedService.triggerEmailImport(abortController.signal)
    const emitter = toRendererEmitter(event.sender)

    return new Promise<void>((resolve, reject) => {
        result$.subscribe({
            next: progressEvent => {
                emitter.send('email-import-progress', progressEvent)
            },
            error: err => {
                reject(err)
                ipc.removeListener('email-import-abort', abortHandler)
            },
            complete: () => {
                resolve()
                ipc.removeListener('email-import-abort', abortHandler)
            },
        })
    })
})

// Handle feed loading
ipc.handle('load-feed', async (_event, { index, count }) => {
    const { FeedBackendService } = await import('../services/feed/feed.backend.service')
    const feedService = await diContainer.get(FeedBackendService)

    return await feedService.loadFeed(index, count).catch(err => {
        console.error('Error loading feed:', err)

        if (err instanceof Error) {
            return {
                isError: true,
                message: err.message,
                name: err.name,
                userFacingMessage:
                    (err as FeedLoadError).userFacingMessage ??
                    'Failed to load feed. Please try again later.',
            } satisfies FeedLoadError
        }

        throw err
    })
})

// Check if feed has items
ipc.handle('has-feed', async () => {
    const { FeedBackendService } = await import('../services/feed/feed.backend.service')
    const feedService = await diContainer.get(FeedBackendService)

    return await feedService.hasFeed().catch(err => {
        console.error('Error checking if feed exists:', err)
        return false
    })
})

// Mark feed item as viewed
ipc.handle('mark-feed-item-viewed', async (_event, { id, type, isSnoozed = false }) => {
    const { FeedBackendService } = await import('../services/feed/feed.backend.service')
    const feedService = await diContainer.get(FeedBackendService)
    return await feedService.markFeedItemAsViewed(id, type, isSnoozed)
})

// ---------------------------------------------------------------------------
// Music-metadata engine (Rust JSONL worker) IPC
// ---------------------------------------------------------------------------

ipc.handle(MetadataIpcChannel.ping, async () => {
    const metadataService = await diContainer.get(MetadataBackendService)
    return metadataService.ping()
})

ipc.handle(MetadataIpcChannel.read, async (_event, request) => {
    const metadataService = await diContainer.get(MetadataBackendService)
    return metadataService.readFile(request.path)
})

ipc.handle(MetadataIpcChannel.write, async (_event, request) => {
    const metadataService = await diContainer.get(MetadataBackendService)
    return metadataService.writeTags(request.path, request.update)
})

// Scan streams per-file results/progress over `scan-progress` and resolves with a
// summary when finished. Cancellation arrives on the fire-and-forget `scan-abort`.
ipc.handle(MetadataIpcChannel.scan, async (event, request) => {
    const abortController = new AbortController()
    const abortHandler = () => abortController.abort()
    ipc.once(MetadataIpcChannel.scanAbort, abortHandler)

    const libraryService = await diContainer.get(LibraryBackendService)
    const update$ = libraryService.scan(request.paths, abortController.signal)
    const emitter = toRendererEmitter(event.sender)

    return new Promise<ScanResult | undefined>((resolve, reject) => {
        let summary: ScanResult | undefined
        update$.subscribe({
            next: update => {
                emitter.send(MetadataIpcChannel.scanProgress, update)
                if (update.phase == 'completed') {
                    summary = {
                        count: update.count,
                        total: update.total,
                        unchanged: update.unchanged,
                        changed: update.changed,
                        new: update.new,
                        missing: update.missing,
                        errors: update.errors,
                    }
                }
            },
            error: err => {
                ipc.removeListener(MetadataIpcChannel.scanAbort, abortHandler)
                reject(err)
            },
            complete: () => {
                ipc.removeListener(MetadataIpcChannel.scanAbort, abortHandler)
                resolve(summary)
            },
        })
    })
})

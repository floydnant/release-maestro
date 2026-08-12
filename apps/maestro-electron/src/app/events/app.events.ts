/**
 * This module handles application-specific IPC communications
 * between the frontend and the electron backend.
 */

import { dialog, ipcMain, shell } from 'electron'
import { diContainer } from '../di'
// import { DatabaseClient } from '../database/database.client' // TODO: Use when needed
import {
    asAppIpcMain,
    FeedLoadError,
    LibraryBrowseIpcChannel,
    LibraryIpcChannel,
    MetadataIpcChannel,
    toRendererEmitter,
} from '@release-maestro/core'
import App from '../app'
import { LibraryBrowseRepository } from '../services/library/library-browse.repository'
import { LibraryFoldersService } from '../services/library/library-folders.service'
import { LibraryScanService } from '../services/library/library-scan.service'
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

// Reveal a file/folder in the OS file manager (e.g. a failed import from settings)
ipc.handle('reveal-in-file-manager', async (_event, path) => {
    shell.showItemInFolder(path)
})

// Settings management (all reads/writes go through schema validation)
ipc.handle('get-settings', async () => {
    const settingsService = await diContainer.get(SettingsBackendService)
    return settingsService.getSettings()
})

ipc.handle('set-settings', async (_event, store) => {
    const settingsService = await diContainer.get(SettingsBackendService)
    return settingsService.setSettings(store)
})

ipc.handle('patch-settings', async (_event, patch) => {
    const settingsService = await diContainer.get(SettingsBackendService)
    return settingsService.patchSettings(patch)
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

// ---------------------------------------------------------------------------
// Library scans (lifecycle owned by LibraryScanService; status is streamed to
// all windows on `library:scan-status`)
// ---------------------------------------------------------------------------

ipc.handle(LibraryIpcChannel.pickFolders, async () => {
    const options: Electron.OpenDialogOptions = {
        properties: ['openDirectory', 'multiSelections', 'createDirectory'],
    }
    const result = App.mainWindow
        ? await dialog.showOpenDialog(App.mainWindow, options)
        : await dialog.showOpenDialog(options)
    if (result.canceled) return null

    const foldersService = await diContainer.get(LibraryFoldersService)
    return foldersService.canonicalizeSelection(result.filePaths)
})

ipc.handle(LibraryIpcChannel.validateFolders, async (_event, request) => {
    const foldersService = await diContainer.get(LibraryFoldersService)
    return foldersService.validate(request.paths)
})

ipc.handle(LibraryIpcChannel.startScan, async (_event, request) => {
    const scanService = await diContainer.get(LibraryScanService)
    return scanService.startScan(request.trigger, request.paths)
})

ipc.on(LibraryIpcChannel.cancelScan, async () => {
    const scanService = await diContainer.get(LibraryScanService)
    scanService.cancel()
})

ipc.handle(LibraryIpcChannel.getScanStatus, async () => {
    const scanService = await diContainer.get(LibraryScanService)
    return scanService.getSnapshot()
})

// ---------------------------------------------------------------------------
// Library browsing (windowed reads, see ADR 0004). One-shot request/response —
// the renderer's own pipeline decides which window is still wanted, and a
// superseded window is simply dropped there.
// ---------------------------------------------------------------------------

ipc.handle(LibraryBrowseIpcChannel.querySongs, async (_event, request) => {
    const browseRepository = await diContainer.get(LibraryBrowseRepository)
    return browseRepository.querySongs(request)
})

ipc.handle(LibraryBrowseIpcChannel.describeSongFilter, async (_event, request) => {
    const browseRepository = await diContainer.get(LibraryBrowseRepository)
    return browseRepository.describeSongFilter(request.filter)
})

ipc.handle(LibraryBrowseIpcChannel.queryAlbums, async (_event, request) => {
    const browseRepository = await diContainer.get(LibraryBrowseRepository)
    return browseRepository.queryAlbums(request)
})

ipc.handle(LibraryBrowseIpcChannel.describeAlbumFilter, async (_event, request) => {
    const browseRepository = await diContainer.get(LibraryBrowseRepository)
    return browseRepository.describeAlbumFilter(request.filter)
})

ipc.handle(LibraryBrowseIpcChannel.getAlbumDetail, async (_event, request) => {
    const browseRepository = await diContainer.get(LibraryBrowseRepository)
    return browseRepository.getAlbumDetail(request.albumId)
})

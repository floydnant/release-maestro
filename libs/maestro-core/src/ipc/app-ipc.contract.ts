/**
 * The concrete IPC contracts for this application — the single source of truth
 * both the Electron main process and the Angular renderer import.
 *
 *  - {@link MainIpcContract}     — channels the *main* process handles. The renderer drives them.
 *  - {@link RendererIpcContract} — events the *renderer* listens for. The main process emits them.
 *
 * (Electron has no main -> renderer `invoke`, so the renderer contract is events-only.)
 */
import type { WebContents } from 'electron'
import type { AppSettings } from '../schemas/app-settings.schema'
import type { EmailImportProgressUpdate } from '../schemas/email.schema'
import type { HydratedFeedItem } from '../schemas/feed.schema'
import {
    MetadataIpcChannel,
    type MetadataScanUpdate,
    type PingResult,
    type ReadMetadataRequest,
    type ScanMetadataRequest,
    type ScanResult,
    type SongMetadata,
    type WriteMetadataRequest,
} from '../schemas/metadata.schema'
import { defineIpcContract, defineIpcEvent, defineIpcRequest } from './ipc-contract'
import { type TypedIpcMain, type TypedIpcRenderer, toTypedWebContents } from './typed-ipc'

/** Error envelope returned by `load-feed` when feed loading fails (see app.events). */
export interface FeedLoadError {
    isError: true
    message: string
    name: string
    userFacingMessage?: string
}

/** Channels the main process handles; the renderer invokes/sends these. */
export const MainIpcContract = defineIpcContract({
    // window / app lifecycle
    'window-minimize': defineIpcRequest(),
    'window-toggle-maximize': defineIpcRequest<void, boolean>(),
    'window-close': defineIpcRequest(),
    'get-app-version': defineIpcRequest<void, string>(),
    'open-url': defineIpcRequest<string>(),
    quit: defineIpcEvent<number>(),

    // settings
    'get-settings': defineIpcRequest<void, AppSettings>(),
    'set-settings': defineIpcRequest<AppSettings>(),

    // feed
    'trigger-email-import': defineIpcRequest(),
    'email-import-abort': defineIpcEvent(),
    'load-feed': defineIpcRequest<{ index: number; count: number }, HydratedFeedItem[] | FeedLoadError>(),
    'has-feed': defineIpcRequest<void, boolean>(),
    'mark-feed-item-viewed': defineIpcRequest<{
        id: string
        type: HydratedFeedItem['type']
        isSnoozed?: boolean
    }>(),

    // music-metadata engine
    [MetadataIpcChannel.ping]: defineIpcRequest<void, PingResult>(),
    [MetadataIpcChannel.read]: defineIpcRequest<ReadMetadataRequest, SongMetadata | null>(),
    [MetadataIpcChannel.write]: defineIpcRequest<WriteMetadataRequest, SongMetadata>(),
    [MetadataIpcChannel.scan]: defineIpcRequest<ScanMetadataRequest, ScanResult | undefined>(),
    [MetadataIpcChannel.scanAbort]: defineIpcEvent(),
})
export type MainIpcContract = typeof MainIpcContract

/** Events the renderer listens for; the main process emits these via `webContents.send`. */
export const RendererIpcContract = defineIpcContract({
    'email-import-progress': defineIpcEvent<EmailImportProgressUpdate>(),
    [MetadataIpcChannel.scanProgress]: defineIpcEvent<MetadataScanUpdate>(),
})
export type RendererIpcContract = typeof RendererIpcContract

/** `ipcRenderer` typed for this app: listens for renderer events, invokes main channels. */
export type AppIpcRenderer = TypedIpcRenderer<RendererIpcContract, MainIpcContract>

/** `ipcMain` typed for this app: handles main channels, emits renderer events. */
export type AppIpcMain = TypedIpcMain<MainIpcContract, RendererIpcContract>

/** Cast a raw `ipcRenderer` to the app-typed renderer interface. */
export const asAppIpcRenderer = (ipcRenderer: unknown): AppIpcRenderer => ipcRenderer as AppIpcRenderer

/** Cast a raw `ipcMain` to the app-typed main interface. */
export const asAppIpcMain = (ipcMain: unknown): AppIpcMain => ipcMain as AppIpcMain

/** Wrap a `WebContents` (e.g. `event.sender`) for typed renderer-event emission. */
export const toRendererEmitter = (webContents: WebContents) =>
    toTypedWebContents<RendererIpcContract>(webContents)

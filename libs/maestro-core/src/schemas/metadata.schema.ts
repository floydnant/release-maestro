/**
 * Shared contract for the `metadata-engine` Rust worker and the Electron <-> renderer
 * IPC surface for music-metadata read / write / scan.
 *
 * These are intentionally plain TypeScript types, not zod schemas: the worker is a
 * trusted first-party process and validating every streamed event would add overhead
 * for no real safety benefit. Validate only at genuine boundaries if needed.
 */

// ---------------------------------------------------------------------------
// Normalized metadata schema (mirror of the Rust `SongMetadata` / `FileInfo`)
// ---------------------------------------------------------------------------

export interface FileInfo {
    /** Duration in seconds. */
    duration: number
    overallBitrate: number | null
    audioBitrate: number | null
    sampleRate: number | null
    bitDepth: number | null
    channels: number | null
    tagType: string | null
    codec: string
}

/**
 * The normalized, flat metadata object returned by the engine for a single file.
 *
 * NOTE: the schema is intentionally kept flat for v1 to preserve parity with the
 * existing Tauri implementation. A future refactor into nested `tags` / `properties`
 * sub-objects would be a follow-up improvement, not part of this migration.
 */
export interface SongMetadata {
    title: string
    artist: string | null
    albumTitle: string | null
    albumArtist: string | null
    /** Absolute filesystem path to cached/extracted cover art, or null. */
    coverPath: string | null
    year: number | null
    track: number | null
    genre: string | null
    label: string | null
    catalogNumber: string | null
    duration: number | null
    comment: string | null
    musicalKey: string | null
    bpm: number | null
    energy: string | null
    lyrics: string | null
    date: string | null
    /** Unmapped tags as `[key, value]` pairs. Read-only; not writable. */
    extraMetadata: [string, string][]
    fileInfo: FileInfo | null
    fileName: string
    path: string
    /** Epoch millis of file creation. Omitted entirely when unavailable. */
    createdAt?: number
}

/**
 * Tri-state metadata write payload (mirror of the Rust `SongMetadataUpdateable`).
 *
 * CRITICAL — preserve these exact semantics across the wire:
 * - field OMITTED (`undefined`) → leave the tag unchanged
 * - field `null`               → clear / remove the tag
 * - field with a value         → set the tag (strings are trimmed; empty == clear)
 *
 * Because `JSON.stringify` drops `undefined` keys but keeps `null`, the natural
 * JS object maps exactly onto the Rust `Option<Option<T>>` deserializer. Do NOT
 * coerce `undefined` → `null` anywhere in the pipeline, and do NOT introduce a
 * separate set/clear API.
 *
 * `title` and `fileName` are plain optionals (no clear-via-null): providing an
 * empty/whitespace `title` removes it, while an empty `fileName` is an error.
 */
export interface SongMetadataUpdate {
    title?: string
    artist?: string | null
    albumTitle?: string | null
    albumArtist?: string | null
    year?: number | null
    track?: number | null
    genre?: string | null
    comment?: string | null
    date?: string | null
    label?: string | null
    catalogNumber?: string | null
    musicalKey?: string | null
    bpm?: number | null
    energy?: string | null
    lyrics?: string | null
    /** Rename the file on disk. Empty/whitespace is rejected by the engine. */
    fileName?: string
}

// ---------------------------------------------------------------------------
// Low-level JSONL worker protocol (used by the Electron main-process sidecar)
// ---------------------------------------------------------------------------

export const METADATA_PROTOCOL_VERSION = 1

export type MetadataErrorCode =
    | 'INVALID_REQUEST'
    | 'UNKNOWN_METHOD'
    | 'BUSY'
    | 'FILE_NOT_FOUND'
    | 'UNSUPPORTED_FORMAT'
    | 'PARSE_FAILED'
    | 'WRITE_FAILED'
    | 'ARTWORK_CACHE_FAILED'
    | 'CANCELLED'
    | 'INTERNAL_ERROR'

export interface MetadataProtocolError {
    code: MetadataErrorCode
    message: string
    details?: unknown
}

export type MetadataMethod = 'ping' | 'read_file' | 'scan' | 'write_tags' | 'cancel'

export interface MetadataRequest<TParams = unknown> {
    type: 'request'
    id: string
    method: MetadataMethod
    params: TParams
}

export interface MetadataResponse<TResult = unknown> {
    type: 'response'
    id: string
    ok: boolean
    result?: TResult
    error?: MetadataProtocolError
}

export type MetadataEventName = 'started' | 'progress' | 'item' | 'item_error'

export interface MetadataEvent<TData = unknown> {
    type: 'event'
    requestId: string
    event: MetadataEventName
    data: TData
}

/** Any line the worker writes to stdout. */
export type MetadataWorkerMessage = MetadataResponse | MetadataEvent

// --- worker method params / results ---------------------------------------

export interface PingResult {
    protocolVersion: number
    engineVersion: string
}

export interface ReadFileParams {
    path: string
    coverArtCacheDir: string
}

export interface ScanParams {
    paths: string[]
    coverArtCacheDir: string
}

export interface WriteTagsParams {
    path: string
    update: SongMetadataUpdate
    coverArtCacheDir: string
}

export interface CancelParams {
    requestId: string
}

export interface ScanResult {
    count: number
    total: number
}

export interface CancelResult {
    cancelled: boolean
}

// --- worker event data shapes ---------------------------------------------

export interface ScanStartedData {
    total: number
}

export interface ScanProgressData {
    done: number
    total: number
}

export interface ScanItemData {
    metadata: SongMetadata
}

export interface ScanItemErrorData {
    path: string
    error: string
}

// ---------------------------------------------------------------------------
// Renderer-facing scan stream (translated from worker events by the main process)
// ---------------------------------------------------------------------------

export type MetadataScanUpdate =
    | { phase: 'started'; total: number }
    | { phase: 'progress'; done: number; total: number }
    | { phase: 'item'; metadata: SongMetadata }
    | { phase: 'itemError'; path: string; error: string }
    | { phase: 'completed'; count: number; total: number }
    | { phase: 'error'; error: MetadataProtocolError }

// ---------------------------------------------------------------------------
// Typed Electron <-> renderer IPC contract for this feature
// ---------------------------------------------------------------------------

export const METADATA_IPC_CHANNELS = {
    ping: 'metadata:ping',
    read: 'metadata:read',
    write: 'metadata:write',
    scan: 'metadata:scan',
    scanProgress: 'metadata:scan-progress',
    scanAbort: 'metadata:scan-abort',
} as const

export type MetadataIpcChannel = (typeof METADATA_IPC_CHANNELS)[keyof typeof METADATA_IPC_CHANNELS]

/** Renderer-facing request payloads (the main process injects the cover-art cache dir). */
export interface ReadMetadataRequest {
    path: string
}

export interface WriteMetadataRequest {
    path: string
    update: SongMetadataUpdate
}

export interface ScanMetadataRequest {
    paths: string[]
}

/** `ipcRenderer.invoke(channel, ...args)` → result, typed per channel. */
export interface MetadataIpcInvokeMap {
    [METADATA_IPC_CHANNELS.ping]: { args: []; result: PingResult }
    [METADATA_IPC_CHANNELS.read]: { args: [request: ReadMetadataRequest]; result: SongMetadata | null }
    [METADATA_IPC_CHANNELS.write]: { args: [request: WriteMetadataRequest]; result: SongMetadata }
    [METADATA_IPC_CHANNELS.scan]: { args: [request: ScanMetadataRequest]; result: ScanResult }
}

/** `event.sender.send(channel, payload)` → renderer `on(channel)` payloads. */
export interface MetadataIpcEventMap {
    [METADATA_IPC_CHANNELS.scanProgress]: MetadataScanUpdate
}

/** Fire-and-forget `ipcRenderer.send(channel, ...args)` from renderer → main. */
export interface MetadataIpcSendMap {
    [METADATA_IPC_CHANNELS.scanAbort]: []
}

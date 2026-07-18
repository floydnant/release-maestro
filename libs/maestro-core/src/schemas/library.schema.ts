import type { MetadataScanUpdate, ScanResult } from './metadata.schema'

// ---------------------------------------------------------------------------
// Library scan — main-process-owned scan lifecycle, renderer-facing status
// ---------------------------------------------------------------------------

export const LibraryIpcChannel = {
    pickFolders: 'library:pick-folders',
    startScan: 'library:start-scan',
    cancelScan: 'library:cancel-scan',
    getScanStatus: 'library:get-scan-status',
    scanStatus: 'library:scan-status',
} as const

export type LibraryIpcChannel = (typeof LibraryIpcChannel)[keyof typeof LibraryIpcChannel]

export type LibraryScanTrigger = 'startup' | 'manual' | 'onboarding' | 'debug'

export type LibraryScanPhase = 'idle' | 'discovering' | 'reading' | 'completed' | 'cancelled' | 'error'

/**
 * Deduped album preview streamed to the renderer for the import cover mosaic.
 * The cover-art cache is content-addressed, so `coverPath` doubles as the dedup
 * key — identical artwork is never shown twice.
 */
export interface LibraryAlbumPreview {
    albumTitle: string | null
    artist: string | null
    /** Absolute filesystem path to cached cover art (render via a file:// URL). Unique per preview. */
    coverPath: string
}

/**
 * Full snapshot of the current (or most recent) scan. Every `library:scan-status`
 * broadcast carries the whole snapshot so late subscribers and throttled streams
 * never miss state — only the mosaic covers are delta-shaped.
 */
export interface LibraryScanStatus {
    scanId: number
    trigger: LibraryScanTrigger
    phase: LibraryScanPhase
    roots: string[]
    startedAt: number
    finishedAt: number | null
    // discovery (prescan) phase
    discovered: number
    new: number
    changed: number
    unchanged: number
    // deep-read phase
    readDone: number
    readTotal: number
    imported: number
    errors: number
    /** Distinct tracks ingested during this scan that have at least one open normalization issue. */
    normalizationIssues: number
    lastErrorMessage: string | null
    /** Set once `phase` is `completed`. */
    summary: ScanResult | null
}

/** Persisted record of the last successfully completed scan. */
export interface LibraryLastScanInfo extends ScanResult {
    finishedAt: number
    roots: string[]
    normalizationIssues?: number
}

/** Pushed on `library:scan-status`. `newAlbums` are covers first seen since the previous broadcast. */
export interface LibraryScanStatusEvent {
    status: LibraryScanStatus
    newAlbums: LibraryAlbumPreview[]
}

/** Returned by `library:get-scan-status` so late-mounting UI can sync. */
export interface LibraryScanSnapshot {
    status: LibraryScanStatus | null
    /** Most recent album previews from the current/last scan, in arrival order. */
    albums: LibraryAlbumPreview[]
    lastScan: LibraryLastScanInfo | null
}

export interface StartLibraryScanRequest {
    trigger: Exclude<LibraryScanTrigger, 'startup'>
    /** Explicit paths override (debug tooling). Defaults to the configured library folders. */
    paths?: string[]
}

/**
 * Internal main-process scan stream: the metadata-engine update union plus
 * library-level phases (prescan discovery tallies, normalization issue totals).
 */
export type LibraryScanUpdate =
    | MetadataScanUpdate
    | { phase: 'discovery'; discovered: number; new: number; changed: number; unchanged: number }
    /** Cumulative count of distinct tracks with open normalization issues so far in this scan. */
    | { phase: 'normalization'; normalizationIssues: number }

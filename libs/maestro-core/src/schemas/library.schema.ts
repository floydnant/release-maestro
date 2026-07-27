import type { MetadataErrorCode, MetadataScanUpdate, ScanResult } from './metadata.schema'

// ---------------------------------------------------------------------------
// Library scan — main-process-owned scan lifecycle, renderer-facing status
// ---------------------------------------------------------------------------

export const LibraryIpcChannel = {
    pickFolders: 'library:pick-folders',
    validateFolders: 'library:validate-folders',
    startScan: 'library:start-scan',
    cancelScan: 'library:cancel-scan',
    getScanStatus: 'library:get-scan-status',
    scanStatus: 'library:scan-status',
} as const

export type LibraryIpcChannel = (typeof LibraryIpcChannel)[keyof typeof LibraryIpcChannel]

export type LibraryScanTrigger = 'startup' | 'manual' | 'onboarding' | 'debug'

// ---------------------------------------------------------------------------
// Folder validation
// ---------------------------------------------------------------------------

/** Per-folder validation result, in the same order as the request paths. */
export interface LibraryFolderValidation {
    /** The path as configured/selected. */
    path: string
    /** `realpath`-canonicalized path (deterministically resolved when realpath fails). */
    canonicalPath: string
    /** Whether the folder exists, is a directory, and is readable. */
    available: boolean
    /** Canonical path of another folder in the same set that already contains this one. */
    nestedUnder?: string
    /** Human-readable reason when `available` is false. */
    error?: string
}

export interface ValidateLibraryFoldersRequest {
    paths: string[]
}

export type LibraryScanPhase = 'idle' | 'discovering' | 'reading' | LibraryScanOutcome

/** How a scan ended. Every non-idle scan terminates in exactly one of these. */
export type LibraryScanOutcome = 'completed' | 'cancelled' | 'failed'

/** Which pipeline stage a file failed in — kept distinct so counts stay meaningful. */
export type LibraryScanFailureStage = 'discovery' | 'read'

export interface LibraryScanFileFailure {
    stage: LibraryScanFailureStage
    path: string
    code?: MetadataErrorCode
    message: string
}

export interface LibraryScanTerminalError {
    code: 'SCAN_ERROR'
    message: string
}

/**
 * Explicit terminal summary of a scan. Produced exactly once per scan; carried on
 * the status snapshot (`LibraryScanStatus.terminal`). Failure *details* exist only
 * in the in-memory snapshot of the current app session — after a relaunch only the
 * persisted aggregate (`LibraryLastScanInfo`) remains until the startup scan runs.
 */
export interface LibraryScanTerminalResult {
    outcome: LibraryScanOutcome
    scanId: number
    trigger: LibraryScanTrigger
    /** The folders actually walked: canonical, deduped, reachable. */
    scannedFolders: string[]
    startedAt: number
    finishedAt: number
    /** Files seen by discovery. */
    discovered: number
    new: number
    changed: number
    unchanged: number
    missing: number
    /**
     * Configured folders that could not be reached, so nothing under them was seen.
     * Not an error — their tracks are reconciled as missing like any other absent
     * file. Reported so the UI can explain a sudden jump in `missing`.
     */
    unavailableFolders: string[]
    /** Deep metadata reads planned / attempted (attempted = succeeded + failed). */
    readTotal: number
    readsAttempted: number
    /** Tracks successfully ingested. */
    imported: number
    // Failure counts are tracked explicitly per stage — they are NOT derivable
    // from `failures.length` (which is capped) or from `attempted - imported`.
    discoveryFailureCount: number
    readFailureCount: number
    /** Per-file details for this session, capped — see `failuresTruncated`. */
    failures: LibraryScanFileFailure[]
    failuresTruncated: boolean
    /** Distinct tracks ingested during this scan that have open normalization issues. */
    normalizationIssues: number
    /** Scan-level failure (outcome 'failed'); null for completed/cancelled. */
    error: LibraryScanTerminalError | null
}

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
    /**
     * Monotonic within a scan: bumped on every status mutation. Together with
     * `scanId` it totally orders snapshots, so push events and pull snapshots
     * can race without the renderer ever regressing to stale state.
     */
    revision: number
    trigger: LibraryScanTrigger
    phase: LibraryScanPhase
    /** The folders actually being walked: canonical, deduped, reachable. */
    scannedFolders: string[]
    /** Configured folders that could not be reached; nothing under them will be seen. */
    unavailableFolders: string[]
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
    /** Files that failed so far (all stages). Details land in `terminal.failures`. */
    failedFiles: number
    /** Distinct tracks ingested during this scan that have at least one open normalization issue. */
    normalizationIssues: number
    /** Set exactly once when the scan reaches a terminal phase. */
    terminal: LibraryScanTerminalResult | null
}

/** Persisted record of the last successfully completed scan. */
export interface LibraryLastScanInfo extends ScanResult {
    finishedAt: number
    scannedFolders: string[]
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

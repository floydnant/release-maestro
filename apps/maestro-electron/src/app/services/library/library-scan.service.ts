import {
    LibraryAlbumPreview,
    LibraryIpcChannel,
    LibraryLastScanInfo,
    LibraryScanFailureStage,
    LibraryScanFileFailure,
    LibraryScanOutcome,
    LibraryScanSnapshot,
    LibraryScanStatus,
    LibraryScanTerminalError,
    LibraryScanTerminalResult,
    LibraryScanTrigger,
    toRendererEmitter,
} from '@release-maestro/core'
import { BrowserWindow } from 'electron'
import { PersistentStore } from '../../utils/persistent-store.util'
import { SettingsBackendService } from '../settings.backend.service'
import { LibraryRootsService } from './library-roots.service'
import { LibraryBackendService } from './library.backend.service'

/** How often (at most) scan-status snapshots are pushed to the renderer. */
const BROADCAST_INTERVAL_MS = 200
/** Album previews retained for late-mounting UI reseeds (`get-scan-status`). */
const SNAPSHOT_ALBUM_LIMIT = 200
/** Cap on per-file failure *details*; the failure counts always stay exact. */
const FAILURE_DETAIL_LIMIT = 1_000

export interface LibraryScanState extends Record<string, unknown> {
    lastScan?: LibraryLastScanInfo | null
}

/**
 * Main-process owner of the library scan lifecycle.
 *
 * Exactly one scan runs at a time (`startScan` is idempotent while scanning).
 * Status is kept as a full snapshot and broadcast to all windows on a dirty-flag
 * throttle; `revision` orders snapshots within a scan so pushes and pulls can
 * race safely. Only the album cover previews for the import mosaic are
 * delta-shaped (`newAlbums`).
 *
 * Roots are validated here — the scan boundary — regardless of what the renderer
 * checked: if any configured root is unavailable the scan fails up front instead
 * of scanning a subset, so a temporarily unmounted drive can never cause its
 * whole library to be reconciled as missing.
 */
export class LibraryScanService {
    private status: LibraryScanStatus | null = null
    private abortController: AbortController | null = null
    private scanIdCounter = 0

    private albums = new Map<string, LibraryAlbumPreview>()
    private pendingNewAlbums: LibraryAlbumPreview[] = []
    private dirty = false
    private broadcastTimer: NodeJS.Timeout | null = null

    constructor(
        private readonly library: LibraryBackendService,
        private readonly settings: SettingsBackendService,
        private readonly roots: LibraryRootsService,
        /**
         * Main-owned scan state lives in its own conf file, and in the *data* dir
         * (not config): it's derived state that rides along with the database, not
         * user configuration. Its own file also keeps it safe from the renderer
         * replacing the whole `settings` store on `set-settings`. Wired in di.ts.
         */
        private readonly stateStore: PersistentStore<LibraryScanState>,
    ) {
        console.log('[LibraryScanService] state store path:', this.stateStore.path)
    }

    get isScanning(): boolean {
        return this.status?.phase === 'discovering' || this.status?.phase === 'reading'
    }

    /**
     * Start a scan of the configured library folders (or the explicit `paths` override).
     * Idempotent: while a scan is running, returns the running scan's status instead
     * of starting another — callers racing (startup vs. onboarding vs. debug) simply
     * attach to the scan in flight.
     */
    async startScan(trigger: LibraryScanTrigger, paths?: string[]): Promise<LibraryScanStatus> {
        if (this.status && this.isScanning) return this.status

        const configuredRoots = paths ?? this.settings.getSettings().libraryFolders ?? []
        const status = this.newStatus(trigger, configuredRoots)
        this.status = status
        if (configuredRoots.length === 0) {
            // Nothing configured: stay idle. Deliberately no scan and no
            // reconciliation — an empty selection must never mark songs missing.
            return status
        }

        const validations = await this.roots.validate(configuredRoots)
        const unavailable = validations.filter(validation => !validation.available)
        if (unavailable.length > 0) {
            // Refuse to scan a subset: reconciling only the reachable roots would
            // mark every song under the unreachable ones as missing.
            this.finishWithoutScan(status, 'failed', {
                code: 'ROOTS_UNAVAILABLE',
                message: `Library folder${unavailable.length > 1 ? 's' : ''} unavailable: ${unavailable
                    .map(validation => validation.path)
                    .join(', ')}`,
                unavailableRoots: unavailable.map(validation => validation.path),
            })
            return status
        }

        // Canonical roots, minus duplicates and roots nested under another root
        // (scanning both would be redundant).
        const effectiveRoots = validations
            .filter(validation => validation.nestedUnder === undefined)
            .map(validation => validation.canonicalPath)
        status.roots = effectiveRoots
        this.touch(status)

        this.albums.clear()
        this.pendingNewAlbums = []
        this.abortController = new AbortController()
        const { signal } = this.abortController
        this.startBroadcasting()

        /** Failures before the deep-read phase starts are discovery failures. */
        let failureStage: LibraryScanFailureStage = 'discovery'
        const failures: LibraryScanFileFailure[] = []
        let discoveryFailureCount = 0
        let readFailureCount = 0

        this.library.scan(effectiveRoots, signal).subscribe({
            next: update => {
                switch (update.phase) {
                    case 'discovery':
                        status.discovered = update.discovered
                        status.new = update.new
                        status.changed = update.changed
                        status.unchanged = update.unchanged
                        break
                    case 'started':
                        failureStage = 'read'
                        status.phase = 'reading'
                        status.readTotal = update.total
                        break
                    case 'progress':
                        status.readDone = update.done
                        break
                    case 'item':
                        status.imported += 1
                        this.collectAlbumPreview(update.metadata)
                        break
                    case 'normalization':
                        status.normalizationIssues = update.normalizationIssues
                        break
                    case 'itemError':
                        if (failureStage === 'discovery') discoveryFailureCount += 1
                        else readFailureCount += 1
                        status.failedFiles += 1
                        if (failures.length < FAILURE_DETAIL_LIMIT) {
                            failures.push({
                                stage: failureStage,
                                path: update.path,
                                ...(update.code !== undefined ? { code: update.code } : {}),
                                message: update.error,
                            })
                        }
                        break
                    case 'completed': {
                        this.finishScan(status, 'completed', {
                            failures,
                            discoveryFailureCount,
                            readFailureCount,
                            missing: update.missing ?? 0,
                            error: null,
                        })
                        this.stateStore.set('lastScan', {
                            count: update.count,
                            total: update.total,
                            unchanged: update.unchanged,
                            changed: update.changed,
                            new: update.new,
                            missing: update.missing,
                            errors: status.failedFiles,
                            finishedAt: status.finishedAt as number,
                            roots: status.roots,
                            normalizationIssues: status.normalizationIssues,
                        })
                        break
                    }
                    case 'error':
                        // Stream-level error update; the observable terminates right after.
                        break
                }
                this.touch(status)
            },
            error: err => {
                // An aborted deep read surfaces as a stream error — report it as a cancellation.
                const outcome: LibraryScanOutcome = signal.aborted ? 'cancelled' : 'failed'
                this.finishScan(status, outcome, {
                    failures,
                    discoveryFailureCount,
                    readFailureCount,
                    missing: 0,
                    error:
                        outcome === 'failed'
                            ? {
                                  code: 'SCAN_ERROR',
                                  message: err instanceof Error ? err.message : String(err),
                              }
                            : null,
                })
                this.finishBroadcasting()
            },
            complete: () => {
                // An aborted scan completes without a `completed` update.
                if (status.terminal === null) {
                    const outcome: LibraryScanOutcome = signal.aborted ? 'cancelled' : 'failed'
                    this.finishScan(status, outcome, {
                        failures,
                        discoveryFailureCount,
                        readFailureCount,
                        missing: 0,
                        error:
                            outcome === 'failed'
                                ? { code: 'SCAN_ERROR', message: 'The scan ended unexpectedly' }
                                : null,
                    })
                }
                this.finishBroadcasting()
            },
        })

        return status
    }

    cancel(): void {
        this.abortController?.abort()
    }

    getSnapshot(): LibraryScanSnapshot {
        return {
            status: this.status,
            albums: [...this.albums.values()].slice(-SNAPSHOT_ALBUM_LIMIT),
            lastScan: this.stateStore.get('lastScan') ?? null,
        }
    }

    private newStatus(trigger: LibraryScanTrigger, roots: string[]): LibraryScanStatus {
        return {
            scanId: ++this.scanIdCounter,
            revision: 0,
            trigger,
            phase: roots.length === 0 ? 'idle' : 'discovering',
            roots,
            startedAt: Date.now(),
            finishedAt: null,
            discovered: 0,
            new: 0,
            changed: 0,
            unchanged: 0,
            readDone: 0,
            readTotal: 0,
            imported: 0,
            failedFiles: 0,
            normalizationIssues: 0,
            terminal: null,
        }
    }

    /** Terminal transition for scans that never reached the pipeline (e.g. bad roots). */
    private finishWithoutScan(
        status: LibraryScanStatus,
        outcome: LibraryScanOutcome,
        error: LibraryScanTerminalError | null,
    ): void {
        this.startBroadcasting()
        this.finishScan(status, outcome, {
            failures: [],
            discoveryFailureCount: 0,
            readFailureCount: 0,
            missing: 0,
            error,
        })
        this.finishBroadcasting()
    }

    private finishScan(
        status: LibraryScanStatus,
        outcome: LibraryScanOutcome,
        details: {
            failures: LibraryScanFileFailure[]
            discoveryFailureCount: number
            readFailureCount: number
            missing: number
            error: LibraryScanTerminalError | null
        },
    ): void {
        status.phase = outcome
        status.finishedAt = Date.now()
        const terminal: LibraryScanTerminalResult = {
            outcome,
            scanId: status.scanId,
            trigger: status.trigger,
            roots: status.roots,
            startedAt: status.startedAt,
            finishedAt: status.finishedAt,
            discovered: status.discovered,
            new: status.new,
            changed: status.changed,
            unchanged: status.unchanged,
            missing: details.missing,
            readTotal: status.readTotal,
            readsAttempted: status.readDone,
            imported: status.imported,
            discoveryFailureCount: details.discoveryFailureCount,
            readFailureCount: details.readFailureCount,
            failures: details.failures,
            failuresTruncated:
                details.discoveryFailureCount + details.readFailureCount > details.failures.length,
            normalizationIssues: status.normalizationIssues,
            error: details.error,
        }
        status.terminal = terminal
        this.touch(status)
    }

    private touch(status: LibraryScanStatus): void {
        status.revision += 1
        this.dirty = true
    }

    private collectAlbumPreview(metadata: {
        albumTitle: string | null
        artist: string | null
        albumArtist: string | null
        coverPath: string | null
    }): void {
        if (!metadata.coverPath) return
        // The cover-art cache is content-addressed, so the path dedupes identical artwork.
        if (this.albums.has(metadata.coverPath)) return
        const preview: LibraryAlbumPreview = {
            albumTitle: metadata.albumTitle,
            artist: metadata.albumArtist ?? metadata.artist,
            coverPath: metadata.coverPath,
        }
        this.albums.set(metadata.coverPath, preview)
        this.pendingNewAlbums.push(preview)
    }

    private startBroadcasting(): void {
        this.broadcastTimer ??= setInterval(() => this.broadcastIfDirty(), BROADCAST_INTERVAL_MS)
    }

    private finishBroadcasting(): void {
        this.broadcastIfDirty()
        if (this.broadcastTimer) {
            clearInterval(this.broadcastTimer)
            this.broadcastTimer = null
        }
    }

    private broadcastIfDirty(): void {
        if (!this.dirty || !this.status) return
        this.dirty = false
        const event = {
            status: { ...this.status },
            newAlbums: this.pendingNewAlbums.splice(0),
        }
        for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) {
                toRendererEmitter(win.webContents).send(LibraryIpcChannel.scanStatus, event)
            }
        }
    }
}

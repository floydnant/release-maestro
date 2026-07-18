import {
    LibraryAlbumPreview,
    LibraryIpcChannel,
    LibraryLastScanInfo,
    LibraryScanSnapshot,
    LibraryScanStatus,
    LibraryScanTrigger,
    toRendererEmitter,
} from '@release-maestro/core'
import { BrowserWindow } from 'electron'
import { PersistentStore } from '../../utils/persistent-store.util'
import { SettingsBackendService } from '../settings.backend.service'
import { LibraryBackendService } from './library.backend.service'

/** How often (at most) scan-status snapshots are pushed to the renderer. */
const BROADCAST_INTERVAL_MS = 200
/** Album previews retained for late-mounting UI reseeds (`get-scan-status`). */
const SNAPSHOT_ALBUM_LIMIT = 200

export interface LibraryScanState extends Record<string, unknown> {
    lastScan?: LibraryLastScanInfo | null
}

/**
 * Main-process owner of the library scan lifecycle.
 *
 * Exactly one scan runs at a time (`startScan` is idempotent while scanning).
 * Status is kept as a full snapshot and broadcast to all windows on a dirty-flag
 * throttle, so late subscribers can rely on "latest event == current state" and
 * `getSnapshot()` covers the gap before the first subscription. Only the album
 * cover previews for the import mosaic are delta-shaped (`newAlbums`).
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
    startScan(trigger: LibraryScanTrigger, paths?: string[]): LibraryScanStatus {
        if (this.status && this.isScanning) return this.status

        const roots = paths ?? this.settings.getSettings().libraryFolders ?? []
        const status: LibraryScanStatus = {
            scanId: ++this.scanIdCounter,
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
            errors: 0,
            normalizationIssues: 0,
            lastErrorMessage: null,
            summary: null,
        }
        this.status = status
        if (roots.length === 0) return status

        this.albums.clear()
        this.pendingNewAlbums = []
        this.abortController = new AbortController()
        const { signal } = this.abortController
        this.startBroadcasting()

        this.library.scan(roots, signal).subscribe({
            next: update => {
                switch (update.phase) {
                    case 'discovery':
                        status.discovered = update.discovered
                        status.new = update.new
                        status.changed = update.changed
                        status.unchanged = update.unchanged
                        break
                    case 'started':
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
                        status.errors += 1
                        status.lastErrorMessage = update.error
                        break
                    case 'completed':
                        status.phase = 'completed'
                        status.finishedAt = Date.now()
                        status.summary = {
                            count: update.count,
                            total: update.total,
                            unchanged: update.unchanged,
                            changed: update.changed,
                            new: update.new,
                            missing: update.missing,
                            errors: update.errors,
                        }
                        this.stateStore.set('lastScan', {
                            ...status.summary,
                            finishedAt: status.finishedAt,
                            roots: status.roots,
                            normalizationIssues: status.normalizationIssues,
                        })
                        break
                    case 'error':
                        status.lastErrorMessage = update.error.message
                        break
                }
                this.dirty = true
            },
            error: err => {
                // An aborted deep read surfaces as a stream error — report it as a cancellation.
                status.phase = signal.aborted ? 'cancelled' : 'error'
                status.finishedAt = Date.now()
                if (!signal.aborted) {
                    status.lastErrorMessage = err instanceof Error ? err.message : String(err)
                }
                this.finishBroadcasting()
            },
            complete: () => {
                // An aborted scan completes without a `completed` update.
                if (status.phase !== 'completed') {
                    status.phase = signal.aborted ? 'cancelled' : 'error'
                    status.finishedAt = Date.now()
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
        this.dirty = true
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

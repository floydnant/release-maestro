import { computed, inject, Injectable, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import {
    LibraryAlbumPreview,
    LibraryIpcChannel,
    LibraryLastScanInfo,
    LibraryFolderValidation,
    LibraryScanStatus,
    LibraryScanStatusEvent,
    StartLibraryScanRequest,
} from '@release-maestro/core'
import { fromEventPattern, map } from 'rxjs'
import { ElectronService } from './electron/electron.service'
import { SettingsService } from '../settings/settings.service'

/**
 * Renderer-side view of the main-process-owned library scan lifecycle.
 *
 * The main process broadcasts full status snapshots on `library:scan-status`
 * (throttled), so this service just mirrors the latest event into signals.
 * It subscribes eagerly for the whole app lifetime and seeds itself from
 * `library:get-scan-status`. Push events and pulled snapshots are ordered by
 * `(scanId, revision)` — whichever is newer wins, so races between the two can
 * never regress local state.
 */
@Injectable({
    providedIn: 'root',
})
export class LibraryService {
    private electronService = inject(ElectronService)
    private settingsService = inject(SettingsService)

    private readonly scanStatus_ = signal<LibraryScanStatus | null>(null)
    private readonly mosaicAlbums_ = signal<LibraryAlbumPreview[]>([])
    private readonly lastScan_ = signal<LibraryLastScanInfo | null>(null)
    private seenCoverPaths = new Set<string>()

    /** Latest scan status snapshot (null until the first scan of this app session). */
    readonly scanStatus = this.scanStatus_.asReadonly()
    /** Album cover previews of the current/last scan, in arrival order (for the mosaic). */
    readonly mosaicAlbums = this.mosaicAlbums_.asReadonly()
    /** Persisted aggregate of the last completed scan. */
    readonly lastScan = this.lastScan_.asReadonly()

    readonly isScanning = computed(() => {
        const phase = this.scanStatus()?.phase
        return phase === 'discovering' || phase === 'reading'
    })
    readonly readProgressPercent = computed(() => {
        const status = this.scanStatus()
        if (!status || status.readTotal === 0) return 0
        return (status.readDone / status.readTotal) * 100
    })

    /** Resolves once the initial status snapshot has been fetched from the main process. */
    readonly synced: Promise<void>

    constructor() {
        if (!this.electronService.isElectron) {
            this.synced = Promise.resolve()
            return
        }

        fromEventPattern<[Electron.IpcRendererEvent, LibraryScanStatusEvent]>(
            handler => this.electronService.ipcRenderer.on(LibraryIpcChannel.scanStatus, handler),
            handler => this.electronService.ipcRenderer.off(LibraryIpcChannel.scanStatus, handler),
        )
            .pipe(
                map(([_event, statusEvent]) => statusEvent),
                takeUntilDestroyed(),
            )
            .subscribe(statusEvent => this.applyStatusEvent(statusEvent))

        this.synced = this.refreshSnapshot()
    }

    async refreshSnapshot(): Promise<void> {
        const snapshot = await this.electronService.ipcRenderer.invoke(LibraryIpcChannel.getScanStatus)
        this.lastScan_.set(snapshot.lastScan)
        if (snapshot.status && this.applyStatus(snapshot.status)) {
            // The pulled snapshot is authoritative for this scan: reseed the mosaic
            // from its cumulative album list (dedup state included).
            this.seenCoverPaths = new Set(snapshot.albums.map(album => album.coverPath))
            this.mosaicAlbums_.set(snapshot.albums)
        }
    }

    pickFolders(): Promise<string[] | null> {
        return this.electronService.ipcRenderer.invoke(LibraryIpcChannel.pickFolders)
    }

    validateFolders(paths: string[]): Promise<LibraryFolderValidation[]> {
        return this.electronService.ipcRenderer.invoke(LibraryIpcChannel.validateFolders, { paths })
    }

    /**
     * Start a scan. The returned status is applied right away so callers never
     * observe the *previous* scan's terminal state after this resolves (the first
     * pushed status event may be a throttle-tick away).
     */
    async startScan(
        trigger: StartLibraryScanRequest['trigger'],
        paths?: string[],
    ): Promise<LibraryScanStatus> {
        const status = await this.electronService.ipcRenderer.invoke(LibraryIpcChannel.startScan, {
            trigger,
            paths,
        })
        this.applyStatus(status)
        return status
    }

    cancelScan(): void {
        this.electronService.ipcRenderer.send(LibraryIpcChannel.cancelScan)
    }

    /**
     * Persist the full list of library folders in canonical form. Validation runs
     * in the main process and is advisory: unavailable and nested folders remain
     * configured, while aliases of the same canonical path collapse to one.
     */
    async saveFolders(folders: string[]): Promise<void> {
        const validations = await this.validateFolders(folders)
        const canonicalFolders = [...new Set(validations.map(validation => validation.canonicalPath))]
        await this.settingsService.patchSettings({ library: { folders: canonicalFolders } })
    }

    /** Remember that the user skipped library onboarding (keeps the nudge CTA instead). */
    async setOnboardingSkipped(): Promise<void> {
        await this.settingsService.patchSettings({ library: { onboardingSkipped: true } })
    }

    /**
     * Apply a status if it is not older than the current one. Returns whether it
     * was applied. Moving to a *different* scan resets the mosaic exactly once.
     */
    private applyStatus(incoming: LibraryScanStatus): boolean {
        const current = this.scanStatus_()
        if (current) {
            if (incoming.scanId < current.scanId) return false
            if (incoming.scanId === current.scanId && incoming.revision < current.revision) return false
        }
        if (!current || current.scanId !== incoming.scanId) {
            this.seenCoverPaths = new Set()
            this.mosaicAlbums_.set([])
        }
        this.scanStatus_.set(incoming)
        return true
    }

    private applyStatusEvent(statusEvent: LibraryScanStatusEvent): void {
        this.applyStatus(statusEvent.status)

        // Album deltas are safe to merge whenever they belong to the scan we are
        // showing — cover-path dedup makes replays idempotent.
        const current = this.scanStatus_()
        if (!current || current.scanId !== statusEvent.status.scanId) return
        const additions = statusEvent.newAlbums.filter(album => !this.seenCoverPaths.has(album.coverPath))
        if (additions.length > 0) {
            for (const album of additions) this.seenCoverPaths.add(album.coverPath)
            this.mosaicAlbums_.update(albums => [...albums, ...additions])
        }
    }
}

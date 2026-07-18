import { computed, inject, Injectable, signal } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import {
    LibraryAlbumPreview,
    LibraryIpcChannel,
    LibraryLastScanInfo,
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
 * `library:get-scan-status`, so late-mounting views never miss a running scan.
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
    private receivedPush = false

    /** Latest scan status snapshot (null until the first scan of this app session). */
    readonly scanStatus = this.scanStatus_.asReadonly()
    /** Album cover previews of the current/last scan, in arrival order (for the mosaic). */
    readonly mosaicAlbums = this.mosaicAlbums_.asReadonly()
    /** Persisted summary of the last completed scan. */
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
        if (snapshot.status && (!this.receivedPush || this.scanStatus() === null)) {
            this.scanStatus_.set(snapshot.status)
            this.seenCoverPaths = new Set(snapshot.albums.map(album => album.coverPath))
            this.mosaicAlbums_.set(snapshot.albums)
        }
    }

    pickFolders(): Promise<string[] | null> {
        return this.electronService.ipcRenderer.invoke(LibraryIpcChannel.pickFolders)
    }

    startScan(trigger: StartLibraryScanRequest['trigger'], paths?: string[]): Promise<LibraryScanStatus> {
        return this.electronService.ipcRenderer.invoke(LibraryIpcChannel.startScan, { trigger, paths })
    }

    cancelScan(): void {
        this.electronService.ipcRenderer.send(LibraryIpcChannel.cancelScan)
    }

    /** Persist the full list of library folders (deduped, order preserved). */
    async saveFolders(folders: string[]): Promise<void> {
        const settings = await this.electronService.ipcRenderer.invoke('get-settings')
        await this.settingsService.setSettings({
            ...settings,
            libraryFolders: [...new Set(folders)],
        })
    }

    /** Remember that the user skipped library onboarding (keeps the nudge CTA instead). */
    async setOnboardingSkipped(): Promise<void> {
        const settings = await this.electronService.ipcRenderer.invoke('get-settings')
        await this.settingsService.setSettings({ ...settings, libraryOnboardingSkipped: true })
    }

    private applyStatusEvent(statusEvent: LibraryScanStatusEvent): void {
        this.receivedPush = true
        const previous = this.scanStatus()
        if (!previous || previous.scanId !== statusEvent.status.scanId) {
            this.seenCoverPaths = new Set()
            this.mosaicAlbums_.set([])
        }
        this.scanStatus_.set(statusEvent.status)

        const additions = statusEvent.newAlbums.filter(album => !this.seenCoverPaths.has(album.coverPath))
        if (additions.length > 0) {
            for (const album of additions) this.seenCoverPaths.add(album.coverPath)
            this.mosaicAlbums_.update(albums => [...albums, ...additions])
        }
    }
}

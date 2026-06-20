import { JsonPipe } from '@angular/common'
import { Component, computed, inject, signal, ChangeDetectionStrategy } from '@angular/core'
import { takeUntilDestroyed } from '@angular/core/rxjs-interop'
import { FormsModule } from '@angular/forms'
import { MetadataScanUpdate, ScanResult, SongMetadata, SongMetadataUpdate } from '@release-maestro/core'
import { MetadataService } from '../../../core/services/metadata.service'
import {
    ProgressBarComponent,
    ProgressBarSegment,
} from '../../../shared/components/progress-bar/progress-bar.component'

const getErrorMessage = (error: unknown): string => {
    if (typeof error === 'string') return error
    if (error instanceof Error) return error.message
    try {
        return JSON.stringify(error)
    } catch {
        return String(error)
    }
}

interface ScanLogEntry {
    id: number
    at: Date
    update: MetadataScanUpdate
}

interface ScanSessionStats {
    events: number
    items: number
    errors: number
}

const MAX_SCAN_EVENTS = 600

@Component({
    selector: 'app-debug',
    imports: [FormsModule, JsonPipe, ProgressBarComponent],
    templateUrl: './debug.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: `
        :host {
            @apply block h-full;
        }
    `,
})
export class DebugComponent {
    private readonly metadataService = inject(MetadataService)
    private scanEventId = 0

    pingResult = signal<unknown>(null)
    pingError = signal<string | null>(null)
    pingInFlight = signal(false)

    readPath = signal('')
    readResult = signal<unknown>(null)
    readError = signal<string | null>(null)

    writePath = signal('')
    writePayloadText = signal('{\n  "title": "Quick test title",\n  "musicalKey": "Am"\n}')
    writeResult = signal<unknown>(null)
    writeError = signal<string | null>(null)

    scanPathsText = signal('')
    scanInFlight = signal(false)
    scanStartedAt = signal<Date | null>(null)
    scanFinishedAt = signal<Date | null>(null)
    scanSummary = signal<ScanResult | undefined>(undefined)
    scanError = signal<string | null>(null)
    scanSessionStats = signal<ScanSessionStats>({
        events: 0,
        items: 0,
        errors: 0,
    })
    scanProgressState = signal<{ done: number; total: number } | null>(null)
    scanEvents = signal<ScanLogEntry[]>([])
    selectedErrorEvent = signal<ScanLogEntry | null>(null)
    progress = computed(() => {
        const progress = this.scanProgressState()
        if (!progress || progress.total == 0) return 0
        return Math.round((progress.done / progress.total) * 100)
    })
    scanProgressSegments = computed<ProgressBarSegment[]>(() => [
        {
            percent: this.progress(),
            color: 'content.success',
        },
    ])
    workerHealthText = computed(() => {
        if (this.pingInFlight()) return 'Checking'
        if (this.pingError()) return 'Unavailable'
        if (this.pingResult()) return 'Ready'
        return 'Unknown'
    })
    workerHealthClass = computed(() => {
        if (this.pingInFlight())
            return 'border-status-warning-border bg-status-warning-background text-status-warning-content'
        if (this.pingError())
            return 'border-status-danger-border bg-status-danger-background text-status-danger-content'
        if (this.pingResult())
            return 'border-status-success-border bg-status-success-background text-status-success-content'
        return 'border-border-default bg-background-elevated text-content-secondary'
    })
    latestProgress = computed(() => this.scanProgressState())
    lastItem = computed(() => {
        const events = this.scanEvents().map(entry => entry.update)
        return [...events].reverse().find(e => e.phase == 'item')?.metadata || null
    })
    lastError = computed(() => {
        const events = this.scanEvents().map(entry => entry.update)
        return [...events].reverse().find(e => e.phase == 'itemError' || e.phase == 'error') || null
    })
    scanDurationText = computed(() => {
        const started = this.scanStartedAt()
        if (!started) return 'not started'
        const finished = this.scanFinishedAt()
        const end = finished ?? new Date()
        return this.formatDuration(end.getTime() - started.getTime())
    })
    recentScanEvents = computed(() => [...this.scanEvents()].reverse().slice(0, 120))

    constructor() {
        this.metadataService.scanProgress$.pipe(takeUntilDestroyed()).subscribe(update => {
            this.recordScanEvent(update)
            if (update.phase == 'completed' || update.phase == 'error') {
                this.scanInFlight.set(false)
                this.scanFinishedAt.set(new Date())
            }
        })
        void this.ping()
    }

    async ping(): Promise<void> {
        this.pingError.set(null)
        this.pingResult.set(null)
        this.pingInFlight.set(true)
        try {
            this.pingResult.set(await this.metadataService.ping())
        } catch (error) {
            this.pingError.set(getErrorMessage(error))
        } finally {
            this.pingInFlight.set(false)
        }
    }

    async readFile(): Promise<void> {
        const path = this.readPath().trim()
        if (!path) {
            this.readError.set('Path is required.')
            return
        }

        this.readError.set(null)
        this.readResult.set(null)
        try {
            this.readResult.set(await this.metadataService.readFile(path))
        } catch (error) {
            this.readError.set(getErrorMessage(error))
        }
    }

    async writeTags(): Promise<void> {
        const path = this.writePath().trim()
        if (!path) {
            this.writeError.set('Path is required.')
            return
        }

        let payload: SongMetadataUpdate
        try {
            payload = JSON.parse(this.writePayloadText()) as SongMetadataUpdate
        } catch (error) {
            this.writeError.set(`Invalid JSON payload: ${getErrorMessage(error)}`)
            return
        }

        this.writeError.set(null)
        this.writeResult.set(null)
        try {
            this.writeResult.set(await this.metadataService.writeTags(path, payload))
        } catch (error) {
            this.writeError.set(getErrorMessage(error))
        }
    }

    async startScan(): Promise<void> {
        const paths = this.parsePaths(this.scanPathsText())
        if (!paths.length) {
            this.scanError.set('Provide at least one path (newline or comma separated).')
            return
        }

        this.scanError.set(null)
        this.scanSummary.set(undefined)
        this.scanEvents.set([])
        this.scanSessionStats.set({
            events: 0,
            items: 0,
            errors: 0,
        })
        this.scanProgressState.set(null)
        this.selectedErrorEvent.set(null)
        this.scanStartedAt.set(new Date())
        this.scanFinishedAt.set(null)
        this.scanEventId = 0
        this.scanInFlight.set(true)

        try {
            this.scanSummary.set(await this.metadataService.scan(paths))
        } catch (error) {
            this.scanInFlight.set(false)
            this.scanError.set(getErrorMessage(error))
        }
    }

    cancelScan(): void {
        this.metadataService.cancelScan()
    }

    setReadPathFromLastItem(): void {
        const item = this.lastItem()
        if (item) this.readPath.set(item.path)
    }

    setWritePathFromReadPath(): void {
        this.writePath.set(this.readPath())
    }

    clearScanEvents(): void {
        this.scanEvents.set([])
        this.selectedErrorEvent.set(null)
    }

    selectErrorEvent(entry: ScanLogEntry): void {
        if (!this.isErrorEvent(entry.update)) return
        this.selectedErrorEvent.set(entry)
    }

    isErrorEvent(update: MetadataScanUpdate): boolean {
        return update.phase == 'itemError' || update.phase == 'error'
    }

    scanPhaseClass(phase: MetadataScanUpdate['phase']): string {
        switch (phase) {
            case 'completed':
                return 'border-status-success-border bg-status-success-background text-status-success-content'
            case 'error':
            case 'itemError':
                return 'border-status-danger-border bg-status-danger-background text-status-danger-content'
            case 'item':
                return 'border-action-primary bg-action-quiet-hover text-content-action'
            case 'progress':
                return 'border-status-warning-border bg-status-warning-background text-status-warning-content'
            case 'started':
                return 'border-border-default bg-background-elevated text-content-secondary'
        }
    }

    eventDetail(update: MetadataScanUpdate): string {
        switch (update.phase) {
            case 'started':
                return `deep-read total ${update.total}`
            case 'progress':
                return `${update.done}/${update.total}`
            case 'item':
                return update.metadata.path
            case 'itemError':
                return `${update.path}: ${update.error}`
            case 'completed':
                return `count ${update.count}, total ${update.total}, new ${update.new ?? 0}, changed ${
                    update.changed ?? 0
                }, unchanged ${update.unchanged ?? 0}, missing ${update.missing ?? 0}, errors ${
                    update.errors ?? 0
                }`
            case 'error':
                return `${update.error.code}: ${update.error.message}`
        }
    }

    eventDiscriminator(update: MetadataScanUpdate): string {
        switch (update.phase) {
            case 'itemError':
                return update.code ?? 'ITEM_ERROR'
            case 'error':
                return update.error.code
            case 'completed':
                return update.errors ? 'HAS_ERRORS' : 'OK'
            case 'started':
                return 'SCAN'
            case 'progress':
                return 'PROGRESS'
            case 'item':
                return 'ITEM'
        }
    }

    eventSummary(update: MetadataScanUpdate): string {
        switch (update.phase) {
            case 'itemError':
                return update.error
            case 'error':
                return update.error.message
            default:
                return this.eventDetail(update)
        }
    }

    errorEventPath(update: MetadataScanUpdate): string {
        if (update.phase == 'itemError') return update.path
        return ''
    }

    selectedErrorPayload(): unknown {
        return this.selectedErrorEvent()?.update ?? null
    }

    formatTime(date: Date): string {
        return date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
    }

    metadataPreview(metadata: SongMetadata): string {
        return [
            metadata.title,
            metadata.artist,
            metadata.albumTitle,
            metadata.genre,
            metadata.coverPath ? 'cover' : null,
        ]
            .filter(Boolean)
            .join(' · ')
    }

    private parsePaths(raw: string): string[] {
        return raw
            .split(/\r?\n|,/)
            .map(path => path.trim())
            .filter(Boolean)
    }

    private recordScanEvent(update: MetadataScanUpdate): void {
        this.recordScanSessionStats(update)
        this.scanEvents.update(events => {
            const next = [
                ...events,
                {
                    id: ++this.scanEventId,
                    at: new Date(),
                    update,
                },
            ]
            return next.slice(-MAX_SCAN_EVENTS)
        })
    }

    private recordScanSessionStats(update: MetadataScanUpdate): void {
        if (update.phase == 'started') {
            this.scanProgressState.set({ done: 0, total: update.total })
        } else if (update.phase == 'progress') {
            this.scanProgressState.set({ done: update.done, total: update.total })
        }

        this.scanSessionStats.update(stats => ({
            events: stats.events + 1,
            items: stats.items + (update.phase == 'item' ? 1 : 0),
            errors: stats.errors + (update.phase == 'itemError' || update.phase == 'error' ? 1 : 0),
        }))
    }

    private formatDuration(durationMs: number): string {
        if (durationMs < 1000) return `${durationMs}ms`
        const seconds = durationMs / 1000
        if (seconds < 60) return `${seconds.toFixed(1)}s`
        const minutes = Math.floor(seconds / 60)
        return `${minutes}m ${Math.round(seconds % 60)}s`
    }
}

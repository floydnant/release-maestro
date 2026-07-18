import { JsonPipe } from '@angular/common'
import { Component, computed, effect, inject, signal, ChangeDetectionStrategy } from '@angular/core'
import { FormsModule } from '@angular/forms'
import { LibraryScanPhase, LibraryScanStatus, SongMetadataUpdate } from '@release-maestro/core'
import { LibraryService } from '../../../core/services/library.service'
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

interface ScanStatusLogEntry {
    id: number
    at: Date
    status: LibraryScanStatus
}

const MAX_SCAN_LOG_ENTRIES = 200

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
    readonly library = inject(LibraryService)
    private scanLogId = 0

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
    scanError = signal<string | null>(null)
    scanStatusLog = signal<ScanStatusLogEntry[]>([])

    scanInFlight = this.library.isScanning
    scanStatus = this.library.scanStatus
    progress = computed(() => Math.round(this.library.readProgressPercent()))
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
    scanDurationText = computed(() => {
        const status = this.scanStatus()
        if (!status || status.phase === 'idle') return 'not started'
        const end = status.finishedAt ?? Date.now()
        return this.formatDuration(end - status.startedAt)
    })
    recentScanLogEntries = computed(() => [...this.scanStatusLog()].reverse().slice(0, 120))

    constructor() {
        effect(() => {
            const status = this.scanStatus()
            if (!status) return
            this.scanStatusLog.update(entries => {
                const next = [
                    ...entries,
                    {
                        id: ++this.scanLogId,
                        at: new Date(),
                        status,
                    },
                ]
                return next.slice(-MAX_SCAN_LOG_ENTRIES)
            })
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

    /** Starts a scan of the entered paths, or the configured library folders when left empty. */
    async startScan(): Promise<void> {
        const paths = this.parsePaths(this.scanPathsText())
        this.scanError.set(null)
        try {
            const status = await this.library.startScan('debug', paths.length ? paths : undefined)
            if (status.phase === 'idle') {
                this.scanError.set('Nothing to scan: provide at least one path or configure library folders.')
            }
        } catch (error) {
            this.scanError.set(getErrorMessage(error))
        }
    }

    cancelScan(): void {
        this.library.cancelScan()
    }

    setWritePathFromReadPath(): void {
        this.writePath.set(this.readPath())
    }

    clearScanLog(): void {
        this.scanStatusLog.set([])
    }

    scanPhaseClass(phase: LibraryScanPhase): string {
        switch (phase) {
            case 'completed':
                return 'border-status-success-border bg-status-success-background text-status-success-content'
            case 'failed':
                return 'border-status-danger-border bg-status-danger-background text-status-danger-content'
            case 'cancelled':
                return 'border-status-warning-border bg-status-warning-background text-status-warning-content'
            case 'discovering':
            case 'reading':
                return 'border-action-primary bg-action-quiet-hover text-content-action'
            case 'idle':
                return 'border-border-default bg-background-elevated text-content-secondary'
        }
    }

    logEntryDetail(status: LibraryScanStatus): string {
        const terminal = status.terminal
        switch (status.phase) {
            case 'discovering':
                return `discovered ${status.discovered} (new ${status.new}, changed ${status.changed}, unchanged ${status.unchanged})`
            case 'reading':
                return `read ${status.readDone}/${status.readTotal}, imported ${status.imported}, failed ${status.failedFiles}, issues ${status.normalizationIssues}`
            case 'completed':
                return `imported ${terminal?.imported ?? 0}, discovered ${
                    terminal?.discovered ?? 0
                }, new ${terminal?.new ?? 0}, changed ${terminal?.changed ?? 0}, unchanged ${
                    terminal?.unchanged ?? 0
                }, missing ${terminal?.missing ?? 0}, failed ${
                    (terminal?.discoveryFailureCount ?? 0) + (terminal?.readFailureCount ?? 0)
                }`
            case 'failed':
            case 'cancelled':
                return terminal?.error?.message ?? '—'
            case 'idle':
                return 'no library folders configured'
        }
    }

    formatTime(date: Date): string {
        return date.toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        })
    }

    private parsePaths(raw: string): string[] {
        return raw
            .split(/\r?\n|,/)
            .map(path => path.trim())
            .filter(Boolean)
    }

    private formatDuration(durationMs: number): string {
        if (durationMs < 1000) return `${durationMs}ms`
        const seconds = durationMs / 1000
        if (seconds < 60) return `${seconds.toFixed(1)}s`
        const minutes = Math.floor(seconds / 60)
        return `${minutes}m ${Math.round(seconds % 60)}s`
    }
}

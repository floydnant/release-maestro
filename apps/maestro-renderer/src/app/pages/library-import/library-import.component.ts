import { NgClass } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core'
import { Router, RouterModule } from '@angular/router'
import { LibraryRootValidation, LibraryScanTerminalResult } from '@release-maestro/core'
import { ElectronService } from '../../core/services'
import { LibraryService } from '../../core/services/library.service'
import { FolderListComponent } from '../../shared/components/folder-list/folder-list.component'
import { IconComponent } from '../../shared/components/icon/icon.component'
import {
    ProgressBarComponent,
    ProgressBarSegment,
} from '../../shared/components/progress-bar/progress-bar.component'
import { ProgressRingComponent } from '../../shared/components/progress-ring/progress-ring.component'
import { ImportMosaicComponent } from './import-mosaic.component'

type ImportStep = 'pick' | 'scanning' | 'done'

/**
 * Full-page library onboarding/import flow: choose folders → watch the scan
 * (cover mosaic + live stats) → completion summary. Also reachable later to
 * change folders or re-run an import; resumes into the scanning step when a
 * scan is already running.
 */
@Component({
    selector: 'app-library-import',
    imports: [
        RouterModule,
        ProgressBarComponent,
        ProgressRingComponent,
        IconComponent,
        ImportMosaicComponent,
        FolderListComponent,
        NgClass,
    ],
    templateUrl: './library-import.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    styles: `
        :host {
            @apply block size-full;
        }

        /* Fades the full-window mosaic gently toward the top and bottom edges (pure
           black so the covers pop against it). */
        .mosaic-veil {
            background: linear-gradient(
                to bottom,
                rgb(0 0 0 / 0.9) 0%,
                transparent 25%,
                transparent 75%,
                rgb(0 0 0 / 0.9) 100%
            );
        }
    `,
})
export class LibraryImportComponent {
    private readonly electronService = inject(ElectronService)
    private readonly router = inject(Router)
    readonly library = inject(LibraryService)

    readonly step = signal<ImportStep>('pick')
    readonly pendingFolders = signal<string[]>([])
    readonly startInFlight = signal(false)
    readonly rootValidations = signal<LibraryRootValidation[]>([])
    /** Scan this page is following; a completed *older* scan must not flip us to "done". */
    private readonly watchedScanId = signal<number | null>(null)
    private validationToken = 0

    /** Terminal result shown as a banner on the scanning step (cancelled/failed). */
    readonly terminalBanner = computed<LibraryScanTerminalResult | null>(() => {
        const terminal = this.library.scanStatus()?.terminal
        if (!terminal) return null
        return terminal.outcome === 'cancelled' || terminal.outcome === 'failed' ? terminal : null
    })

    readonly progressSegments = computed<ProgressBarSegment[]>(() => [
        { percent: this.library.readProgressPercent(), color: 'content.success' },
    ])

    readonly noFilesFound = computed(() => {
        const terminal = this.library.scanStatus()?.terminal
        return terminal?.outcome === 'completed' && terminal.discovered === 0
    })

    /** Folders may only be saved/scanned when every selection validated cleanly. */
    readonly hasInvalidFolders = computed(() =>
        this.rootValidations().some(validation => !validation.available),
    )

    constructor() {
        void this.initialize()

        // Follow the running scan into the done step while the user is watching.
        effect(() => {
            const status = this.library.scanStatus()
            if (!status || status.scanId !== this.watchedScanId()) return
            if (this.step() === 'scanning' && status.terminal?.outcome === 'completed') {
                this.step.set('done')
            }
        })

        // Re-validate the selection whenever it changes.
        effect(() => {
            const folders = this.pendingFolders()
            const token = ++this.validationToken
            if (folders.length === 0 || !this.electronService.isElectron) {
                this.rootValidations.set([])
                return
            }
            void this.library.validateRoots(folders).then(validations => {
                if (token === this.validationToken) this.rootValidations.set(validations)
            })
        })
    }

    private async initialize(): Promise<void> {
        await this.library.synced
        if (this.library.isScanning()) {
            this.watchedScanId.set(this.library.scanStatus()?.scanId ?? null)
            this.step.set('scanning')
            return
        }
        if (this.electronService.isElectron) {
            const settings = await this.electronService.ipcRenderer.invoke('get-settings')
            this.pendingFolders.set(settings.libraryFolders ?? [])
        }
    }

    async addFolders(): Promise<void> {
        const picked = await this.library.pickFolders()
        if (!picked?.length) return
        this.addPaths(picked)
    }

    removeFolder(folder: string): void {
        this.pendingFolders.update(folders => folders.filter(f => f !== folder))
    }

    addPaths(paths: string[]): void {
        if (paths.length === 0) return
        this.pendingFolders.update(folders => [...new Set([...folders, ...paths])])
    }

    async startImport(): Promise<void> {
        const folders = this.pendingFolders()
        if (folders.length === 0 || this.hasInvalidFolders() || this.startInFlight()) return
        this.startInFlight.set(true)
        try {
            await this.library.saveFolders(folders)
            const status = await this.library.startScan('onboarding')
            this.watchedScanId.set(status.scanId)
            this.step.set('scanning')
        } finally {
            this.startInFlight.set(false)
        }
    }

    async retryScan(): Promise<void> {
        const status = await this.library.startScan('onboarding')
        this.watchedScanId.set(status.scanId)
        this.step.set('scanning')
    }

    cancelScan(): void {
        this.library.cancelScan()
    }

    backToFolders(): void {
        this.step.set('pick')
    }

    async skip(): Promise<void> {
        await this.library.setOnboardingSkipped()
        await this.router.navigate(['/home'])
    }

    async finish(): Promise<void> {
        await this.router.navigate(['/home'])
    }
}

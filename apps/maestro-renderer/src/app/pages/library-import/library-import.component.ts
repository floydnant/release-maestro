import { NgClass } from '@angular/common'
import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core'
import { Router, RouterModule } from '@angular/router'
import { LibraryRootValidation, LibraryScanTerminalResult } from '@release-maestro/core'
import { ElectronService } from '../../core/services'
import { LibraryService } from '../../core/services/library.service'
import { IconComponent } from '../../shared/components/icon/icon.component'
import {
    ProgressBarComponent,
    ProgressBarSegment,
} from '../../shared/components/progress-bar/progress-bar.component'
import { ProgressRingComponent } from '../../shared/components/progress-ring/progress-ring.component'
import { splitPathBaseName } from '../../shared/utils/formatting.utils'
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

        /* Full-width band behind the centered UI: solid black through the content,
           fading out above and below so the cover wall shines around it. Its height
           follows the content, so it always fits the UI instead of an arbitrary shape. */
        .content-band {
            @apply mx-auto w-fit rounded-xl border border-border-subtle bg-black/70 px-10 py-16 shadow-lg backdrop-blur-md;
        }

        /* Empty-state drop zone: a dashed target that also opens the folder picker.
           (Translucent fills use color-mix — Tailwind's /opacity modifier isn't
           available on these custom color tokens under @apply.) */
        .dropzone {
            @apply cursor-pointer border-border-default hover:border-border-strong hover:bg-background-surface;
            background: color-mix(in srgb, theme('colors.background.surface') 40%, transparent);
        }
        .dropzone--active,
        .dropzone--active:hover {
            @apply border-border-focus;
            background: color-mix(in srgb, theme('colors.status.info-background') 50%, transparent);
        }

        /* Populated folder list doubles as a drop target; it tints while dragging. */
        .dropzone-list--active {
            @apply border-border-focus;
            background: color-mix(in srgb, theme('colors.status.info-background') 40%, transparent);
        }
        .add-row {
            @apply cursor-pointer text-content-secondary hover:bg-action-quiet-hover hover:text-content-primary;
        }
        /* The "Drop to add" cue shown over the list while dragging. */
        .dropzone-overlay {
            @apply text-content-info backdrop-blur-sm;
            background: color-mix(in srgb, theme('colors.status.info-background') 70%, transparent);
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
    /** True while folders are being dragged over the folder area (drop-target highlight). */
    readonly isDragging = signal(false)
    private validationToken = 0
    // Depth counter so dragenter/dragleave bubbling over children doesn't flicker.
    private dragDepth = 0

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
            if (this.step() === 'scanning' && status?.terminal?.outcome === 'completed') {
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
            this.step.set('scanning')
            return
        }
        if (this.electronService.isElectron) {
            const settings = await this.electronService.ipcRenderer.invoke('get-settings')
            this.pendingFolders.set(settings.libraryFolders ?? [])
        }
    }

    validationFor(folder: string): LibraryRootValidation | undefined {
        return this.rootValidations().find(validation => validation.path === folder)
    }

    async addFolders(): Promise<void> {
        const picked = await this.library.pickFolders()
        if (!picked?.length) return
        this.addPaths(picked)
    }

    removeFolder(folder: string): void {
        this.pendingFolders.update(folders => folders.filter(f => f !== folder))
    }

    onDragEnter(event: DragEvent): void {
        if (!hasFileDrag(event)) return
        event.preventDefault()
        this.dragDepth++
        this.isDragging.set(true)
    }

    onDragOver(event: DragEvent): void {
        if (!hasFileDrag(event)) return
        // Both preventDefault and a copy dropEffect are required for `drop` to fire.
        event.preventDefault()
        if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }

    onDragLeave(): void {
        this.dragDepth = Math.max(0, this.dragDepth - 1)
        if (this.dragDepth === 0) this.isDragging.set(false)
    }

    onDrop(event: DragEvent): void {
        event.preventDefault()
        this.dragDepth = 0
        this.isDragging.set(false)
        const paths = Array.from(event.dataTransfer?.files ?? [])
            .map(file => this.electronService.getPathForFile(file))
            .filter((path): path is string => path !== null)
        // Non-folder drops (files) are kept too — validation flags them as "Not a folder".
        this.addPaths(paths)
    }

    private addPaths(paths: string[]): void {
        if (paths.length === 0) return
        this.pendingFolders.update(folders => [...new Set([...folders, ...paths])])
    }

    async startImport(): Promise<void> {
        const folders = this.pendingFolders()
        if (folders.length === 0 || this.hasInvalidFolders() || this.startInFlight()) return
        this.startInFlight.set(true)
        try {
            await this.library.saveFolders(folders)
            await this.library.startScan('onboarding')
            this.step.set('scanning')
        } finally {
            this.startInFlight.set(false)
        }
    }

    async retryScan(): Promise<void> {
        await this.library.startScan('onboarding')
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

    folderParent(path: string): string {
        return splitPathBaseName(path).parent
    }

    folderName(path: string): string {
        return splitPathBaseName(path).base || path
    }

    summaryLine(terminal: LibraryScanTerminalResult): string {
        const failed = terminal.discoveryFailureCount + terminal.readFailureCount
        const parts = [`${terminal.imported} tracks imported`]
        if (failed) parts.push(`${failed} failed`)
        if (terminal.normalizationIssues) parts.push(`${terminal.normalizationIssues} with tag issues`)
        return parts.join(' · ')
    }
}

/** True when a drag carries filesystem items (so we can offer to add them as folders). */
const hasFileDrag = (event: DragEvent): boolean =>
    Array.from(event.dataTransfer?.types ?? []).includes('Files')

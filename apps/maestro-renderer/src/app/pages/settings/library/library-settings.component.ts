import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core'
import { LibraryRootValidation, LibraryScanTerminalResult } from '@release-maestro/core'
import { ElectronService } from '../../../core/services'
import { LibraryService } from '../../../core/services/library.service'
import { FolderListComponent } from '../../../shared/components/folder-list/folder-list.component'
import { IconComponent } from '../../../shared/components/icon/icon.component'
import { ProgressRingComponent } from '../../../shared/components/progress-ring/progress-ring.component'
import { formatDateRelative, splitPathBaseName } from '../../../shared/utils/formatting.utils'

const OUTCOME_LABELS: Record<LibraryScanTerminalResult['outcome'], string> = {
    completed: 'Completed',
    cancelled: 'Cancelled',
    failed: 'Failed',
}

/**
 * Minimal library management: stage folder edits, then "Save and rescan" persists
 * them and kicks off a rescan (which also flags songs under removed folders as
 * no longer present — rows are kept, only marked not-present). Also surfaces the
 * latest terminal scan result of this session, including per-file failures.
 */
@Component({
    selector: 'app-library-settings',
    imports: [IconComponent, ProgressRingComponent, FolderListComponent],
    templateUrl: './library-settings.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibrarySettingsComponent {
    private readonly electronService = inject(ElectronService)
    readonly library = inject(LibraryService)

    readonly folders = signal<string[]>([])
    private readonly savedFolders = signal<string[]>([])
    readonly saveInFlight = signal(false)
    readonly rootValidations = signal<LibraryRootValidation[]>([])
    private validationToken = 0

    readonly isDirty = computed(() => {
        const folders = this.folders()
        const saved = this.savedFolders()
        return folders.length !== saved.length || folders.some((folder, i) => folder !== saved[i])
    })

    readonly hasInvalidFolders = computed(() =>
        this.rootValidations().some(validation => !validation.available),
    )

    /** Terminal result of the most recent scan in this app session. */
    readonly terminal = computed(() => this.library.scanStatus()?.terminal ?? null)

    /**
     * Roots the last scan could not reach. Their tracks were reconciled as missing,
     * so the count is only explicable alongside this list.
     */
    readonly unavailableRootsText = computed(() => {
        const unavailable = this.terminal()?.unavailableRoots ?? []
        if (unavailable.length === 0) return null
        return `Could not reach ${unavailable.join(', ')} — tracks under ${
            unavailable.length === 1 ? 'it' : 'them'
        } are marked missing until the folder is back.`
    })

    readonly terminalSummaryText = computed(() => {
        const terminal = this.terminal()
        if (!terminal) return null
        const failed = terminal.discoveryFailureCount + terminal.readFailureCount
        const parts = [`${terminal.discovered} files discovered`, `${terminal.imported} imported`]
        if (terminal.missing) parts.push(`${terminal.missing} missing`)
        if (failed) parts.push(`${failed} failed`)
        if (terminal.normalizationIssues) {
            parts.push(`${terminal.normalizationIssues} with tag issues`)
        }
        return `${OUTCOME_LABELS[terminal.outcome]} ${formatDateRelative(
            new Date(terminal.finishedAt),
        )} · ${parts.join(', ')}`
    })

    readonly lastScanText = computed(() => {
        const lastScan = this.library.lastScan()
        if (!lastScan) return null
        // `total` is the number of files seen by the scan; `count` would only be
        // the tracks (re-)ingested, which is 0 on a no-op rescan.
        const parts = [`${lastScan.total} tracks`]
        if (lastScan.new) parts.push(`${lastScan.new} new`)
        if (lastScan.changed) parts.push(`${lastScan.changed} changed`)
        if (lastScan.missing) parts.push(`${lastScan.missing} missing`)
        if (lastScan.errors) parts.push(`${lastScan.errors} failed`)
        if (lastScan.normalizationIssues) parts.push(`${lastScan.normalizationIssues} tag issues`)
        return `${formatDateRelative(new Date(lastScan.finishedAt))} · ${parts.join(', ')}`
    })

    constructor() {
        void this.loadFolders()

        // Refresh the last-scan panel when a running scan finishes.
        effect(() => {
            if (this.library.scanStatus()?.terminal?.outcome === 'completed') {
                void this.library.refreshSnapshot()
            }
        })

        // Re-validate the staged folders whenever they change.
        effect(() => {
            const folders = this.folders()
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

    private async loadFolders(): Promise<void> {
        if (!this.electronService.isElectron) return
        const settings = await this.electronService.ipcRenderer.invoke('get-settings')
        const folders = settings.library?.folders ?? []
        this.folders.set(folders)
        this.savedFolders.set(folders)
    }

    /** "Reveal in Finder" on macOS, the generic wording everywhere else. */
    readonly revealLabel =
        this.electronService.platform === 'darwin' ? 'Reveal in Finder' : 'Show in file manager'

    folderParent(path: string): string {
        return splitPathBaseName(path).parent
    }

    folderName(path: string): string {
        return splitPathBaseName(path).base || path
    }

    async addFolders(): Promise<void> {
        const picked = await this.library.pickFolders()
        if (!picked?.length) return
        this.addPaths(picked)
    }

    addPaths(paths: string[]): void {
        if (paths.length === 0) return
        this.folders.update(folders => [...new Set([...folders, ...paths])])
    }

    removeFolder(folder: string): void {
        this.folders.update(folders => folders.filter(f => f !== folder))
    }

    /** Open the OS file manager on a failed file, so the user can inspect it. */
    revealFile(path: string): void {
        void this.electronService.revealInFileManager(path)
    }

    async saveAndRescan(): Promise<void> {
        if (this.saveInFlight() || this.library.isScanning() || this.hasInvalidFolders()) return
        this.saveInFlight.set(true)
        try {
            if (this.isDirty()) {
                await this.library.saveFolders(this.folders())
                this.savedFolders.set(this.folders())
            }
            await this.library.startScan('manual')
        } finally {
            this.saveInFlight.set(false)
        }
    }
}

import { ChangeDetectionStrategy, Component, computed, effect, inject, signal } from '@angular/core'
import { ElectronService } from '../../../core/services'
import { LibraryService } from '../../../core/services/library.service'
import { IconComponent } from '../../../shared/components/icon/icon.component'
import { ProgressRingComponent } from '../../../shared/components/progress-ring/progress-ring.component'
import { formatDateRelative, splitPathBaseName } from '../../../shared/utils/formatting.utils'

/**
 * Minimal library management: stage folder edits, then "Save and rescan" persists
 * them and kicks off a rescan (which also flags songs under removed folders as
 * no longer present — rows are kept, only marked not-present).
 */
@Component({
    selector: 'app-library-settings',
    imports: [IconComponent, ProgressRingComponent],
    templateUrl: './library-settings.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LibrarySettingsComponent {
    private readonly electronService = inject(ElectronService)
    readonly library = inject(LibraryService)

    readonly folders = signal<string[]>([])
    private readonly savedFolders = signal<string[]>([])
    readonly saveInFlight = signal(false)

    readonly isDirty = computed(() => {
        const folders = this.folders()
        const saved = this.savedFolders()
        return folders.length !== saved.length || folders.some((folder, i) => folder !== saved[i])
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
            if (this.library.scanStatus()?.phase === 'completed') {
                void this.library.refreshSnapshot()
            }
        })
    }

    private async loadFolders(): Promise<void> {
        if (!this.electronService.isElectron) return
        const settings = await this.electronService.ipcRenderer.invoke('get-settings')
        const folders = settings.libraryFolders ?? []
        this.folders.set(folders)
        this.savedFolders.set(folders)
    }

    folderParent(path: string): string {
        return splitPathBaseName(path).parent
    }

    folderName(path: string): string {
        return splitPathBaseName(path).base || path
    }

    async addFolders(): Promise<void> {
        const picked = await this.library.pickFolders()
        if (!picked?.length) return
        this.folders.update(folders => [...new Set([...folders, ...picked])])
    }

    removeFolder(folder: string): void {
        this.folders.update(folders => folders.filter(f => f !== folder))
    }

    async saveAndRescan(): Promise<void> {
        if (this.saveInFlight() || this.library.isScanning()) return
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

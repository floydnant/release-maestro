import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core'
import { ElectronService } from '../../../core/services/electron/electron.service'
import { createRendererLogger } from '../../../core/logging/logger'

const log = createRendererLogger('diagnostics')

@Component({
    selector: 'app-diagnostics',
    templateUrl: './diagnostics.component.html',
    changeDetection: ChangeDetectionStrategy.OnPush,
    host: { class: 'block' },
})
export class DiagnosticsComponent {
    private readonly electron = inject(ElectronService)
    readonly isElectron = this.electron.isElectron
    readonly preview = signal<string[]>([])
    readonly loading = signal(false)
    readonly busy = signal(false)
    readonly error = signal<string | null>(null)
    readonly savedPath = signal<string | null>(null)

    constructor() {
        if (this.isElectron) void this.refresh()
    }

    async refresh(): Promise<void> {
        this.loading.set(true)
        this.error.set(null)
        try {
            this.preview.set(await this.electron.getDiagnosticsPreview())
            log.info('diagnostics.preview.refreshed', { entryCount: this.preview().length })
        } catch (error) {
            log.error('diagnostics.preview.failed', error)
            this.error.set('Could not read the local log. Try again.')
        } finally {
            this.loading.set(false)
        }
    }

    async openFolder(): Promise<void> {
        this.error.set(null)
        try {
            await this.electron.openDiagnosticsFolder()
        } catch (error) {
            log.error('diagnostics.open-folder.failed', error)
            this.error.set('Could not open the log folder.')
        }
    }

    async export(): Promise<void> {
        this.busy.set(true)
        this.error.set(null)
        this.savedPath.set(null)
        try {
            this.savedPath.set(await this.electron.exportDiagnostics())
        } catch (error) {
            log.error('diagnostics.export.failed', error)
            this.error.set('Could not export the diagnostics. Try another location.')
        } finally {
            this.busy.set(false)
        }
    }
}

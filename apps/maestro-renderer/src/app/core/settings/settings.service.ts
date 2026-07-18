import { inject, Injectable, resource } from '@angular/core'
import { AppSettings } from '@release-maestro/core'
import { ElectronService } from '../services'

@Injectable({
    providedIn: 'root',
})
export class SettingsService {
    private electronService = inject(ElectronService)

    private async getSettings(): Promise<AppSettings> {
        // @TODO: error handling
        return await this.electronService.ipcRenderer.invoke('get-settings')
    }

    async setSettings(settings: AppSettings): Promise<void> {
        const authoritative = await this.electronService.ipcRenderer.invoke('set-settings', settings)
        this.settings.set(authoritative)
    }

    /**
     * Lost-update-safe single-field write: the main process merges onto the latest
     * store, validates, persists, and returns the authoritative settings, which
     * replace local state so the renderer can never diverge.
     */
    async patchSettings(patch: Partial<AppSettings>): Promise<AppSettings> {
        const authoritative = await this.electronService.ipcRenderer.invoke('patch-settings', patch)
        this.settings.set(authoritative)
        return authoritative
    }

    settings = resource<AppSettings | null, unknown>({
        defaultValue: null,
        loader: () => this.getSettings(),
        equal: () => false,
    })
}

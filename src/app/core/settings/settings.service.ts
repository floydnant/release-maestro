import { inject, Injectable, resource } from '@angular/core'
import { AppSettings } from '../../../../shared/schemas/app-settings.schema'
import { ElectronService } from '../services'

@Injectable({
    providedIn: 'root',
})
export class SettingsService {
    private electronService = inject(ElectronService)

    private async getSettings(): Promise<AppSettings> {
        // @TODO: error handling
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return await this.electronService.ipcRenderer.invoke('get-settings')
    }
    async setSettings(settings: AppSettings): Promise<void> {
        // @TODO: error handling
        await this.electronService.ipcRenderer.invoke('set-settings', settings)

        this.settings.set(settings)
    }

    settings = resource<AppSettings | null, unknown>({
        defaultValue: null,
        loader: () => this.getSettings(),
        equal: () => false,
    })
}

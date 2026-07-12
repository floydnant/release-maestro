import { Injectable } from '@angular/core'
import { AppIpcRenderer, asAppIpcRenderer } from '@release-maestro/core'

@Injectable({
    providedIn: 'root',
})
export class ElectronService {
    ipcRenderer!: AppIpcRenderer

    constructor() {
        if (this.isElectron) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            this.ipcRenderer = asAppIpcRenderer((window as any).require('electron').ipcRenderer)
        }
    }

    get isElectron(): boolean {
        return !!(window && window.process && window.process.type)
    }

    get platform(): string | undefined {
        if (!this.isElectron) return undefined

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return (window as any).process.platform
    }

    async openUrl(url: string) {
        await this.ipcRenderer.invoke('open-url', url)
    }

    async minimizeWindow() {
        await this.ipcRenderer.invoke('window-minimize')
    }

    async toggleMaximizeWindow() {
        return await this.ipcRenderer.invoke('window-toggle-maximize')
    }

    async closeWindow() {
        await this.ipcRenderer.invoke('window-close')
    }
}

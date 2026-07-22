import { Injectable } from '@angular/core'
import { AppIpcRenderer, asAppIpcRenderer } from '@release-maestro/core'

@Injectable({
    providedIn: 'root',
})
export class ElectronService {
    ipcRenderer!: AppIpcRenderer
    private webUtils: { getPathForFile(file: File): string } | undefined

    constructor() {
        if (this.isElectron) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const electron = (window as any).require('electron')
            this.ipcRenderer = asAppIpcRenderer(electron.ipcRenderer)
            this.webUtils = electron.webUtils
        }
    }

    /** Absolute filesystem path of a dragged-and-dropped file/folder, or null. */
    getPathForFile(file: File): string | null {
        try {
            return this.webUtils?.getPathForFile(file) || null
        } catch {
            return null
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

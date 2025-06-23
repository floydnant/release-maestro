import { inject, Injectable } from '@angular/core'
import { Album, Label, Track } from 'bandcamp-fetch'
import { ElectronService } from './electron/electron.service'

@Injectable({ providedIn: 'root' })
export class BandcampService {
    private electronService = inject(ElectronService)

    async fetchAlbum(url: string): Promise<Album> {
        return await this.electronService.ipcRenderer.invoke('bandcamp-fetch-album', url)
    }

    async fetchTrack(url: string): Promise<Track> {
        return await this.electronService.ipcRenderer.invoke('bandcamp-fetch-track', url)
    }

    async fetchLabel(url: string): Promise<Label> {
        return await this.electronService.ipcRenderer.invoke('bandcamp-fetch-label', url)
    }

    async fetchRelease(url: string): Promise<Album | Track> {
        const isTrack = url.includes('/track/')
        if (isTrack) {
            return await this.fetchTrack(url)
        }
        return await this.fetchAlbum(url)
    }
}

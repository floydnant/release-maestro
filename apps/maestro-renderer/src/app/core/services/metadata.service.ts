import { inject, Injectable } from '@angular/core'
import { MetadataIpcChannel, PingResult, SongMetadata, SongMetadataUpdate } from '@release-maestro/core'
import { ElectronService } from './electron/electron.service'

/**
 * Typed renderer-side bridge to the music-metadata engine running in the Electron
 * main process. Wraps the {@link MetadataIpcChannel} IPC contract.
 * Library scans live in LibraryService (see LibraryScanService in the main process).
 */
@Injectable({
    providedIn: 'root',
})
export class MetadataService {
    private electronService = inject(ElectronService)

    ping(): Promise<PingResult> {
        return this.electronService.ipcRenderer.invoke(MetadataIpcChannel.ping)
    }

    readFile(path: string): Promise<SongMetadata | null> {
        return this.electronService.ipcRenderer.invoke(MetadataIpcChannel.read, { path })
    }

    writeTags(path: string, update: SongMetadataUpdate): Promise<SongMetadata> {
        return this.electronService.ipcRenderer.invoke(MetadataIpcChannel.write, { path, update })
    }
}

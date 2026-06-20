import { inject, Injectable } from '@angular/core'
import {
    MetadataIpcChannel,
    MetadataScanUpdate,
    PingResult,
    ScanMetadataRequest,
    ScanResult,
    SongMetadata,
    SongMetadataUpdate,
} from '@release-maestro/core'
import { fromEventPattern, map, share } from 'rxjs'
import { ElectronService } from './electron/electron.service'

/**
 * Typed renderer-side bridge to the music-metadata engine running in the Electron
 * main process. Wraps the {@link MetadataIpcChannel} IPC contract.
 */
@Injectable({
    providedIn: 'root',
})
export class MetadataService {
    private electronService = inject(ElectronService)

    /** Stream of scan lifecycle updates (started / progress / item / itemError / completed / error). */
    scanProgress$ = fromEventPattern<[Electron.IpcRendererEvent, MetadataScanUpdate]>(
        handler => this.electronService.ipcRenderer.on(MetadataIpcChannel.scanProgress, handler),
        handler => this.electronService.ipcRenderer.off(MetadataIpcChannel.scanProgress, handler),
    ).pipe(
        map(([_event, update]) => update),
        share({ resetOnRefCountZero: true }),
    )

    ping(): Promise<PingResult> {
        return this.electronService.ipcRenderer.invoke(MetadataIpcChannel.ping)
    }

    readFile(path: string): Promise<SongMetadata | null> {
        return this.electronService.ipcRenderer.invoke(MetadataIpcChannel.read, { path })
    }

    writeTags(path: string, update: SongMetadataUpdate): Promise<SongMetadata> {
        return this.electronService.ipcRenderer.invoke(MetadataIpcChannel.write, { path, update })
    }

    /** Starts a scan; subscribe to {@link scanProgress$} for streamed results. Resolves with a summary. */
    scan(paths: string[]): Promise<ScanResult | undefined> {
        const request: ScanMetadataRequest = { paths }
        return this.electronService.ipcRenderer.invoke(MetadataIpcChannel.scan, request)
    }

    cancelScan(): void {
        this.electronService.ipcRenderer.send(MetadataIpcChannel.scanAbort)
    }
}

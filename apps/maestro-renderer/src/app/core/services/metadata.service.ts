import { inject, Injectable } from '@angular/core'
import { fromEventPattern, map, share } from 'rxjs'
import {
    METADATA_IPC_CHANNELS,
    MetadataScanUpdate,
    PingResult,
    ScanMetadataRequest,
    ScanResult,
    SongMetadata,
    SongMetadataUpdate,
} from '@release-maestro/core'
import { ElectronService } from './electron/electron.service'

/**
 * Typed renderer-side bridge to the music-metadata engine running in the Electron
 * main process. Wraps the {@link METADATA_IPC_CHANNELS} IPC contract.
 */
@Injectable({
    providedIn: 'root',
})
export class MetadataService {
    private electronService = inject(ElectronService)

    /** Stream of scan lifecycle updates (started / progress / item / itemError / completed / error). */
    scanProgress$ = fromEventPattern<[Electron.IpcRendererEvent, MetadataScanUpdate]>(
        handler => this.electronService.ipcRenderer.on(METADATA_IPC_CHANNELS.scanProgress, handler),
        handler => this.electronService.ipcRenderer.off(METADATA_IPC_CHANNELS.scanProgress, handler),
    ).pipe(
        map(([_event, update]) => update),
        share({ resetOnRefCountZero: true }),
    )

    ping(): Promise<PingResult> {
        return this.electronService.ipcRenderer.invoke(METADATA_IPC_CHANNELS.ping)
    }

    readFile(path: string): Promise<SongMetadata | null> {
        return this.electronService.ipcRenderer.invoke(METADATA_IPC_CHANNELS.read, { path })
    }

    writeTags(path: string, update: SongMetadataUpdate): Promise<SongMetadata> {
        return this.electronService.ipcRenderer.invoke(METADATA_IPC_CHANNELS.write, { path, update })
    }

    /** Starts a scan; subscribe to {@link scanProgress$} for streamed results. Resolves with a summary. */
    scan(paths: string[]): Promise<ScanResult | undefined> {
        const request: ScanMetadataRequest = { paths }
        return this.electronService.ipcRenderer.invoke(METADATA_IPC_CHANNELS.scan, request)
    }

    cancelScan(): void {
        this.electronService.ipcRenderer.send(METADATA_IPC_CHANNELS.scanAbort)
    }
}

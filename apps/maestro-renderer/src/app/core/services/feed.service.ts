import { inject, Injectable } from '@angular/core'
import { fromEventPattern, map, share } from 'rxjs'
import { EmailImportProgressUpdate, HydratedFeedItem } from '@release-maestro/core'
import { ElectronService } from './electron/electron.service'
import { UiSideException } from '../../shared/ui-facing.exceptions'

@Injectable({
    providedIn: 'root',
})
export class FeedService {
    private electronService = inject(ElectronService)

    emailImportProgress$ = fromEventPattern<[Electron.IpcRendererEvent, EmailImportProgressUpdate]>(
        handler => this.electronService.ipcRenderer.on('email-import-progress', handler),
        handler => this.electronService.ipcRenderer.off('email-import-progress', handler),
    ).pipe(
        map(([_event, progress]) => progress),
        share({ resetOnRefCountZero: true }),
    )

    async triggerEmailImport() {
        await this.electronService.ipcRenderer.invoke('trigger-email-import')
    }
    cancelEmailImport() {
        this.electronService.ipcRenderer.send('email-import-abort')
    }

    async loadFeed(index: number, count: number): Promise<HydratedFeedItem[]> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const result = await this.electronService.ipcRenderer.invoke('load-feed', index, count)
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
        if (result.isError) {
            // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-argument
            throw new UiSideException(result.message, result.userFacingMessage)
        }

        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return result
    }

    async hasFeed(): Promise<boolean> {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const hasFeed = await this.electronService.ipcRenderer.invoke('has-feed')

        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        return hasFeed
    }

    markFeedItemViewed(
        id: string,
        feedItemType: HydratedFeedItem['type'],
        isSnoozed: boolean = false,
    ): Promise<void> {
        return this.electronService.ipcRenderer.invoke('mark-feed-item-viewed', id, feedItemType, isSnoozed)
    }
}

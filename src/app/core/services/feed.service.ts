import { inject, Injectable } from '@angular/core'
import { fromEventPattern, map, share } from 'rxjs'
import { EmailImportProgressUpdate } from '../../../../app/email/email.schema'
import { HydratedFeedItem } from '../../../../app/feed/feed.schema'
import { UiSideException } from '../../shared/ui-facing.exceptions'
import { ElectronService } from './electron/electron.service'

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

    triggerEmailImport() {
        this.electronService.ipcRenderer.invoke('trigger-email-import')
    }
    cancelEmailImport() {
        this.electronService.ipcRenderer.send('email-import-abort')
    }

    async loadFeed(index: number, count: number): Promise<HydratedFeedItem[]> {
        const result = await this.electronService.ipcRenderer.invoke('load-feed', index, count)
        if (result.isError) {
            throw new UiSideException(result.message, result.userFacingMessage)
        }

        return result
    }

    markFeedItemViewed(
        id: string,
        feedItemType: HydratedFeedItem['type'],
        isSnoozed: boolean = false,
    ): Promise<void> {
        return this.electronService.ipcRenderer.invoke('mark-feed-item-viewed', id, feedItemType, isSnoozed)
    }
}

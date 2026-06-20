import { inject, Injectable } from '@angular/core'
import { EmailImportProgressUpdate, HydratedFeedItem, USE_SAME_MESSAGE } from '@release-maestro/core'
import { EMPTY, fromEventPattern, map, share } from 'rxjs'
import { UiSideException } from '../../shared/ui-facing.exceptions'
import { ElectronService } from './electron/electron.service'

@Injectable({
    providedIn: 'root',
})
export class FeedService {
    private electronService = inject(ElectronService)

    emailImportProgress$ = this.electronService.isElectron
        ? fromEventPattern<[Electron.IpcRendererEvent, EmailImportProgressUpdate]>(
              handler => this.electronService.ipcRenderer.on('email-import-progress', handler),
              handler => this.electronService.ipcRenderer.off('email-import-progress', handler),
          ).pipe(
              map(([_event, progress]) => progress),
              share({ resetOnRefCountZero: true }),
          )
        : EMPTY

    async triggerEmailImport() {
        await this.electronService.ipcRenderer.invoke('trigger-email-import')
    }
    cancelEmailImport() {
        this.electronService.ipcRenderer.send('email-import-abort')
    }

    async loadFeed(index: number, count: number): Promise<HydratedFeedItem[]> {
        const result = await this.electronService.ipcRenderer.invoke('load-feed', { index, count })
        if (!Array.isArray(result)) {
            throw new UiSideException(result.message, result.userFacingMessage ?? USE_SAME_MESSAGE)
        }

        return result
    }

    async hasFeed(): Promise<boolean> {
        const hasFeed = await this.electronService.ipcRenderer.invoke('has-feed')

        return hasFeed
    }

    markFeedItemViewed(id: string, feedItemType: HydratedFeedItem['type'], isSnoozed = false): Promise<void> {
        return this.electronService.ipcRenderer.invoke('mark-feed-item-viewed', {
            id,
            type: feedItemType,
            isSnoozed,
        })
    }
}

import { inject, Injectable } from '@angular/core'
import { ElectronService } from './electron/electron.service'
import { HydratedFeedItem } from '../../../../app/feed/feed.schema'
import { Observable, Subject } from 'rxjs'

@Injectable({
    providedIn: 'root',
})
export class FeedService {
    private electronService = inject(ElectronService)

    triggerEmailImport(): Observable<{ current: number; total: number; message?: string }> {
        const progress$ = new Subject<{ current: number; total: number; message?: string }>()

        const progressHandler = (
            _event: Electron.IpcRendererEvent,
            progress: { current: number; total: number; message?: string },
        ) => {
            progress$.next(progress)
        }

        // @TODO: ideally, the progress bar would pick back up if the client is restarted or sth (can that even happen in prod?)
        this.electronService.ipcRenderer.invoke('trigger-email-import').then(() => {
            progress$.complete()
            this.electronService.ipcRenderer.off('email-import-progress', progressHandler)
        })

        this.electronService.ipcRenderer.on('email-import-progress', progressHandler)

        return progress$
    }

    loadFeed(index: number, count: number): Promise<HydratedFeedItem[]> {
        return this.electronService.ipcRenderer.invoke('load-feed', index, count)
    }

    markFeedItemViewed(
        id: string,
        feedItemType: HydratedFeedItem['type'],
        isSnoozed: boolean = false,
    ): Promise<void> {
        return this.electronService.ipcRenderer.invoke('mark-feed-item-viewed', id, feedItemType, isSnoozed)
    }
}

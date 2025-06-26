import { inject, Injectable } from '@angular/core'
import { ElectronService } from './electron/electron.service'
import { HydratedFeedItem } from '../../../../app/feed/feed.backend.service'

@Injectable({
    providedIn: 'root',
})
export class FeedService {
    private electronService = inject(ElectronService)

    loadFeed(index: number, count: number): Promise<HydratedFeedItem[]> {
        return this.electronService.ipcRenderer.invoke('load-feed', index, count)
    }

    markFeedItemViewed(
        id: string,
        feedItemType: HydratedFeedItem['type'],
        showMeAgain: boolean = false,
    ): Promise<void> {
        return this.electronService.ipcRenderer.invoke('mark-feed-item-viewed', id, feedItemType, showMeAgain)
    }
}

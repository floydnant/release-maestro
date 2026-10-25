import { inject, Injectable } from '@angular/core'
import { toSignal } from '@angular/core/rxjs-interop'
import {
    assertUnreachable,
    EmailImportProgressUpdate,
    EmailImportTrigger,
    HydratedFeedItem,
    ScrapedLinkMetadata,
    USE_SAME_MESSAGE,
} from '@release-maestro/core'
import { EMPTY, fromEventPattern, map, share } from 'rxjs'
import { UiSideException } from '../../shared/ui-facing.exceptions'
import { ElectronService } from './electron/electron.service'

export type RunningEmailImportUpdate = Extract<
    EmailImportProgressUpdate,
    { phase: 'started' | 'processing' | 'finishing' }
>

/** Whether the import can still be cancelled, and blocks starting another. */
export function isEmailImportRunning(
    update: EmailImportProgressUpdate | null,
): update is RunningEmailImportUpdate {
    if (update === null) return false
    switch (update.phase) {
        case 'started':
        case 'processing':
        case 'finishing':
            return true
        case 'completed':
        case 'cancelled':
        case 'error':
            return false
        default:
            return assertUnreachable(update)
    }
}

/** What a running import shows: a spinner until the export reports a count, then that count. */
export function emailImportActivity(update: RunningEmailImportUpdate) {
    switch (update.phase) {
        case 'started':
            return {
                phase: update.phase,
                ring: 'spinning',
                percent: 0,
                label: 'Checking mail…',
                count: null,
            } as const
        case 'processing':
        case 'finishing': {
            const { current, total } = update
            return {
                phase: update.phase,
                ring: 'progress',
                // Multiplied first, so a count that divides evenly gives a whole percent
                percent: total === 0 ? 0 : (current * 100) / total,
                // After export, counts emails saved so far; it can wait on Bandcamp for a long time
                label: update.phase === 'processing' ? 'Importing emails' : 'Processing emails',
                count: `${current}/${total}`,
            } as const
        }
        default:
            return assertUnreachable(update)
    }
}

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

    /**
     * The latest update of the running or last import in this session. Held here, for the life of the
     * app, so a page that opens mid-import shows it at once rather than at the next update.
     */
    readonly emailImportUpdate = toSignal(this.emailImportProgress$, { initialValue: null })

    /** Resolves when the import settles. An `auto` request is a no-op unless the last import is stale. */
    async triggerEmailImport(trigger: EmailImportTrigger) {
        await this.electronService.ipcRenderer.invoke('trigger-email-import', { trigger })
    }
    cancelEmailImport() {
        this.electronService.ipcRenderer.send('email-import-abort')
    }

    async loadFeed(index: number, count: number, excludedIds: string[] = []): Promise<HydratedFeedItem[]> {
        const result = await this.electronService.ipcRenderer.invoke('load-feed', {
            index,
            count,
            excludedIds,
        })
        if (!Array.isArray(result)) {
            throw new UiSideException(result.message, result.userFacingMessage ?? USE_SAME_MESSAGE)
        }

        return result
    }

    /**
     * Loads releases that failed to load again, such as after Bandcamp's rate limit has passed. Releases
     * come back under the requested IDs, still carrying an `error` if they failed again.
     */
    async reloadFeedItems(ids: string[]): Promise<HydratedFeedItem[]> {
        const result = await this.electronService.ipcRenderer.invoke('reload-feed-items', { ids })
        if (!Array.isArray(result)) {
            throw new UiSideException(result.message, result.userFacingMessage ?? USE_SAME_MESSAGE)
        }

        return result
    }

    /** Page previews for links on loaded releases, keyed by URL. URLs without a preview are absent. */
    loadLinkPreviews(urls: string[]): Promise<Record<string, ScrapedLinkMetadata>> {
        return this.electronService.ipcRenderer.invoke('load-link-previews', { urls })
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

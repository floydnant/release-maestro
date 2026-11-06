import {
    EmailImportProgress,
    FeedItemWithPurchases,
    FetchFailedException,
    HydratedBandcampReleaseFeedItem,
    HydratedFeedItem,
    assertUnreachable,
    mapBandcampReleaseFeedItemToHydratedFeedItem,
    resolveFeedSettings,
} from '@release-maestro/core'
import { Observable } from 'rxjs'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import {
    BandcampApiException,
    BandcampApiMalformedTralbumDataException,
} from '../bandcamp/bandcamp-api.exceptions'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { SettingsBackendService } from '../settings.backend.service'
import { EmailImportPass } from './email-import-pass'
import { FeedBackendRepository } from './feed.backend.repository'

const UNPLAYABLE_RELEASE_RECHECK_MS = 1000 * 60 * 5
const MAX_UNPLAYABLE_RELEASE_CHECKS = 1000

/** A release page that could not be loaded becomes the release's error card. Cancellation is rethrown. */
const toHydrationError = (
    tralbumUrl: string,
    error: unknown,
): BandcampApiException | FetchFailedException => {
    if (error instanceof BandcampApiException || error instanceof FetchFailedException) {
        console.log(error)
        return error
    }
    console.error('Failed to load tralbum:', tralbumUrl, error)
    if (error instanceof Error && error.name !== 'AbortError')
        return new BandcampApiMalformedTralbumDataException(tralbumUrl, error)
    throw error
}

export class FeedBackendService {
    private readonly unplayableReleaseChecks = new Map<string, number>()
    constructor(
        private emailRepo: EmailBackendRepository,
        private bandcampApiService: BandcampApiBackendService,
        private feedBackendRepository: FeedBackendRepository,
        private settingsService: SettingsBackendService,
    ) {}

    /** Starts one import pass; see {@link EmailImportPass} for its progress and terminal updates. */
    async triggerEmailImport(abortSignal: AbortSignal): Promise<Observable<EmailImportProgress>> {
        console.log('Running email import...')
        return new EmailImportPass(
            this.emailRepo,
            this.feedBackendRepository,
            this.bandcampApiService,
            abortSignal,
        ).start()
    }

    // @TODO: error handling
    async hydrateBandcampFeedItem(item: FeedItemWithPurchases): Promise<HydratedBandcampReleaseFeedItem> {
        const { tralbumUrl } = item.data
        if (!tralbumUrl) {
            console.warn('No tralbum link found:', item)
            return mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null, null)
        }
        const tralbum = await this.bandcampApiService
            .scrapeTralbumInfo(tralbumUrl)
            .catch((error: unknown) => toHydrationError(tralbumUrl, error))
        return tralbum instanceof Error
            ? mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null, tralbum)
            : mapBandcampReleaseFeedItemToHydratedFeedItem(item, tralbum, null, null)
    }

    async hydrateFeed(
        items: FeedItemWithPurchases[],
        hideUnplayableReleases = resolveFeedSettings(this.settingsService.getSettings().feed)
            .hideUnplayableReleases,
    ): Promise<HydratedFeedItem[]> {
        console.log('Hydrating feed items')
        const promises = items.map(async item => {
            const checkedAt = this.unplayableReleaseChecks.get(item.data.tralbumUrl)
            if (
                hideUnplayableReleases &&
                checkedAt !== undefined &&
                Date.now() - checkedAt < UNPLAYABLE_RELEASE_RECHECK_MS
            )
                return null

            if (item.type == 'BANDCAMP.TRALBUM') {
                const hydrated = await this.hydrateBandcampFeedItem(item)
                this.unplayableReleaseChecks.delete(item.data.tralbumUrl)
                if (!hydrated.error && !hydrated.data.tracks.some(track => !!track.streamUrl)) {
                    this.unplayableReleaseChecks.set(item.data.tralbumUrl, Date.now())
                    if (this.unplayableReleaseChecks.size > MAX_UNPLAYABLE_RELEASE_CHECKS) {
                        const oldestUrl = this.unplayableReleaseChecks.keys().next().value
                        if (oldestUrl !== undefined) this.unplayableReleaseChecks.delete(oldestUrl)
                    }
                }
                return hydrated
            }

            return assertUnreachable(item.type as never, 'Unhandled feed item type:')
        })
        const hydratedFeedItems = await Promise.all(promises)
        console.log('Hydrated', hydratedFeedItems.length, 'feed items')

        return hydratedFeedItems.filter(
            (item): item is HydratedFeedItem =>
                item !== null &&
                (!hideUnplayableReleases ||
                    item.error !== null ||
                    item.data.tracks.some(track => !!track.streamUrl)),
        )
    }

    async loadFeed(index: number, count: number, excludedIds: string[] = []): Promise<HydratedFeedItem[]> {
        const release = this.bandcampApiService.holdFeedPriority()
        try {
            const { hideUnplayableReleases, snoozeHours } = resolveFeedSettings(
                this.settingsService.getSettings().feed,
            )
            const items: HydratedFeedItem[] = []
            const scannedIds = [...excludedIds]
            // Hidden releases remain unviewed. Continue past them to fill the visible page.
            while (items.length < count) {
                const remaining = count - items.length
                const candidates = await this.feedBackendRepository.listFeedItems({
                    index,
                    count: remaining,
                    excludedIds: scannedIds,
                    snoozeHours,
                })
                if (candidates.length === 0) break
                items.push(...(await this.hydrateFeed(candidates, hideUnplayableReleases)))
                scannedIds.push(...candidates.map(item => item.id))
                if (candidates.length < remaining) break
            }
            return items
        } finally {
            release()
        }
    }

    async hasFeed(): Promise<boolean> {
        return await this.feedBackendRepository.hasFeedItems()
    }

    async reloadFeedItems(ids: string[]): Promise<HydratedFeedItem[]> {
        const release = this.bandcampApiService.holdFeedPriority()
        try {
            const items = await this.feedBackendRepository.getFeedItems(ids)
            // Retry the requested entries even if they are now viewed or previously looked unplayable.
            return await this.hydrateFeed(items, false)
        } finally {
            release()
        }
    }

    async markFeedItemAsViewed(id: string, feedItemType: HydratedFeedItem['type'], isSnoozed: boolean) {
        await this.feedBackendRepository.markFeedItemViewed(id, feedItemType, isSnoozed)
    }
}

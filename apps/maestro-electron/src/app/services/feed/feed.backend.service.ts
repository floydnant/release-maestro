import { setTimeout as waitForRetry } from 'node:timers/promises'
import {
    bufferCount,
    concatMap,
    concatWith,
    defer,
    filter,
    from,
    ignoreElements,
    materialize,
    map,
    lastValueFrom,
    merge,
    mergeMap,
    Observable,
    switchMap,
    tap,
    toArray,
} from 'rxjs'
import {
    BandcampEmailFeedSourceItem,
    BandcampFeedItem,
    BandcampPurchase,
    EmailImportProgress,
    FetchFailedException,
    HydratedBandcampReleaseFeedItem,
    HydratedFeedItem,
    isTruthy,
    assertUnreachable,
    mapBandcampReleaseFeedItemToHydratedFeedItem,
    resolveFeedSettings,
    mergeBandcampPurchases,
} from '@release-maestro/core'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import {
    BandcampApiException,
    BandcampApiFailedToFetchTralbumException,
    BandcampApiMalformedTralbumDataException,
    BandcampApiRedirectException,
} from '../bandcamp/bandcamp-api.exceptions'
import { parseBandcampEmail } from '../bandcamp/bandcamp.email-parser'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { SettingsBackendService } from '../settings.backend.service'
import { FeedBackendRepository } from './feed.backend.repository'

/**
 * How far before the import checkpoint the next import starts reading. A message can land in the
 * mailbox after a newer one already has (sync lag, a Mac that was offline), and its date received is
 * then older than the checkpoint. Re-reading this window catches it; dedupe keeps the re-read from
 * creating duplicate feed items.
 */
const EMAIL_IMPORT_CHECKPOINT_OVERLAP_MS = 1000 * 60 * 60 * 24
const UNPLAYABLE_RELEASE_RECHECK_MS = 1000 * 60 * 5
const MAX_UNPLAYABLE_RELEASE_CHECKS = 1000
// Keeps the request gate's background slots filled; the gate owns the network limit.
const MAX_PARENT_ALBUM_LOOKUPS = 8
const PARENT_ALBUM_LOOKUP_RETRY_MS = [250, 1000]

const createBandcampFeedItem = (
    email: BandcampEmailFeedSourceItem,
    releaseUrl: string,
    purchases: BandcampPurchase[],
): BandcampFeedItem => ({
    id: crypto.randomUUID(),
    type: 'BANDCAMP.TRALBUM',
    dedupeIdentifier: releaseUrl,
    ingestedAt: new Date(),
    eventDate: new Date(email.dateReceived),
    isSnoozed: false,
    lastViewedAt: null,
    data: {
        tralbumUrl: releaseUrl,
        tralbumType: releaseUrl.includes('/album/') ? 'album' : 'track',
        purchases,
    },
    source:
        email.type === 'EMAIL.BANDCAMP_NEW_RELEASE'
            ? email
            : {
                  type: email.type,
                  messageId: email.messageId,
                  dateReceived: email.dateReceived,
                  isRead: email.isRead,
              },
})

export class FeedBackendService {
    private readonly unplayableReleaseChecks = new Map<string, number>()
    constructor(
        private emailRepo: EmailBackendRepository,
        private bandcampApiService: BandcampApiBackendService,
        private feedBackendRepository: FeedBackendRepository,
        private settingsService: SettingsBackendService,
    ) {}

    private async resolveParentAlbumUrl(releaseUrl: string, signal: AbortSignal): Promise<string> {
        for (let attempt = 0; ; attempt++) {
            try {
                const track = await this.bandcampApiService.scrapeTralbumInfo(releaseUrl, signal, 'import')
                return track.parentAlbumUrl ?? releaseUrl
            } catch (error) {
                if (
                    error instanceof BandcampApiRedirectException ||
                    error instanceof BandcampApiMalformedTralbumDataException ||
                    (error instanceof BandcampApiFailedToFetchTralbumException &&
                        [404, 410].includes(error.status))
                )
                    return releaseUrl

                const retryDelay = PARENT_ALBUM_LOOKUP_RETRY_MS[attempt]
                const retryable =
                    error instanceof FetchFailedException ||
                    (error instanceof BandcampApiFailedToFetchTralbumException &&
                        [500, 502, 503, 504].includes(error.status))
                if (signal.aborted || retryDelay === undefined || !retryable) throw error
                await waitForRetry(retryDelay, undefined, { signal })
            }
        }
    }

    async triggerEmailImport(abortSignal: AbortSignal): Promise<Observable<EmailImportProgress>> {
        console.log('Running email import...')

        const importStartedAt = new Date()
        let totalProcessed = 0
        let totalImported = 0
        let skippedEmails = 0
        const processingFailure = new AbortController()
        const workSignal = AbortSignal.any([abortSignal, processingFailure.signal])

        const vendor = 'APPLE_MAIL'
        const mailboxName = this.emailRepo.getMailboxName(vendor)
        const checkpoint = mailboxName
            ? await this.feedBackendRepository.getEmailImportCheckpoint(vendor, mailboxName)
            : null
        const receivedSince = checkpoint
            ? new Date(checkpoint.getTime() - EMAIL_IMPORT_CHECKPOINT_OVERLAP_MS)
            : null
        let newestReceivedAt: Date | null = null
        let terminalUpdate: EmailImportProgress | null = null
        let hasExportedEmails = false
        const parentAlbums = new Map<string, Promise<string>>()
        const resolveReleaseUrl = (releaseUrl: string): Promise<string> => {
            if (!releaseUrl.includes('/track/')) return Promise.resolve(releaseUrl)
            let resolved = parentAlbums.get(releaseUrl)
            if (!resolved) {
                resolved = this.resolveParentAlbumUrl(releaseUrl, workSignal)
                parentAlbums.set(releaseUrl, resolved)
            }
            return resolved
        }

        const emails$ = await this.emailRepo.loadEmails(vendor, workSignal, mailboxName, receivedSince)

        return merge(
            emails$.pipe(
                materialize(),
                map((notification): EmailImportProgress | null => {
                    if (notification.kind == 'C')
                        return hasExportedEmails && !workSignal.aborted ? { phase: 'finishing' } : null
                    // The buffered stream reports the final error after export progress drains.
                    if (notification.kind == 'E') return null
                    if (notification.kind == 'N') {
                        hasExportedEmails = true
                        return {
                            phase: 'processing' as const,
                            current: notification.value.current,
                            total: notification.value.total,
                            // @TODO: this needs to be localized
                            message: notification.value.email?.subject.replace(/�/g, '') ?? '',
                        }
                    }

                    return assertUnreachable(notification, 'Unhandled notification kind:')
                }),
            ),
            emails$.pipe(
                bufferCount(50),
                concatMap(async emailPackets => {
                    totalProcessed += emailPackets.length
                    console.log('Processing batch of emails:', emailPackets.length)

                    for (const { email } of emailPackets) {
                        if (!email) {
                            skippedEmails++
                            continue
                        }
                        const receivedAt = new Date(email.dateReceived)
                        if (receivedAt.getTime() > (newestReceivedAt?.getTime() ?? -Infinity)) {
                            newestReceivedAt = receivedAt
                        }
                    }

                    const emailFeedSourceItems = emailPackets
                        .map(packet => packet.email)
                        .filter(isTruthy)
                        // @TODO: figure out strategised email parsing (i.e. plugins for different email types)
                        .map(email => parseBandcampEmail(email))
                        .filter(isTruthy)

                    const emailPurchases = emailFeedSourceItems.map(email => ({
                        email,
                        purchases:
                            email.type === 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC'
                                ? email.purchases
                                : [{ tralbumUrl: email.releaseUrl, fans: [] }],
                    }))
                    // Look up the whole batch at once so single-purchase emails share the lookup slots
                    const releaseUrls = new Map(
                        await lastValueFrom(
                            from(
                                new Set(
                                    emailPurchases.flatMap(({ purchases }) =>
                                        purchases.map(purchase => purchase.tralbumUrl),
                                    ),
                                ),
                            ).pipe(
                                mergeMap(
                                    async (url): Promise<[string, string]> => [
                                        url,
                                        await resolveReleaseUrl(url),
                                    ],
                                    MAX_PARENT_ALBUM_LOOKUPS,
                                ),
                                toArray(),
                            ),
                        ),
                    )

                    const feedItems: BandcampFeedItem[] = []
                    for (const { email, purchases } of emailPurchases) {
                        const releases = new Map<string, BandcampFeedItem>()
                        for (const purchase of purchases) {
                            const releaseUrl = releaseUrls.get(purchase.tralbumUrl)
                            if (releaseUrl === undefined)
                                throw new Error(`No release URL was resolved for ${purchase.tralbumUrl}`)
                            const attribution =
                                email.type === 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC' ? [purchase] : []
                            const previous = releases.get(releaseUrl)
                            if (previous) {
                                previous.data.purchases = mergeBandcampPurchases(
                                    previous.data.purchases,
                                    attribution,
                                )
                            } else {
                                releases.set(
                                    releaseUrl,
                                    createBandcampFeedItem(email, releaseUrl, attribution),
                                )
                            }
                        }
                        feedItems.push(...releases.values())
                    }
                    totalImported += feedItems.length

                    await this.feedBackendRepository.ingestFeedItems(feedItems)
                }),
                materialize(),
                switchMap(async (notification): Promise<EmailImportProgress | null> => {
                    if (notification.kind == 'C') {
                        // A cancelled export completes too, but only a full pass covers the mailbox
                        if (abortSignal.aborted) return { phase: 'cancelled' as const }
                        if (mailboxName && newestReceivedAt && skippedEmails === 0) {
                            // A message dated in the future (a bad server clock) must not hide the
                            // mail that really arrives before then
                            const coveredUntil = new Date(
                                Math.min(newestReceivedAt.getTime(), importStartedAt.getTime()),
                            )
                            // The import itself succeeded; without a checkpoint the next one is just slower
                            await this.feedBackendRepository
                                .advanceEmailImportCheckpoint(vendor, mailboxName, coveredUntil)
                                .catch(error =>
                                    console.error('Failed to save the email import checkpoint:', error),
                                )
                        }

                        const newlyImported =
                            await this.feedBackendRepository.countItemsIngestedAfterDate(importStartedAt)

                        return {
                            phase: 'completed' as const,
                            totalProcessed,
                            totalImported,
                            newlyImported,
                            ...(skippedEmails > 0 ? { skippedEmails } : {}),
                        }
                    }
                    if (notification.kind == 'E') {
                        if (abortSignal.aborted) return { phase: 'cancelled' as const }
                        processingFailure.abort()
                        console.error('Error during email import:', notification.error)

                        return {
                            phase: 'error' as const,
                            errorMessage:
                                notification.error instanceof Error
                                    ? notification.error.message
                                    : 'Unknown error during email import',
                        }
                    }
                    if (notification.kind == 'N') {
                        // The next values are already handled by the non-buffered observable in the first part of the merge
                        return null
                    }

                    return assertUnreachable(notification, 'Unhandled notification kind:')
                }),
                tap(update => {
                    if (update) terminalUpdate = update
                }),
                ignoreElements(),
            ),
        ).pipe(
            // A failed lookup can precede the export's final emails. Drain their progress first.
            concatWith(defer(() => Promise.resolve(terminalUpdate))),
            filter((update): update is EmailImportProgress => update !== null),
        )
    }

    // @TODO: error handling
    async hydrateBandcampFeedItem(item: BandcampFeedItem): Promise<HydratedBandcampReleaseFeedItem> {
        if (!item.data.tralbumUrl) {
            console.warn('No tralbum link found:', item)
            return mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null, null)
        } else {
            const scrapedData = await this.bandcampApiService
                .scrapeTralbumInfo(item.data.tralbumUrl)
                .catch(error => {
                    if (error instanceof BandcampApiException || error instanceof FetchFailedException) {
                        console.log(error)
                        return { isError: true as const, error }
                    }
                    console.error('Failed to load tralbum:', item.data.tralbumUrl, error)
                    if (error instanceof Error && error.name !== 'AbortError')
                        return {
                            isError: true as const,
                            error: new BandcampApiMalformedTralbumDataException(item.data.tralbumUrl, error),
                        }
                    throw error
                })

            if ('isError' in scrapedData)
                return mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null, scrapedData.error)

            return mapBandcampReleaseFeedItemToHydratedFeedItem(item, scrapedData, null, null)
        }
    }

    async hydrateFeed(
        items: BandcampFeedItem[],
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

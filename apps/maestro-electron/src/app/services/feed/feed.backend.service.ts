import { bufferCount, concatMap, filter, materialize, merge, Observable, switchMap } from 'rxjs'
import {
    BandcampEmailFeedSourceItem,
    BandcampFeedItem,
    EmailImportProgress,
    HydratedBandcampReleaseFeedItem,
    HydratedFeedItem,
    isTruthy,
    assertUnreachable,
    isUsefulUrlFromBandcampEmail,
    mapBandcampReleaseFeedItemToHydratedFeedItem,
} from '@release-maestro/core'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import {
    BandcampApiFailedToFetchTralbumException,
    BandcampApiMalformedTralbumDataException,
} from '../bandcamp/bandcamp-api.exceptions'
import { parseBandcampEmail } from '../bandcamp/bandcamp.email-parser'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { WebScrapingService } from '../web-scraping/web-scraping.service'
import { FeedBackendRepository } from './feed.backend.repository'

/**
 * How far before the import checkpoint the next import starts reading. A message can land in the
 * mailbox after a newer one already has (sync lag, a Mac that was offline), and its date received is
 * then older than the checkpoint. Re-reading this window catches it; dedupe keeps the re-read from
 * creating duplicate feed items.
 */
const EMAIL_IMPORT_CHECKPOINT_OVERLAP_MS = 1000 * 60 * 60 * 24

const mapBandcampEmailToFeedItems = (email: BandcampEmailFeedSourceItem): BandcampFeedItem[] => {
    let releaseUrls: string[]
    switch (email.type) {
        case 'EMAIL.BANDCAMP_NEW_RELEASE':
            releaseUrls = email.releaseUrl ? [email.releaseUrl] : []
            break
        case 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC':
            releaseUrls = email.tralbumUrls
            break
        default:
            return assertUnreachable(email, 'Unhandled Bandcamp email type:')
    }

    return releaseUrls.map(releaseUrl => ({
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
        },
        source: email,
    }))
}

export class FeedBackendService {
    constructor(
        private emailRepo: EmailBackendRepository,
        private bandcampApiService: BandcampApiBackendService,
        private webScrapingService: WebScrapingService,
        private feedBackendRepository: FeedBackendRepository,
    ) {}

    async triggerEmailImport(abortSignal: AbortSignal): Promise<Observable<EmailImportProgress>> {
        console.log('Running email import...')

        const importStartedAt = new Date()
        let totalProcessed = 0
        let totalImported = 0
        let skippedEmails = 0

        const vendor = 'APPLE_MAIL'
        const mailboxName = this.emailRepo.getMailboxName(vendor)
        const checkpoint = mailboxName
            ? await this.feedBackendRepository.getEmailImportCheckpoint(vendor, mailboxName)
            : null
        const receivedSince = checkpoint
            ? new Date(checkpoint.getTime() - EMAIL_IMPORT_CHECKPOINT_OVERLAP_MS)
            : null
        let newestReceivedAt: Date | null = null

        const emails$ = await this.emailRepo.loadEmails(vendor, abortSignal, mailboxName, receivedSince)

        return merge(
            emails$.pipe(
                materialize(),
                switchMap(async (notification): Promise<EmailImportProgress | null> => {
                    if (notification.kind == 'C' || notification.kind == 'E') {
                        // The complete and error values are handled by the buffered stream below
                        return null
                    }
                    if (notification.kind == 'N') {
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

                    const feedItems = emailFeedSourceItems.flatMap(mapBandcampEmailToFeedItems)
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
            ),
        ).pipe(filter((update): update is EmailImportProgress => update !== null))
    }

    // @TODO: error handling
    async hydrateBandcampFeedItem(item: BandcampFeedItem): Promise<HydratedBandcampReleaseFeedItem> {
        const sourceLinks =
            item.source.type == 'EMAIL.BANDCAMP_NEW_RELEASE'
                ? [...new Set(item.source.links.filter(isUsefulUrlFromBandcampEmail))]
                : null

        if (!item.data.tralbumUrl) {
            console.warn('No tralbum link found:', item)

            return mapBandcampReleaseFeedItemToHydratedFeedItem(
                item,
                null,
                sourceLinks &&
                    (await this.webScrapingService.getLinkMetaDataBatch(sourceLinks).catch(err => {
                        console.error('Failed to scrape links', err)
                        return null
                    })),
                null,
            )
        } else {
            const [scrapedData, linkMetadataMap] = await Promise.all([
                this.bandcampApiService.scrapeTralbumInfo(item.data.tralbumUrl).catch(error => {
                    if (
                        error instanceof BandcampApiFailedToFetchTralbumException ||
                        error instanceof BandcampApiMalformedTralbumDataException
                    ) {
                        console.log(error)
                        return { isError: true as const, error }
                    }
                    console.error('Failed to load tralbum:', item.data.tralbumUrl, error)
                    throw error
                }),
                sourceLinks &&
                    (await this.webScrapingService.getLinkMetaDataBatch(sourceLinks).catch(err => {
                        console.error('Failed to scrape links', err)
                        return null
                    })),
            ])

            if ('isError' in scrapedData)
                return mapBandcampReleaseFeedItemToHydratedFeedItem(
                    item,
                    null,
                    linkMetadataMap,
                    scrapedData.error,
                )

            return mapBandcampReleaseFeedItemToHydratedFeedItem(item, scrapedData, linkMetadataMap, null)
        }
    }

    async hydrateFeed(items: BandcampFeedItem[]): Promise<HydratedFeedItem[]> {
        console.log('Hydrating feed items')
        const promises = items.map(async item => {
            if (item.type == 'BANDCAMP.TRALBUM') return await this.hydrateBandcampFeedItem(item)

            return assertUnreachable(item.type as never, 'Unhandled feed item type:')
        })
        const hydratedFeedItems = await Promise.all(promises)
        console.log('Hydrated', hydratedFeedItems.length, 'feed items')

        return hydratedFeedItems
    }

    async loadFeed(index: number, count: number): Promise<HydratedFeedItem[]> {
        // @TODO: how would we merge multiple feeds? how do we rank/prioritize items?
        const preHydrationFeed = await this.feedBackendRepository.listFeedItems(index, count)

        return await this.hydrateFeed(preHydrationFeed as BandcampFeedItem[])
    }

    async hasFeed(): Promise<boolean> {
        return await this.feedBackendRepository.hasFeedItems()
    }

    async markFeedItemAsViewed(id: string, feedItemType: HydratedFeedItem['type'], isSnoozed: boolean) {
        await this.feedBackendRepository.markFeedItemViewed(id, feedItemType, isSnoozed)
    }
}

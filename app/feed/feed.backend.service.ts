import { bufferCount, concatMap, materialize, merge, Observable, switchMap } from 'rxjs'
import { NEVER } from 'zod'
import { assertUnreachable, isTruthy } from '../../src/app/shared/utils/type-guards.utils'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import { parseBandcampEmail } from '../bandcamp/bandcamp.email-parser'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { EmailImportProgressUpdate } from '../email/email.schema'
import { WebScrapingService } from '../web-scraping/web-scraping.service'
import { BandcampEmailFeedSourceItem } from './feed-source.schema'
import { FeedBackendRepository } from './feed.backend.repository'
import { isUsefulUrlFromBandcampEmail, mapBandcampReleaseFeedItemToHydratedFeedItem } from './feed.mappers'
import { BandcampFeedItem, HydratedBandcampReleaseFeedItem, HydratedFeedItem } from './feed.schema'

const mapBandcampEmailToFeedItem = (email: BandcampEmailFeedSourceItem): BandcampFeedItem | null => {
    if (email.type == 'EMAIL.BANDCAMP_NEW_RELEASE') {
        return {
            id: crypto.randomUUID(),
            type: `BANDCAMP.TRALBUM`,
            dedupeIdentifier: email.releaseUrl,
            ingestedAt: new Date(),
            eventDate: new Date(email.dateReceived),
            isSnoozed: false,
            lastViewedAt: null,
            data: {
                tralbumUrl: email.releaseUrl,
                tralbumType: email.releaseUrl.includes('/album/') ? 'album' : 'track',
            },
            source: email,
        }
    }
    // @TODO: Implement this type
    if (email.type == 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC') {
        return null
    }

    return assertUnreachable(email, 'Unhandled Bandcamp email type: ' + JSON.stringify(email))
}

export class FeedBackendService {
    constructor(
        private emailRepo: EmailBackendRepository,
        private bandcampApiService: BandcampApiBackendService,
        private webScrapingService: WebScrapingService,
        private feedBackendRepository: FeedBackendRepository,
    ) {}

    async triggerEmailImport(abortSignal: AbortSignal): Promise<Observable<EmailImportProgressUpdate>> {
        console.log('Running email import...')

        const importStartedAt = new Date()
        let totalProcessed = 0
        let totalImported = 0

        const emails$ = await this.emailRepo.loadEmails('APPLE_MAIL', abortSignal)

        return merge(
            emails$.pipe(
                materialize(),
                switchMap(async notification => {
                    if (notification.kind == 'C' || notification.kind == 'E') {
                        // The complete and error values are handled by the buffered stream below
                        return NEVER
                    }
                    if (notification.kind == 'N') {
                        return {
                            phase: 'processing' as const,
                            current: notification.value.current,
                            total: notification.value.total,
                            // @TODO: this needs to be localized
                            message: notification.value.email.subject.replace(/�/g, ''),
                        }
                    }

                    return assertUnreachable(notification, 'Unhandled notification kind: ' + notification)
                }),
            ),
            emails$.pipe(
                bufferCount(50),
                concatMap(async emailPackets => {
                    totalProcessed += emailPackets.length
                    console.log('Processing batch of emails:', emailPackets.length)

                    const emailFeedSourceItems = emailPackets
                        // @TODO: figure out strategised email parsing (i.e. plugins for different email types)
                        .map(packet => parseBandcampEmail(packet.email))
                        .filter(isTruthy)

                    const feedItems = emailFeedSourceItems.map(mapBandcampEmailToFeedItem).filter(isTruthy)
                    totalImported += feedItems.length

                    await this.feedBackendRepository.ingestFeedItems(feedItems)
                }),
                materialize(),
                switchMap(async notification => {
                    if (notification.kind == 'C') {
                        const newlyImported =
                            await this.feedBackendRepository.countItemsIngestedAfterDate(importStartedAt)

                        return {
                            phase: 'completed' as const,
                            totalProcessed,
                            totalImported,
                            newlyImported,
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
                        return NEVER
                    }

                    return assertUnreachable(notification, 'Unhandled notification kind: ' + notification)
                }),
            ),
        )
    }

    // @TODO: error handling
    async hydrateBandcampFeedItem(item: BandcampFeedItem): Promise<HydratedBandcampReleaseFeedItem> {
        if (!item.data.tralbumUrl) {
            console.warn('No release link found:', item)

            return mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null, null, null)
        } else {
            const labelUrl = item.data.tralbumUrl.match(/https?:\/\/[\w-]+\.bandcamp\.com/)?.[0]

            const [releaseData, labelData, scrapedData, linkMetadataMap] = await Promise.all([
                this.bandcampApiService.getRelease(item.data.tralbumUrl),
                labelUrl
                    ? this.bandcampApiService.getBand(labelUrl).catch(err => {
                          console.error('Failed to load band', err)
                          return null
                      })
                    : null,
                this.bandcampApiService.scrapeRelease(item.data.tralbumUrl),
                item.source.type == 'EMAIL.BANDCAMP_NEW_RELEASE'
                    ? this.webScrapingService
                          .getLinkMetaDataBatch([
                              ...new Set(item.source.links.filter(isUsefulUrlFromBandcampEmail)),
                          ])
                          .catch(err => {
                              console.error('Failed to scrape links', err)
                              return null
                          })
                    : null,
            ])

            return mapBandcampReleaseFeedItemToHydratedFeedItem(
                item,
                releaseData,
                labelData,
                scrapedData,
                linkMetadataMap,
            )
        }
    }

    async hydrateFeed(items: BandcampFeedItem[]): Promise<HydratedFeedItem[]> {
        console.log('Hydrating feed items')
        const promises = items.map(async item => {
            if (item.type == 'BANDCAMP.TRALBUM') return await this.hydrateBandcampFeedItem(item)

            return assertUnreachable(item.type, 'Unhandled feed item type: ' + item.type)
        })
        const hydratedFeedItems = await Promise.all(promises)
        console.log('Hydrated', hydratedFeedItems.length, 'feed items')

        return hydratedFeedItems
    }

    async loadFeed(index: number, count: number): Promise<HydratedFeedItem[]> {
        // @TODO: how would we merge multiple feeds? how do we rank/prioritize items?
        const preHydrationFeed = await this.feedBackendRepository.listFeedItems(index, count)

        return await this.hydrateFeed(preHydrationFeed)
    }

    async markFeedItemAsViewed(id: string, feedItemType: HydratedFeedItem['type'], isSnoozed: boolean) {
        await this.feedBackendRepository.markFeedItemViewed(id, feedItemType, isSnoozed)
    }
}

import { assertUnreachable, isTruthy } from '../../src/app/shared/utils/type-guards.utils'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import { parseBandcampEmail } from '../bandcamp/bandcamp.email-parser'
import { EmailBackendRepository } from '../email/email.backend.repository'
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
            isViewed: false,
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

    // @TODO: this needs to run in the background and not block the UI
    async triggerEmailImport() {
        console.log('Running email import...')
        const emails = await this.emailRepo.loadEmails('appleMail')
        console.log('Imported', emails.length, 'emails')

        // @TODO: figure out strategised email parsing (i.e. plugins for different email types)
        const emailFeedSourceItems = emails.map(parseBandcampEmail).filter(isTruthy)
        console.log('Parsed', emailFeedSourceItems.length, 'Bandcamp feed source items')

        const feedItems = emailFeedSourceItems.map(mapBandcampEmailToFeedItem).filter(isTruthy)
        console.log('Mapped', feedItems.length, 'Bandcamp feed items')

        await this.feedBackendRepository.ingestFeedItems(feedItems)

        console.log('Finished ingesting')
    }

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

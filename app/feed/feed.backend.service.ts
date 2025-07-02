import { Album, Artist, Label, Track } from 'bandcamp-fetch'
import * as fs from 'fs/promises'
import { z } from 'zod'
import { entriesOf } from '../../src/app/shared/utils/object.utils'
import { assertUnreachable, isTruthy } from '../../src/app/shared/utils/type-guards.utils'
import { BandcampApiBackendService, ScrapedBandcampData } from '../bandcamp/bandcamp-api.backend.service'
import { BandcampEmailBackendService } from '../bandcamp/bandcamp-email.backend.service'
import { BandcampEmail } from '../bandcamp/bandcamp.email-parser'
import { PROVIDER_INIT } from '../utils/dependency-injection.util'
import { appEnv } from '../app-env'
import path from 'path'
import { ScrapedLinkMetadata, WebScrapingService } from '../web-scraping/web-scraping.service'

/**
 * The time after which a feed item should be shown again if it was marked as snoozed.
 */
const FEED_ITEM_SNOOZE_TIME_MS = 1000 * 60 * 60 * 24 * 16

/**
 * Don't create view history entries for feed items that were viewed in the last 3 minutes.
 * This is to prevent spamming the view history when the user is scrolling up and down the feed.
 */
const FEED_VIEW_HISTORY_THROTTLE_TIME_MS = 1000 * 60 * 3

type FeedItemBase = {
    id: string
    type: string
    [key: string]: unknown
}

const mapBandcampEmailToFeedItem = (email: BandcampEmail) => {
    if (email.bandcampEmailType !== 'NEW_RELEASE') {
        return null
    }

    return {
        id: 'bandcamp-email.' + email.messageId,
        type: `BANDCAMP_EMAIL.${email.bandcampEmailType}` as const,
        email,
    } satisfies FeedItemBase
}
type BandcampEmailFeedItem = NonNullable<ReturnType<typeof mapBandcampEmailToFeedItem>>

// @TODO:
const mapLinkStashItemToFeedItem = (data: unknown) => {
    return {
        id: 'link-stash-item.' + Math.random().toString(36).substring(2, 15),
        type: 'LINK_STASH_ITEM' as const,
        data,
    } satisfies FeedItemBase
}

const BANDCAMP_FAN_UNSUBSCRIBE_PATH = 'fan_unsubscribe'
const isUsefulUrlFromBandcampEmail = (link: string): boolean =>
    !link.includes('f4.bcbits.com') &&
    !link.includes('https://bandcamp.com/img/email/bc-logo-small-2.gif') &&
    !link.includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH)

export const mapBandcampReleaseFeedItemToHydratedFeedItem = (
    { email, ...item }: Extract<BandcampEmailFeedItem, { type: 'BANDCAMP_EMAIL.NEW_RELEASE' }>,
    releaseData: Album | Track | null,
    bandData: Label | Artist | null,
    scrapedData: ScrapedBandcampData | null,
    linkMetadataMap: Record<string, ScrapedLinkMetadata | null> | null,
) => {
    return {
        ...item,
        data: {
            releaseUrl: email.releaseUrl,
            releaseDate: releaseData?.releaseDate ? new Date(releaseData?.releaseDate) : null,
            emailReceivedAt: new Date(email.dateReceived),
            isEmailRead: email.isRead,
            emailId: email.messageId,
            releaseName: releaseData?.name || email.subject,
            label: bandData,
            artist: releaseData?.artist,
            releaseType: email.releaseType,
            about:
                scrapedData?.about
                    .replace(/^\s*(released|releases).+\n/m, '')
                    .replace(/(^((<br>)|\n|\s)+)|(((<br>)|\n|\s)+$)/g, '') ||
                email.plainBody
                    .replace(/(\s{2,}\?\s*)|(\s*\?\s{2,})/g, '\n')
                    .replace(/�/g, '')
                    .replace(
                        /((Unfollow|Unsubscribe) .+)(?=\n)/i,
                        `<a href="${email.links?.find(link => link.includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH))}">$1</a>`,
                    )
                    .replace(/check it out here/i, match => `<a href="${email.releaseUrl}">${match}</a>`)
                    .trim()
                    .replace(/\n/g, '<br>'),
            links: [...new Set(email.links)]?.filter(isUsefulUrlFromBandcampEmail).map(url => {
                const meta = linkMetadataMap?.[url]
                return {
                    title: meta?.title || url,
                    favicon: meta?.favicon,
                    url: url,
                }
            }),
            unsubscribeUrl: email.links?.find(link => link.includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH)) || null,
            unsubscribeText:
                email.plainBody.match(/((Unfollow|Unsubscribe) .+)(?=\n)/i)?.[0].replace(/�/g, '') ||
                'Unfollow',
            imageUrl:
                scrapedData?.artworkUrl ||
                releaseData?.imageUrl?.replace('_9.jpg', '_16.jpg') || // Bump the image size for better quality
                email.links?.find(link => link.includes('f4.bcbits.com'))?.replace('_9.jpg', '_16.jpg'),
            iframeUrl: releaseData?.id
                ? `https://bandcamp.com/EmbeddedPlayer/${email.releaseType}=${releaseData.id}/size=large/bgcol=999999/linkcol=0687f5`
                : null,
            tracks:
                releaseData?.type == 'album' ? releaseData?.tracks || [] : releaseData ? [releaseData] : [],
        },
    } satisfies FeedItemBase
}
export type HydratedBandcampReleaseFeedItem = ReturnType<typeof mapBandcampReleaseFeedItemToHydratedFeedItem>

export type HydratedFeedItem = HydratedBandcampReleaseFeedItem

const feedViewHistoryEntrySchema = z.object({
    id: z.string(),
    feedItemId: z.string(),
    ts: z.date({ coerce: true }),
    type: z.enum(['BANDCAMP_EMAIL.NEW_RELEASE']) satisfies z.Schema<HydratedFeedItem['type']>,
})
export type FeedViewHistoryEntry = z.infer<typeof feedViewHistoryEntrySchema>

const feedItemStateObject = z.object({
    id: z.string(),
    type: z.enum(['BANDCAMP_EMAIL.NEW_RELEASE']) satisfies z.Schema<HydratedFeedItem['type']>,
    isViewed: z.boolean(),
    isSnoozed: z.boolean(),
    lastViewedAt: z.date({ coerce: true }),
})
export class FeedBackendService {
    constructor(
        private bandcampEmailService: BandcampEmailBackendService,
        private bandcampApiService: BandcampApiBackendService,
        private webScrapingService: WebScrapingService,
    ) {}

    private appDataPath = appEnv.APP_DATA_PATH
    private stateBasePath = path.join(this.appDataPath, './state')

    async [PROVIDER_INIT]() {
        const isExisting = await fs
            .stat(this.stateBasePath)
            .then(() => true)
            .catch(() => false)
        if (!isExisting) {
            await fs.mkdir(this.stateBasePath, { recursive: true })
        }

        await this.loadState()
    }

    private bandcampFeedCache: BandcampEmailFeedItem[] | null = null
    async loadBandcampFeed() {
        if (this.bandcampFeedCache) {
            return this.bandcampFeedCache!
        }

        console.log('Loading Bandcamp emails...')
        const bandcampEmails = await this.bandcampEmailService.listBandcampEmails()
        this.bandcampFeedCache = bandcampEmails.map(mapBandcampEmailToFeedItem).filter(isTruthy)

        console.log('Loaded', this.bandcampFeedCache.length, 'Bandcamp emails')

        return this.bandcampFeedCache
    }
    async loadLinkStashFeed() {
        return [mapLinkStashItemToFeedItem({})]
    }

    async hydrateBandcampFeedItem(item: BandcampEmailFeedItem): Promise<HydratedBandcampReleaseFeedItem> {
        if (!item.email.releaseUrl) {
            console.warn('No release link found:', item.email)

            return mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null, null, null)
        } else {
            const labelUrl = item.email.releaseUrl.match(/https?:\/\/[\w-]+\.bandcamp\.com/)?.[0]

            const [releaseData, labelData, scrapedData, linkMetadataMap] = await Promise.all([
                this.bandcampApiService.getRelease(item.email.releaseUrl),
                labelUrl
                    ? this.bandcampApiService.getBand(labelUrl).catch(err => {
                          console.error('Failed to load band', err)
                          return null
                      })
                    : null,
                this.bandcampApiService.scrapeRelease(item.email.releaseUrl),
                this.webScrapingService
                    .getLinkMetaDataBatch([...new Set(item.email.links.filter(isUsefulUrlFromBandcampEmail))])
                    .catch(err => {
                        console.error('Failed to scrape links', err)
                        return null
                    }),
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

    async hydrateFeed(items: BandcampEmailFeedItem[]): Promise<HydratedFeedItem[]> {
        console.log('Hydrating feed items')
        const promises = items.map(async item => {
            if (item.type == 'BANDCAMP_EMAIL.NEW_RELEASE') return await this.hydrateBandcampFeedItem(item)

            return assertUnreachable(item.type, 'Unhandled feed item type: ' + item.type)
        })
        const hydratedFeedItems = await Promise.all(promises)
        console.log('Hydrated', hydratedFeedItems.length, 'feed items')

        return hydratedFeedItems
    }

    shouldShowFeedItem(item: BandcampEmailFeedItem): boolean {
        const feedItem = this.state.feedItemState[item.id]

        return (
            // Show if the item is unviewed
            !feedItem?.isViewed ||
            // or marked as snoozed
            (feedItem.isSnoozed
                ? // and hasn't been viewed in the configured snoozed time frame
                  (feedItem.lastViewedAt || 0) < new Date(Date.now() - FEED_ITEM_SNOOZE_TIME_MS)
                : false)
        )
    }

    async loadFeed(index: number, count: number): Promise<HydratedFeedItem[]> {
        const bandcampReleaseFeed = await this.loadBandcampFeed()

        if (index < 0 || index >= bandcampReleaseFeed.length) {
            console.warn('Index out of bounds', index, bandcampReleaseFeed.length)
            return []
        }

        // @TODO: how would we merge multiple feeds? how do we rank/prioritize items?
        const preHydrationFeed = bandcampReleaseFeed
            .filter(item => this.shouldShowFeedItem(item))
            .slice(index, index + count)

        return await this.hydrateFeed(preHydrationFeed)
    }

    async markFeedItemAsViewed(id: string, feedItemType: HydratedFeedItem['type'], isSnoozed: boolean) {
        // Only create a view event if the item was not viewed in the last X mins
        // (prevent spamming the view history when the user is e.g. scrolling up and down the feed)
        if (
            this.state.feedItemState[id]?.lastViewedAt
                ? this.state.feedItemState[id].lastViewedAt <
                  new Date(Date.now() - FEED_VIEW_HISTORY_THROTTLE_TIME_MS)
                : true
        ) {
            this.state.feedItemViewEvents.push({
                id: crypto.randomUUID(),
                feedItemId: id,
                ts: new Date(),
                type: feedItemType,
            })
        }
        this.state.feedItemState[id] = {
            id,
            type: feedItemType,
            isViewed: true,
            isSnoozed: isSnoozed,
            lastViewedAt: new Date(),
        }

        if (feedItemType == 'BANDCAMP_EMAIL.NEW_RELEASE') {
            // @TODO: mark email as read
        } else {
            return assertUnreachable(feedItemType, 'Unhandled feed item type: ' + feedItemType)
        }

        // @TODO: throttle this
        await this.commitState()
    }

    private stateFiles = {
        feedItemViewEvents: {
            path: path.join(this.stateBasePath, '/feed-view-history.json'),
            schema: feedViewHistoryEntrySchema.array().catch(err => {
                console.error('Failed to parse feed view history (falling back to default state):', err)
                return []
            }),
        },
        feedItemState: {
            path: path.join(this.stateBasePath, '/feed-items-state.json'),
            schema: z.record(z.string(), feedItemStateObject).catch(err => {
                console.error('Failed to parse feed items state (falling back to default state):', err)
                return {}
            }),
        },
    } satisfies Record<string, { path: string; schema: z.ZodCatch<z.Schema> }>
    private state!: {
        [K in keyof typeof this.stateFiles]: z.infer<(typeof this.stateFiles)[K]['schema']>
    }

    private async loadState() {
        try {
            this.state = Object.fromEntries(
                await Promise.all(
                    entriesOf(this.stateFiles).map(async ([stateKey, file]) => {
                        try {
                            const contents = await fs.readFile(file.path, 'utf-8')
                            const json = JSON.parse(contents)
                            return [stateKey, file.schema.parse(json)]
                        } catch (err) {
                            console.log('Failed to load state file "' + file.path + '":', err)

                            return [stateKey, file.schema.parse(null)]
                        }
                    }),
                ),
            )
        } catch (err) {
            console.error('Error loading viewed feed items state')
            throw err
        }
    }
    private async commitState() {
        await Promise.all(
            entriesOf(this.stateFiles).map(async ([stateKey, file]) => {
                const contents = JSON.stringify(this.state[stateKey], null, 2)
                await fs.writeFile(file.path, contents)
            }),
        )
    }
}

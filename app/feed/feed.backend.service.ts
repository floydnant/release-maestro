import { Album, Artist, Label, Track } from 'bandcamp-fetch'
import * as fs from 'fs/promises'
import { z } from 'zod'
import { entriesOf } from '../../src/app/shared/utils/object.utils'
import { assertUnreachable, isTruthy } from '../../src/app/shared/utils/type-guards.utils'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import { BandcampEmailBackendService } from '../bandcamp/bandcamp-email.backend.service'
import { BandcampEmail } from '../bandcamp/bandcamp.email-parser'
import { PROVIDER_INIT } from '../utils/dependency-injection.util'

/**
 * The time after which a feed item should be shown again if it was marked as snoozed.
 */
const FEED_ITEM_SNOOZE_TIME_MS = 1000 * 60 * 60 * 24 * 16

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

export const mapBandcampReleaseFeedItemToHydratedFeedItem = (
    { email, ...item }: Extract<BandcampEmailFeedItem, { type: 'BANDCAMP_EMAIL.NEW_RELEASE' }>,
    releaseData: Album | Track | null,
    bandData: Label | Artist | null,
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
            plainBody: email.plainBody
                .replace(/\s*\?\s*/g, '\n')
                .replace(/�/g, '')
                .replace(
                    /((Unfollow|Unsubscribe) .+)(?=\n)/i,
                    `<a href="${email.links?.find(link => link.includes('fan_unsubscribe'))}">$1</a>`,
                )
                .replace(/check it out here/i, match => `<a href="${email.releaseUrl}">${match}</a>`)
                .trim()
                .replace(/\n/g, '<br>'),
            links: email.links?.filter(
                link =>
                    !link.includes('f4.bcbits.com') &&
                    !link.includes('fan_unsubscribe') &&
                    !link.includes('https://bandcamp.com/img/email/bc-logo-small-2.gif'),
            ),
            imageUrl: releaseData?.imageUrl || email.links?.find(link => link.includes('f4.bcbits.com')),
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

const feedItemViewEventSchema = z.object({
    id: z.string(),
    feedItemId: z.string(),
    ts: z.date({ coerce: true }),
    type: z.enum(['BANDCAMP_EMAIL.NEW_RELEASE']) satisfies z.Schema<HydratedFeedItem['type']>,
})
export type FeedItemViewEvent = z.infer<typeof feedItemViewEventSchema>

const feedItemStateObject = z.object({
    id: z.string(),
    type: z.enum(['BANDCAMP_EMAIL.NEW_RELEASE']) satisfies z.Schema<HydratedFeedItem['type']>,
    isViewed: z.boolean(),
    isSnoozed: z.boolean(),
})
export class FeedBackendService {
    constructor(
        private bandcampEmailService: BandcampEmailBackendService,
        private bandcampApiService: BandcampApiBackendService,
    ) {}

    async [PROVIDER_INIT]() {
        console.log('Initializing FeedBackendService')
        if (
            !(await fs
                .stat('./state')
                .then(() => true)
                .catch(() => false))
        ) {
            await fs.mkdir('./state')
        }
        await this.loadState()
        console.log('FeedBackendService initialized')
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

            return mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null)
        } else {
            const labelUrl = item.email.releaseUrl.match(/https?:\/\/[\w-]+\.bandcamp\.com/)?.[0]

            const [releaseData, labelData] = await Promise.all([
                this.bandcampApiService.fetchRelease(item.email.releaseUrl),
                labelUrl
                    ? this.bandcampApiService.fetchBand(labelUrl).catch(err => {
                          console.error('Failed to load band', err)
                          return null
                      })
                    : null,
            ])

            return mapBandcampReleaseFeedItemToHydratedFeedItem(item, releaseData, labelData)
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

    getLastFeedItemViewEvent(itemId: string): FeedItemViewEvent | null {
        for (let i = this.state.feedItemViewEvents.length - 1; i >= 0; i--) {
            const event = this.state.feedItemViewEvents[i]!

            if (event.feedItemId === itemId) {
                return event
            }
        }
        return null
    }

    shouldShowFeedItem(item: BandcampEmailFeedItem): boolean {
        return (
            // Show if the item is unviewed
            !this.state.feedItemState[item.id]?.isViewed ||
            // or marked as snoozed
            (this.state.feedItemState[item.id]?.isSnoozed
                ? // and hasn't been viewed in the configured snoozed time frame
                  (this.getLastFeedItemViewEvent(item.id)?.ts || 0) <
                  new Date(Date.now() - FEED_ITEM_SNOOZE_TIME_MS)
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
        this.state.feedItemViewEvents.push({
            id: crypto.randomUUID(),
            feedItemId: id,
            ts: new Date(),
            type: feedItemType,
        })
        this.state.feedItemState[id] = {
            id,
            type: feedItemType,
            isViewed: true,
            isSnoozed: isSnoozed,
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
            path: './state/feed-item-view-events.json',
            schema: feedItemViewEventSchema.array().catch([]),
        },
        feedItemState: {
            path: './state/feed-items-state.json',
            schema: z.record(z.string(), feedItemStateObject).catch({}),
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

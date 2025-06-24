import { Album, Artist, Label, Track } from 'bandcamp-fetch'
import { Unwrap } from '../../src/app/shared/utils/object.utils'
import { assertUnreachable, isTruthy } from '../../src/app/shared/utils/type-guards.utils'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import { BandcampEmailBackendService } from '../bandcamp/bandcamp-email.backend.service'
import { BandcampEmail } from '../bandcamp/bandcamp.email-parser'

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
        id: 'bandcamp-release-email.' + email.messageId,
        type: `BANDCAMP.${email.bandcampEmailType}` as const,
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

export type HydratedFeedItem = Unwrap<ReturnType<FeedBackendService['loadFeed']>>[number]

export const mapBandcampReleaseFeedItemToHydratedFeedItem = (
    { email, ...item }: Extract<BandcampEmailFeedItem, { type: 'BANDCAMP.NEW_RELEASE' }>,
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

export class FeedBackendService {
    constructor(
        private bandcampEmailService: BandcampEmailBackendService,
        private bandcampApiService: BandcampApiBackendService,
    ) {}

    private bandcampFeedCache: BandcampEmailFeedItem[] | null = null
    async loadBandcampFeed() {
        if (this.bandcampFeedCache) {
            return this.bandcampFeedCache!
        }

        const bandcampEmails = await this.bandcampEmailService.listBandcampEmails()
        this.bandcampFeedCache = bandcampEmails.map(mapBandcampEmailToFeedItem).filter(isTruthy)

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

    async hydrateFeed(items: BandcampEmailFeedItem[]): Promise<HydratedBandcampReleaseFeedItem[]> {
        const promises = items.map(async item => {
            if (item.type == 'BANDCAMP.NEW_RELEASE') return await this.hydrateBandcampFeedItem(item)

            return assertUnreachable(item.type, 'Unhandled feed item type: ' + item.type)
        })
        return await Promise.all(promises)
    }

    async loadFeed(index: number, count: number) {
        const bandcampReleaseFeed = await this.loadBandcampFeed()

        if (index < 0 || index >= bandcampReleaseFeed.length) {
            console.warn('Index out of bounds', index, bandcampReleaseFeed.length)
            return []
        }

        // @TODO: how would we merge multiple feeds? how do we rank/prioritize items?
        const preHydrationFeed = bandcampReleaseFeed.slice(index, index + count)

        return await this.hydrateFeed(preHydrationFeed)
    }
}

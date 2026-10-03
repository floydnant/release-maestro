import { ScrapedTralbumInfo } from './bandcamp-api.schema'
import { BandcampFeedItem, HydratedBandcampReleaseFeedItem } from './feed.schema'
import { ScrapedLinkMetadata } from './web-scraping.schema'

const BANDCAMP_FAN_UNSUBSCRIBE_PATH = 'fan_unsubscribe'
const isBandcampArtworkUrl = (link: string): boolean => {
    try {
        const url = new URL(link)
        return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname === 'f4.bcbits.com'
    } catch {
        return false
    }
}

export const isUsefulUrlFromBandcampEmail = (link: string): boolean =>
    !isBandcampArtworkUrl(link) &&
    !link.includes('https://bandcamp.com/img/email/bc-logo-small-2.gif') &&
    !link.includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH)

export function mapBandcampReleaseFeedItemToHydratedFeedItem(
    { data, source, ...item }: Extract<BandcampFeedItem, { type: 'BANDCAMP.TRALBUM' }>,
    tralbum: ScrapedTralbumInfo | null,
    linkMetadataMap: Record<string, ScrapedLinkMetadata | null> | null,
    error: { userFacingMessage: string } | null,
): HydratedBandcampReleaseFeedItem {
    const newRelease = source.type === 'EMAIL.BANDCAMP_NEW_RELEASE' ? source : null
    const sourceLinks = newRelease?.links ?? []
    const releaseType = tralbum?.type ?? data.tralbumType

    return {
        ...item,
        sourceType: source.type,
        error: error?.userFacingMessage ? { message: error.userFacingMessage } : null,
        data: {
            releaseUrl: data.tralbumUrl,
            releaseDate: tralbum?.releaseDate ?? null,
            emailReceivedAt: new Date(source.dateReceived),
            isEmailRead: source.isRead,
            emailId: source.messageId,
            releaseName: tralbum?.title || newRelease?.subject || data.tralbumUrl,
            band: tralbum?.band || null,
            artist: tralbum?.artist || null,
            releaseType,
            about:
                tralbum?.about
                    .replace(/^\s*(released|releases).+\n/m, '')
                    .replace(/(^((<br>)|\n|\s)+)|(((<br>)|\n|\s)+$)/g, '') ||
                (newRelease?.plainBody ?? '')
                    // Only start once per whitespace run. A following '?' can start another separator.
                    .replace(/(?<!\s)(?:\s{2,}\?\s*|\s*\?\s{2,})|\?\s{2,}/g, '\n')
                    .replace(/�/g, '')
                    .replace(
                        /(Unfollow|Unsubscribe) [^\r\n]+/i,
                        `<a href="${sourceLinks.find(link => link.includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH))}">$&</a>`,
                    )
                    .replace(/check it out here/i, match => `<a href="${data.tralbumUrl}">${match}</a>`)
                    .trim()
                    .replace(/\n/g, '<br>'),
            links: [...new Set(sourceLinks)].filter(isUsefulUrlFromBandcampEmail).map(url => {
                const meta = linkMetadataMap?.[url]
                return {
                    title: meta?.title || url,
                    favicon: meta?.favicon,
                    url: url,
                }
            }),
            unsubscribeUrl: sourceLinks.find(link => link.includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH)) || null,
            unsubscribeText:
                newRelease?.plainBody.match(/(Unfollow|Unsubscribe) [^\r\n]+/i)?.[0].replace(/�/g, '') ||
                'Unfollow',
            imageUrl:
                tralbum?.artworkUrl || sourceLinks.find(isBandcampArtworkUrl)?.replace('_9.jpg', '_16.jpg'),
            iframeUrl: tralbum?.id
                ? `https://bandcamp.com/EmbeddedPlayer/${releaseType}=${tralbum.id}/size=large/bgcol=999999/linkcol=0687f5`
                : null,
            tracks: tralbum?.tracks || [],
        },
    }
}

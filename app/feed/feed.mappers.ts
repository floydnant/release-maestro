import { Album, Track, Label, Artist } from 'bandcamp-fetch'
import { ScrapedBandcampData } from '../bandcamp/bandcamp-api.backend.service'
import { ScrapedLinkMetadata } from '../web-scraping/web-scraping.service'
import { BandcampFeedItem, HydratedBandcampReleaseFeedItem } from './feed.schema'

const BANDCAMP_FAN_UNSUBSCRIBE_PATH = 'fan_unsubscribe'
export const isUsefulUrlFromBandcampEmail = (link: string): boolean =>
    !link.includes('f4.bcbits.com') &&
    !link.includes('https://bandcamp.com/img/email/bc-logo-small-2.gif') &&
    !link.includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH)

export function mapBandcampReleaseFeedItemToHydratedFeedItem(
    { data, source, ...item }: Extract<BandcampFeedItem, { type: 'BANDCAMP.TRALBUM' }>,
    releaseData: Album | Track | null,
    bandData: Label | Artist | null,
    scrapedData: ScrapedBandcampData | null,
    linkMetadataMap: Record<string, ScrapedLinkMetadata | null> | null,
): HydratedBandcampReleaseFeedItem {
    if (source.type != 'EMAIL.BANDCAMP_NEW_RELEASE')
        throw new Error('Cannot map fans bought music email to hydrated feed item')

    return {
        ...item,
        data: {
            releaseUrl: data.tralbumUrl,
            releaseDate: releaseData?.releaseDate ? new Date(releaseData?.releaseDate) : null,
            emailReceivedAt: new Date(source.dateReceived),
            isEmailRead: source.isRead,
            emailId: source.messageId,
            releaseName: releaseData?.name || source.subject,
            label: bandData,
            artist: releaseData?.artist,
            releaseType: source.releaseType,
            about:
                scrapedData?.about
                    .replace(/^\s*(released|releases).+\n/m, '')
                    .replace(/(^((<br>)|\n|\s)+)|(((<br>)|\n|\s)+$)/g, '') ||
                source.plainBody
                    .replace(/(\s{2,}\?\s*)|(\s*\?\s{2,})/g, '\n')
                    .replace(/�/g, '')
                    .replace(
                        /((Unfollow|Unsubscribe) .+)(?=\n)/i,
                        `<a href="${source.links?.find(link => link.includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH))}">$1</a>`,
                    )
                    .replace(/check it out here/i, match => `<a href="${source.releaseUrl}">${match}</a>`)
                    .trim()
                    .replace(/\n/g, '<br>'),
            links: [...new Set(source.links)]?.filter(isUsefulUrlFromBandcampEmail).map(url => {
                const meta = linkMetadataMap?.[url]
                return {
                    title: meta?.title || url,
                    favicon: meta?.favicon,
                    url: url,
                }
            }),
            unsubscribeUrl: source.links?.find(link => link.includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH)) || null,
            unsubscribeText:
                source.plainBody.match(/((Unfollow|Unsubscribe) .+)(?=\n)/i)?.[0].replace(/�/g, '') ||
                'Unfollow',
            imageUrl:
                scrapedData?.artworkUrl ||
                releaseData?.imageUrl?.replace('_9.jpg', '_16.jpg') || // Bump the image size for better quality
                source.links?.find(link => link.includes('f4.bcbits.com'))?.replace('_9.jpg', '_16.jpg'),
            iframeUrl: releaseData?.id
                ? `https://bandcamp.com/EmbeddedPlayer/${source.releaseType}=${releaseData.id}/size=large/bgcol=999999/linkcol=0687f5`
                : null,
            tracks:
                releaseData?.type == 'album' ? releaseData?.tracks || [] : releaseData ? [releaseData] : [],
        },
    }
}

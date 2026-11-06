import { ScrapedTralbumInfo } from './bandcamp-api.schema'
import { BandcampFeedItem, HydratedBandcampReleaseFeedItem } from './feed.schema'
import { ScrapedLinkMetadata } from './web-scraping.schema'

const BANDCAMP_FAN_UNSUBSCRIBE_PATH = 'fan_unsubscribe'
const parseHttpUrl = (link: string): URL | null => {
    try {
        const url = new URL(link)
        return ['http:', 'https:'].includes(url.protocol) ? url : null
    } catch {
        return null
    }
}

const isArtworkUrl = (link: string): boolean => parseHttpUrl(link)?.hostname === 'f4.bcbits.com'
const isUnsubscribeUrl = (link: string): boolean => {
    const url = parseHttpUrl(link)
    return (
        url !== null &&
        (url.hostname === 'bandcamp.com' || url.hostname.endsWith('.bandcamp.com')) &&
        url.pathname.split('/').includes(BANDCAMP_FAN_UNSUBSCRIBE_PATH)
    )
}

export const isUsefulUrlFromBandcampEmail = (link: string): boolean => {
    const url = parseHttpUrl(link)
    return (
        url !== null &&
        url.hostname !== 'f4.bcbits.com' &&
        !(url.hostname === 'bandcamp.com' && url.pathname === '/img/email/bc-logo-small-2.gif') &&
        !isUnsubscribeUrl(link)
    )
}

// Consume each boundary token once. Nested whitespace/line-break regexes backtrack on long input.
const cleanTralbumAbout = (text: string): string => {
    const lines = text.split('\n')
    const releaseLine = lines.findIndex((line, index) => {
        const value = line.trimStart()
        return (
            index < lines.length - 1 &&
            value.length > 8 &&
            (value.startsWith('released') || value.startsWith('releases'))
        )
    })
    if (releaseLine >= 0) lines.splice(releaseLine, 1)
    const value = lines.join('\n')
    let start = 0
    let end = value.length
    while (start < end) {
        if (/\s/.test(value.charAt(start))) start++
        else if (value.startsWith('<br>', start)) start += 4
        else break
    }
    while (end > start) {
        if (/\s/.test(value.charAt(end - 1))) end--
        else if (end - start >= 4 && value.slice(end - 4, end) === '<br>') end -= 4
        else break
    }
    return value.slice(start, end)
}

const normalizeEmailSeparators = (text: string): string => {
    const parts: string[] = []
    let cursor = 0
    let question = text.indexOf('?')
    while (question >= 0) {
        let start = question
        let end = question + 1
        while (start > cursor && /\s/.test(text.charAt(start - 1))) start--
        while (end < text.length && /\s/.test(text.charAt(end))) end++
        if (question - start >= 2 || end - question - 1 >= 2) {
            parts.push(text.slice(cursor, start), '\n')
            cursor = end
        } else {
            parts.push(text.slice(cursor, question + 1))
            cursor = question + 1
        }
        question = text.indexOf('?', cursor)
    }
    parts.push(text.slice(cursor))
    return parts.join('')
}

// Match fixed words within one line, without retrying a greedy suffix at every word occurrence.
const findUnsubscribeText = (text: string): string | null => {
    const lines = text.split('\n')
    for (let index = 0; index < lines.length - 1; index++) {
        const line = lines[index]!
        const match = /Unfollow |Unsubscribe /i.exec(line)
        if (match && line.length > match.index + match[0].length) return line.slice(match.index)
    }
    return null
}

const escapeHtml = (value: string): string =>
    value.replace(/[&<>"']/g, character => {
        switch (character) {
            case '&':
                return '&amp;'
            case '<':
                return '&lt;'
            case '>':
                return '&gt;'
            case '"':
                return '&quot;'
            default:
                return '&#39;'
        }
    })

const emailAbout = (plainBody: string, unsubscribeUrl: string | null, releaseUrl: string): string => {
    // The feed renders this field as HTML. Escape email text before adding our own anchors.
    let text = escapeHtml(normalizeEmailSeparators(plainBody).replace(/�/g, ''))
    const unsubscribeText = findUnsubscribeText(text)
    const unsubscribe = unsubscribeUrl ? parseHttpUrl(unsubscribeUrl) : null
    if (unsubscribeText && unsubscribe)
        text = text.replace(
            unsubscribeText,
            () => `<a href="${escapeHtml(unsubscribe.href)}">${unsubscribeText}</a>`,
        )
    const release = parseHttpUrl(releaseUrl)
    if (release)
        text = text.replace(
            /check it out here/i,
            match => `<a href="${escapeHtml(release.href)}">${match}</a>`,
        )
    return text.trim().replace(/\n/g, '<br>')
}

export function mapBandcampReleaseFeedItemToHydratedFeedItem(
    { data, source, ...item }: Extract<BandcampFeedItem, { type: 'BANDCAMP.TRALBUM' }>,
    tralbum: ScrapedTralbumInfo | null,
    linkMetadataMap: Record<string, ScrapedLinkMetadata | null> | null,
    error: { userFacingMessage: string } | null,
): HydratedBandcampReleaseFeedItem {
    if (source.type != 'EMAIL.BANDCAMP_NEW_RELEASE')
        throw new Error('Cannot map fans bought music email to hydrated feed item')

    const unsubscribeUrl = source.links.find(isUnsubscribeUrl) ?? null

    return {
        ...item,
        error: error?.userFacingMessage ? { message: error.userFacingMessage } : null,
        data: {
            releaseUrl: data.tralbumUrl,
            releaseDate: tralbum?.releaseDate ?? null,
            emailReceivedAt: new Date(source.dateReceived),
            isEmailRead: source.isRead,
            emailId: source.messageId,
            releaseName: tralbum?.title || source.subject,
            band: tralbum?.band || null,
            artist: tralbum?.artist || null,
            releaseType: source.releaseType,
            about:
                (tralbum && cleanTralbumAbout(tralbum.about)) ||
                emailAbout(source.plainBody, unsubscribeUrl, source.releaseUrl),
            links: [...new Set(source.links)]?.filter(isUsefulUrlFromBandcampEmail).map(url => {
                const meta = linkMetadataMap?.[url]
                return {
                    title: meta?.title || url,
                    favicon: meta?.favicon,
                    url: url,
                }
            }),
            unsubscribeUrl,
            unsubscribeText: findUnsubscribeText(source.plainBody)?.replace(/�/g, '') || 'Unfollow',
            imageUrl: tralbum?.artworkUrl || source.links.find(isArtworkUrl)?.replace('_9.jpg', '_16.jpg'),
            iframeUrl: tralbum?.id
                ? `https://bandcamp.com/EmbeddedPlayer/${source.releaseType}=${tralbum.id}/size=large/bgcol=999999/linkcol=0687f5`
                : null,
            tracks: tralbum?.tracks || [],
        },
    }
}

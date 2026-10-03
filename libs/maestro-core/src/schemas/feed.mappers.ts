import { ScrapedTralbumInfo } from './bandcamp-api.schema'
import { BandcampFeedItem, HydratedBandcampReleaseFeedItem } from './feed.schema'
import { ScrapedLinkMetadata } from './web-scraping.schema'

// Email content is untrusted. Classify links by their parsed host and path, never by substring, and
// scan text in linear time: nested or adjacent quantifiers backtrack polynomially on long input.

// Links

const parseHttpUrl = (link: string): URL | null => {
    try {
        const url = new URL(link)
        return url.protocol === 'http:' || url.protocol === 'https:' ? url : null
    } catch {
        return null
    }
}

const isArtwork = (url: URL): boolean => url.hostname === 'f4.bcbits.com'
const isEmailLogo = (url: URL): boolean =>
    url.hostname === 'bandcamp.com' && url.pathname === '/img/email/bc-logo-small-2.gif'
const isUnsubscribe = (url: URL): boolean =>
    (url.hostname === 'bandcamp.com' || url.hostname.endsWith('.bandcamp.com')) &&
    url.pathname.split('/').includes('fan_unsubscribe')

// Lifts a URL predicate to raw links. Links that are not HTTP(S) URLs never match.
const httpLinkWhere =
    (predicate: (url: URL) => boolean) =>
    (link: string): boolean => {
        const url = parseHttpUrl(link)
        return url !== null && predicate(url)
    }

const isArtworkLink = httpLinkWhere(isArtwork)
const isUnsubscribeLink = httpLinkWhere(isUnsubscribe)
export const isUsefulUrlFromBandcampEmail = httpLinkWhere(
    url => !isArtwork(url) && !isEmailLogo(url) && !isUnsubscribe(url),
)

// Text scanning

const REPLACEMENT_CHARACTER = '�'
const LINE_BREAK_TAG = '<br>'
const isWhitespace = (character: string | undefined): boolean =>
    character !== undefined && /\s/.test(character)

// Trims whitespace and <br> tags from both ends of scraped HTML.
const trimHtmlPadding = (html: string): string => {
    let start = 0
    let end = html.length
    while (start < end) {
        if (isWhitespace(html[start])) start++
        else if (html.startsWith(LINE_BREAK_TAG, start)) start += LINE_BREAK_TAG.length
        else break
    }
    while (end > start) {
        if (isWhitespace(html[end - 1])) end--
        else if (end - start >= LINE_BREAK_TAG.length && html.endsWith(LINE_BREAK_TAG, end))
            end -= LINE_BREAK_TAG.length
        else break
    }
    return html.slice(start, end)
}

// Drops the first "released <date>" line from a scraped release description, unless it is the last line.
const withoutReleaseDateLine = (about: string): string => {
    const lines = about.split('\n')
    const index = lines.findIndex(
        (line, i) => i < lines.length - 1 && /^\s*(?:released|releases)./.test(line),
    )
    if (index >= 0) lines.splice(index, 1)
    return lines.join('\n')
}

// Plain-text emails separate sections with a "?" padded by whitespace. A "?" with at least two
// whitespace characters on either side becomes a line break, together with all of that whitespace.
// Any other question mark is ordinary text.
const breakAtPaddedQuestionMarks = (text: string): string => {
    let result = ''
    let copiedUpTo = 0
    for (let mark = text.indexOf('?'); mark >= 0; mark = text.indexOf('?', mark + 1)) {
        // Padding consumed by the previous separator is not shared with this one.
        let start = mark
        while (start > copiedUpTo && isWhitespace(text[start - 1])) start--
        let end = mark + 1
        while (isWhitespace(text[end])) end++
        if (mark - start < 2 && end - (mark + 1) < 2) continue
        result += text.slice(copiedUpTo, start) + '\n'
        copiedUpTo = end
    }
    return result + text.slice(copiedUpTo)
}

// The first line, other than the last, containing "Unfollow " or "Unsubscribe " followed by more
// text. Returns that line from the keyword on.
const findUnsubscribeText = (text: string): string | null => {
    const lines = text.split('\n')
    for (const line of lines.slice(0, -1)) {
        const keyword = /Unfollow |Unsubscribe /i.exec(line)
        if (keyword && line.length > keyword.index + keyword[0].length) return line.slice(keyword.index)
    }
    return null
}

// HTML rendering

const HTML_ESCAPES: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
}
const escapeHtml = (text: string): string => text.replace(/[&<>"']/g, character => HTML_ESCAPES[character]!)

// Wraps the first occurrence of `text` in an anchor, only when `link` is an HTTP(S) URL.
const linkFirst = (html: string, text: string | null | undefined, link: string | null): string => {
    const url = link === null ? null : parseHttpUrl(link)
    if (!text || !url) return html
    return html.replace(text, () => `<a href="${escapeHtml(url.href)}">${text}</a>`)
}

// Scraped release descriptions are already HTML from Bandcamp.
const renderTralbumAbout = (about: string): string => trimHtmlPadding(withoutReleaseDateLine(about))

// The feed renders `about` as HTML. Escape the email text first, then add only our own anchors.
const renderEmailAbout = (plainBody: string, unsubscribeLink: string | null, releaseLink: string): string => {
    let html = escapeHtml(breakAtPaddedQuestionMarks(plainBody).replaceAll(REPLACEMENT_CHARACTER, ''))
    html = linkFirst(html, findUnsubscribeText(html), unsubscribeLink)
    html = linkFirst(html, /check it out here/i.exec(html)?.[0], releaseLink)
    return html.trim().replaceAll('\n', LINE_BREAK_TAG)
}

export function mapBandcampReleaseFeedItemToHydratedFeedItem(
    { data, source, ...item }: Extract<BandcampFeedItem, { type: 'BANDCAMP.TRALBUM' }>,
    tralbum: ScrapedTralbumInfo | null,
    linkMetadataMap: Record<string, ScrapedLinkMetadata | null> | null,
    error: { userFacingMessage: string } | null,
): HydratedBandcampReleaseFeedItem {
    const newRelease = source.type === 'EMAIL.BANDCAMP_NEW_RELEASE' ? source : null
    const sourceLinks = newRelease?.links ?? []
    const releaseType = tralbum?.type ?? data.tralbumType

    const unsubscribeUrl = sourceLinks.find(isUnsubscribeLink) ?? null

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
                (tralbum && renderTralbumAbout(tralbum.about)) ||
                renderEmailAbout(newRelease?.plainBody ?? '', unsubscribeUrl, data.tralbumUrl),
            links: [...new Set(sourceLinks)].filter(isUsefulUrlFromBandcampEmail).map(url => {
                const meta = linkMetadataMap?.[url]
                return {
                    title: meta?.title || url,
                    favicon: meta?.favicon,
                    url: url,
                }
            }),
            unsubscribeUrl,
            unsubscribeText:
                findUnsubscribeText(newRelease?.plainBody ?? '')?.replaceAll(REPLACEMENT_CHARACTER, '') ||
                'Unfollow',
            imageUrl: tralbum?.artworkUrl || sourceLinks.find(isArtworkLink)?.replace('_9.jpg', '_16.jpg'),
            iframeUrl: tralbum?.id
                ? `https://bandcamp.com/EmbeddedPlayer/${releaseType}=${tralbum.id}/size=large/bgcol=999999/linkcol=0687f5`
                : null,
            tracks: tralbum?.tracks || [],
        },
    }
}

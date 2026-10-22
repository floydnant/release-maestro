import { Email } from '@release-maestro/core'
import {
    BandcampEmailFeedSourceItem,
    BandcampFan,
    BandcampPurchase,
    mergeBandcampPurchases,
    normalizeBandcampReleaseUrl,
} from '@release-maestro/core'
import { load as cheerioLoad } from 'cheerio'

const removeUrlTracking = (href: string): string => href.replace(/[?#].*$/, '')

const fanProfileUrl = (href: string | undefined): string | null => {
    if (!href) return null
    const url = URL.parse(href, 'https://bandcamp.com')
    if (!url || !['http:', 'https:'].includes(url.protocol) || url.hostname !== 'bandcamp.com') return null
    url.protocol = 'https:'
    return removeUrlTracking(url.href).replace(/\/$/, '')
}

const canonicalBandcampReleaseUrl = (href: string | undefined): string | null => {
    if (!href) return null
    try {
        const url = new URL(href)
        if (
            (url.protocol !== 'http:' && url.protocol !== 'https:') ||
            !/^[\w-]+\.bandcamp\.com$/.test(url.hostname) ||
            !/^\/(album|track)\//.test(url.pathname)
        ) {
            return null
        }
        return normalizeBandcampReleaseUrl(url.href)
    } catch {
        return null
    }
}

export const parseBandcampEmail = (email: Email): BandcampEmailFeedSourceItem | null => {
    // @TODO: there are also "New releases" (plural) emails, which contain multiple releases.
    // Right now, the subsequent releases are simply shown as additional links,
    // but we could also parse them into separate feed items.
    if (email.subject.includes('New release')) {
        let musicLinks: string[] =
            email.htmlBody.match(/https?:\/\/[\w-]+\.bandcamp\.com\/(album|track)[^" ]+/g) || []
        const checkItOutLink = email.htmlBody
            .match(/<a[^>]+>check it out here<\/a>/)?.[0]
            ?.match(/href="([^"]+)"/)?.[1]
        if (checkItOutLink) musicLinks.unshift(checkItOutLink)
        musicLinks = [
            ...new Set(
                musicLinks
                    .map(link => normalizeBandcampReleaseUrl(link))
                    .filter((link): link is string => link !== null),
            ),
        ]

        const releaseUrl = musicLinks.shift()
        if (!releaseUrl) return null

        const links = (email.htmlBody.match(/https?:\/\/[\w-.]+\.\w+\/[^" ]+/g) || []).filter(
            l => !l.includes('bandcamp.com/album') && !l.includes('bandcamp.com/track'),
        )
        links.unshift(...musicLinks)

        return {
            ...email,
            releaseUrl: releaseUrl,
            releaseType: releaseUrl.includes('bandcamp.com/track') ? ('track' as const) : ('album' as const),
            type: 'EMAIL.BANDCAMP_NEW_RELEASE',
            links: links,
        }
    } else if (email.subject.includes('bought new music on Bandcamp')) {
        const $ = cheerioLoad(email.htmlBody)
        const tralbumUrls = [
            ...new Set(
                $('a[href]')
                    .toArray()
                    .map(link => canonicalBandcampReleaseUrl($(link).attr('href')))
                    .filter((url): url is string => url !== null),
            ),
        ]
        const purchases: BandcampPurchase[] = []
        $('.item-tralbum-text').each((_, element) => {
            const item = $(element)
            const tralbumUrl = canonicalBandcampReleaseUrl(item.children('a[href]').first().attr('href'))
            if (!tralbumUrl) return

            const fans = new Map<string, BandcampFan>()
            item.find('.bought-by a[href]').each((_, link) => {
                const profileUrl = fanProfileUrl($(link).attr('href'))
                const name = $(link).text().replace(/\s+/g, ' ').trim()
                if (profileUrl && name) fans.set(profileUrl, { name, profileUrl, imageUrl: null })
            })
            item.find('.purchaser-photos a[href]').each((_, link) => {
                const profileUrl = fanProfileUrl($(link).attr('href'))
                const fan = profileUrl ? fans.get(profileUrl) : undefined
                const image = $(link).find('img').attr('src')
                const imageUrl = image ? URL.parse(image, 'https://bandcamp.com') : null
                if (fan && imageUrl && ['http:', 'https:'].includes(imageUrl.protocol)) {
                    fan.imageUrl = imageUrl.href
                }
            })
            purchases.push({ tralbumUrl, fans: [...fans.values()] })
        })

        return {
            ...email,
            type: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            purchases: mergeBandcampPurchases(
                tralbumUrls.map(tralbumUrl => ({ tralbumUrl, fans: [] })),
                purchases,
            ),
        }
    }

    return null
}

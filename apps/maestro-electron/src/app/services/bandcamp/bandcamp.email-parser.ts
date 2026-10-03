import { Email } from '@release-maestro/core'
import { BandcampEmailFeedSourceItem } from '@release-maestro/core'
import { load as cheerioLoad } from 'cheerio'

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
        url.search = ''
        url.hash = ''
        return url.href
    } catch {
        return null
    }
}

export const parseBandcampEmail = (email: Email): BandcampEmailFeedSourceItem | null => {
    let musicLinks: string[] =
        email.htmlBody.match(/https?:\/\/[\w-]+\.bandcamp\.com\/(album|track)[^" ]+/g) || []

    // @TODO: there are also "New releases" (plural) emails, which contain multiple releases.
    // Right now, the subsequent releases are simply shown as additional links,
    // but we could also parse them into separate feed items.
    if (email.subject.includes('New release')) {
        const checkItOutLink = email.htmlBody
            .match(/<a[^>]+>check it out here<\/a>/)?.[0]
            ?.match(/href="([^"]+)"/)?.[1]
        if (checkItOutLink) musicLinks.unshift(checkItOutLink)
        musicLinks = [...new Set(musicLinks.map(l => l.replace(/\?.+$/, '')))]

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
        const purchases = new Map<string, Set<string>>()
        $('.item-tralbum-text').each((_, element) => {
            const item = $(element)
            const tralbumUrl = canonicalBandcampReleaseUrl(item.children('a[href]').first().attr('href'))
            if (!tralbumUrl) return

            const fanNames = purchases.get(tralbumUrl) ?? new Set<string>()
            item.find('.bought-by a').each((_, fan) => {
                const name = $(fan).text().replace(/\s+/g, ' ').trim()
                if (name) fanNames.add(name)
            })
            purchases.set(tralbumUrl, fanNames)
        })

        return {
            ...email,
            type: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            tralbumUrls,
            purchases: [...purchases].map(([tralbumUrl, fanNames]) => ({
                tralbumUrl,
                fanNames: [...fanNames],
            })),
        }
    }

    return null
}

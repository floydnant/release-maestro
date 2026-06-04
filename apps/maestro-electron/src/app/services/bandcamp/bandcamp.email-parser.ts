import { Email } from '@release-maestro/core'
import { BandcampEmailFeedSourceItem } from '@release-maestro/core'

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
        return {
            ...email,
            type: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            tralbumUrls: [...new Set(musicLinks.map(l => l.replace(/\?.+$/, '')))],
        }
    }

    return null
}
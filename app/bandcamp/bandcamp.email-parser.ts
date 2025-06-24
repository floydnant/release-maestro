import { Email } from '../email/email.backend.repository'

export type BandcampEmailType =
    | 'NEW_MESSAGE'
    | 'NEW_RELEASE'
    | 'SHIPMENT_NOTIFICATION'
    | 'FANS_BOUGHT_NEW_STUFF'
    | 'THANK_YOU'
    | 'LISTENING_PARTY'
    | 'OTHER'

export const parseBandcampEmail = (email: Email) => {
    let bandcampEmailType: BandcampEmailType
    if (email.subject.includes('New message from')) {
        bandcampEmailType = 'NEW_MESSAGE'
    } else if (email.subject.includes('New release')) {
        bandcampEmailType = 'NEW_RELEASE'

        let musicLinks: string[] =
            email.htmlBody.match(/https?:\/\/[\w-]+\.bandcamp\.com\/(album|track)[^" ]+/g) || []
        const checkItOutLink = email.htmlBody
            .match(/<a[^>]+>check it out here<\/a>/)?.[0]
            ?.match(/href="([^"]+)"/)?.[1]
        if (checkItOutLink) musicLinks.unshift(checkItOutLink)
        musicLinks = [...new Set(musicLinks.map(l => l.replace(/\?.+$/, '')))]

        return {
            ...email,
            releaseUrl: musicLinks[0],
            releaseType: musicLinks?.[0]?.includes('bandcamp.com/track')
                ? ('track' as const)
                : ('album' as const),
            bandcampEmailType,
            musicLinks,
            links: (email.htmlBody.match(/https?:\/\/[\w-\.]+\.\w+\/[^" ]+/g) || []).filter(
                l => !l.includes('bandcamp.com/album') && !l.includes('bandcamp.com/track'),
            ),
        }
    } else if (/Your order from .+ is on its way!/.test(email.subject)) {
        bandcampEmailType = 'SHIPMENT_NOTIFICATION'
    } else if (email.subject.includes('bought new music on Bandcamp')) {
        bandcampEmailType = 'FANS_BOUGHT_NEW_STUFF'
    } else if (email.subject == 'Thank you!') {
        bandcampEmailType = 'THANK_YOU'
    } else if (/Listening Party/i.test(email.subject)) {
        bandcampEmailType = 'LISTENING_PARTY'
    } else {
        bandcampEmailType = 'OTHER'
    }

    return {
        ...email,
        bandcampEmailType,
    }
}

export type BandcampEmail = ReturnType<typeof parseBandcampEmail>

// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared synthetic fixtures live in fixtures/, per docs/testing.md.
import {
    fansBoughtMusicFeedItem,
    newReleaseEmail,
    scrapedBandcampAlbum,
} from '../../../../fixtures/feed.fixture'
import { ScrapedTralbumInfo } from './bandcamp-api.schema'
import { BandcampFeedItem } from './feed.schema'
import { isUsefulUrlFromBandcampEmail, mapBandcampReleaseFeedItemToHydratedFeedItem } from './feed.mappers'

const release = (plainBody: string, links: string[] = []): BandcampFeedItem => ({
    id: 'release',
    ingestedAt: new Date('2026-01-01'),
    eventDate: new Date('2026-01-01'),
    isSnoozed: false,
    lastViewedAt: null,
    dedupeIdentifier: 'release',
    type: 'BANDCAMP.TRALBUM',
    data: { tralbumUrl: 'https://artist.bandcamp.com/album/release', tralbumType: 'album' },
    source: {
        type: 'EMAIL.BANDCAMP_NEW_RELEASE',
        vendor: 'APPLE_MAIL',
        messageId: 'email',
        subject: 'New release',
        dateReceived: '2026-01-01',
        sender: 'noreply@bandcamp.com',
        htmlBody: '',
        plainBody,
        isRead: false,
        releaseType: 'album',
        releaseUrl: 'https://artist.bandcamp.com/album/release',
        links,
    },
})
const tralbum = (about: string): ScrapedTralbumInfo => ({
    title: 'Release',
    artist: 'Artist',
    releaseDate: null,
    type: 'album',
    id: 1,
    artworkUrl: null,
    about,
    aboutLinks: [],
    band: null,
    tracks: [],
})
const hydrate = (plainBody: string, links: string[] = [], about?: string) =>
    mapBandcampReleaseFeedItemToHydratedFeedItem(
        release(plainBody, links),
        about === undefined ? null : tralbum(about),
        null,
        null,
    ).data

it('classifies parsed HTTP URLs instead of matching hostnames inside paths or credentials', () => {
    expect(isUsefulUrlFromBandcampEmail('https://f4.bcbits.com/img/art.jpg')).toBe(false)
    expect(isUsefulUrlFromBandcampEmail('https://bandcamp.com/img/email/bc-logo-small-2.gif')).toBe(false)
    expect(isUsefulUrlFromBandcampEmail('https://artist.bandcamp.com/album/release')).toBe(true)
    expect(isUsefulUrlFromBandcampEmail('https://example.com/f4.bcbits.com/art.jpg')).toBe(true)
    expect(isUsefulUrlFromBandcampEmail('https://f4.bcbits.com@example.com/art.jpg')).toBe(true)
    expect(isUsefulUrlFromBandcampEmail('javascript:alert(1)')).toBe(false)
    expect(isUsefulUrlFromBandcampEmail('not a URL')).toBe(false)
})

it('selects artwork and unsubscribe URLs only from the intended hosts and paths', () => {
    const unsubscribe = 'https://bandcamp.com/fan_unsubscribe?token=123'
    const image = 'https://f4.bcbits.com/img/a_9.jpg'
    const item = hydrate('Unfollow Artist\n', [
        'https://bandcamp.com.attacker.example/fan_unsubscribe',
        'https://example.com/f4.bcbits.com/a_9.jpg',
        'https://artist.bandcamp.com/album/fan_unsubscribe-fake',
        unsubscribe,
        image,
    ])
    expect(item.unsubscribeUrl).toBe(unsubscribe)
    expect(item.imageUrl).toBe('https://f4.bcbits.com/img/a_16.jpg')
    expect(item.unsubscribeText).toBe('Unfollow Artist')
    expect(item.about).toBe(`<a href="${unsubscribe}">Unfollow Artist</a>`)
})

it('preserves description formatting and ordinary question marks', () => {
    expect(hydrate('fallback', [], ' <br>\nreleased January 1\n<br> Description <br> \n').about).toBe(
        'Description',
    )
    expect(hydrate('How? Hello  ?  World\nCheck it out here').about).toBe(
        'How? Hello<br>World<br><a href="https://artist.bandcamp.com/album/release">Check it out here</a>',
    )
    expect(hydrate('fallback', [], '<br> \n').about).toBe('fallback')
})

it('handles long malformed email content without regex backtracking', () => {
    const spaces = ' '.repeat(100_000)
    expect(hydrate(`Body${spaces}!`).about).toBe(`Body${spaces}!`)
    expect(hydrate(`Body${spaces}? Tail`).about).toBe('Body<br>Tail')
    const repeated = 'Unfollow '.repeat(10_000) + '!'
    expect(hydrate(repeated).unsubscribeText).toBe('Unfollow')
    expect(hydrate('fallback', [], '<br>'.repeat(10_000) + ' Text ' + '<br>'.repeat(10_000)).about).toBe(
        'Text',
    )
})

it('escapes email text and URL attributes before rendering generated HTML', () => {
    const unsubscribe = 'https://bandcamp.com/fan_unsubscribe?x=" onmouseover="alert(1)'
    const item = hydrate('<img src=x onerror=alert(1)>\nUnfollow Artist\nCheck it out here', [unsubscribe])
    expect(item.about).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(item.about).toContain(
        'href="https://bandcamp.com/fan_unsubscribe?x=%22%20onmouseover=%22alert(1)"',
    )
    expect(item.about).not.toContain('<img')
    const source = release('Check it out here')
    source.data.tralbumUrl = 'javascript:alert(1)'
    expect(mapBandcampReleaseFeedItemToHydratedFeedItem(source, null, null, null).data.about).toBe(
        'Check it out here',
    )
})

describe('mapBandcampReleaseFeedItemToHydratedFeedItem', () => {
    it('hydrates fan purchases from the release page and preserves the notification origin', () => {
        const result = mapBandcampReleaseFeedItemToHydratedFeedItem(
            fansBoughtMusicFeedItem,
            scrapedBandcampAlbum,
            null,
            null,
        )

        expect(result).toMatchObject({
            id: fansBoughtMusicFeedItem.id,
            sourceType: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            error: null,
            data: {
                releaseUrl: fansBoughtMusicFeedItem.data.tralbumUrl,
                releaseName: 'First Release',
                artist: 'Test Artist',
                emailId: fansBoughtMusicFeedItem.source.messageId,
                fanNames: ['Adam Pitts'],
                emailReceivedAt: fansBoughtMusicFeedItem.eventDate,
                isEmailRead: true,
                about: 'An album bought by a fan.',
                imageUrl: scrapedBandcampAlbum.artworkUrl,
                tracks: scrapedBandcampAlbum.tracks,
                links: [],
                unsubscribeUrl: null,
                iframeUrl:
                    'https://bandcamp.com/EmbeddedPlayer/album=123/size=large/bgcol=999999/linkcol=0687f5',
            },
        })
    })

    it('uses the track type for a fan-purchase player', () => {
        const trackItem: BandcampFeedItem = {
            ...fansBoughtMusicFeedItem,
            data: { tralbumUrl: 'https://other.bandcamp.com/track/second', tralbumType: 'track' },
        }
        const result = mapBandcampReleaseFeedItemToHydratedFeedItem(
            trackItem,
            { ...scrapedBandcampAlbum, type: 'track' },
            null,
            null,
        )

        expect(result.data.releaseType).toBe('track')
        expect(result.data.fanNames).toEqual(['Maya', 'River & Rain'])
        expect(result.data.iframeUrl).toContain('/track=123/')
    })

    it('keeps a fan purchase usable when hydration fails', () => {
        const result = mapBandcampReleaseFeedItemToHydratedFeedItem(fansBoughtMusicFeedItem, null, null, {
            userFacingMessage: 'The Bandcamp track or album could not be found',
        })

        expect(result).toMatchObject({
            sourceType: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            error: { message: 'The Bandcamp track or album could not be found' },
            data: {
                releaseUrl: fansBoughtMusicFeedItem.data.tralbumUrl,
                releaseName: fansBoughtMusicFeedItem.data.tralbumUrl,
                releaseType: 'album',
                fanNames: ['Adam Pitts'],
                about: '',
                links: [],
                unsubscribeUrl: null,
                iframeUrl: null,
                tracks: [],
            },
        })
    })

    it('hydrates older fan purchases that were stored without buyer attribution', () => {
        const oldItem: BandcampFeedItem = {
            ...fansBoughtMusicFeedItem,
            source: {
                type: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
                messageId: 'older-fan-email',
                dateReceived: '2026-10-01T21:40:12Z',
                isRead: false,
                tralbumUrls: [fansBoughtMusicFeedItem.data.tralbumUrl],
            },
        }

        const result = mapBandcampReleaseFeedItemToHydratedFeedItem(oldItem, null, null, null)

        expect(result.sourceType).toBe('EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC')
        expect(result.data.fanNames).toEqual([])
    })

    it('retains new-release email fallbacks, links, artwork, and unsubscribe actions', () => {
        const unsubscribeUrl = 'https://test.bandcamp.com/fan_unsubscribe?id=1'
        const website = 'https://artist.example.com/'
        const newReleaseItem: BandcampFeedItem = {
            ...fansBoughtMusicFeedItem,
            source: {
                ...newReleaseEmail,
                type: 'EMAIL.BANDCAMP_NEW_RELEASE',
                releaseUrl: fansBoughtMusicFeedItem.data.tralbumUrl,
                releaseType: 'album',
                links: [website, website, unsubscribeUrl, 'https://f4.bcbits.com/img/a123_9.jpg'],
            },
        }
        const result = mapBandcampReleaseFeedItemToHydratedFeedItem(
            newReleaseItem,
            null,
            {
                [website]: {
                    url: website,
                    title: 'Artist website',
                    favicon: 'https://artist.example.com/favicon.ico',
                    description: null,
                    image: null,
                },
            },
            null,
        )

        expect(result.sourceType).toBe('EMAIL.BANDCAMP_NEW_RELEASE')
        expect(result.data.releaseName).toBe(newReleaseEmail.subject)
        expect(result.data.about).toContain(
            `<a href="${newReleaseItem.data.tralbumUrl}">Check it out here</a>`,
        )
        expect(result.data.about).toContain(`<a href="${unsubscribeUrl}">Unfollow Test Artist</a>`)
        expect(result.data.links).toEqual([
            { title: 'Artist website', favicon: 'https://artist.example.com/favicon.ico', url: website },
        ])
        expect(result.data.unsubscribeUrl).toBe(unsubscribeUrl)
        expect(result.data.unsubscribeText).toBe('Unfollow Test Artist')
        expect(result.data.imageUrl).toBe('https://f4.bcbits.com/img/a123_16.jpg')
    })

    it.each([
        ['First  ?  Second\t?\t\tThird', 'First<br>Second<br>Third'],
        ['First ? Second', 'First ? Second'],
        ['First  ?   ?  Second', 'First<br><br>Second'],
        [`First${' '.repeat(1000)}Second`, `First${' '.repeat(1000)}Second`],
    ])('preserves email whitespace formatting for %s', (plainBody, expected) => {
        const item: BandcampFeedItem = {
            ...fansBoughtMusicFeedItem,
            source: {
                ...newReleaseEmail,
                plainBody,
                type: 'EMAIL.BANDCAMP_NEW_RELEASE',
                releaseUrl: fansBoughtMusicFeedItem.data.tralbumUrl,
                releaseType: 'album',
                links: [],
            },
        }
        expect(mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null, null).data.about).toBe(expected)
    })
})

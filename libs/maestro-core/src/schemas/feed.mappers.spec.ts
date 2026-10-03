// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared synthetic fixtures live in fixtures/, per docs/testing.md.
import {
    fansBoughtMusicFeedItem,
    newReleaseEmail,
    scrapedBandcampAlbum,
} from '../../../../fixtures/feed.fixture'
import { BandcampFeedItem } from './feed.schema'
import { isUsefulUrlFromBandcampEmail, mapBandcampReleaseFeedItemToHydratedFeedItem } from './feed.mappers'

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
                about: '',
                links: [],
                unsubscribeUrl: null,
                iframeUrl: null,
                tracks: [],
            },
        })
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
        'Unfollow Test Artist',
        'Unsubscribe Test Artist',
        '  Unfollow Test Artist',
        'Details: Unfollow Test Artist',
    ])('recognizes a final %s line without a trailing newline', text => {
        const unsubscribeUrl = 'https://test.bandcamp.com/fan_unsubscribe?id=1'
        const item: BandcampFeedItem = {
            ...fansBoughtMusicFeedItem,
            source: {
                ...newReleaseEmail,
                plainBody: `Release details\r\n${text}`,
                type: 'EMAIL.BANDCAMP_NEW_RELEASE',
                releaseUrl: fansBoughtMusicFeedItem.data.tralbumUrl,
                releaseType: 'album',
                links: [unsubscribeUrl],
            },
        }
        const result = mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null, null)

        const expected = 'Unsubscribe Test Artist' === text ? text : 'Unfollow Test Artist'
        expect(result.data.unsubscribeText).toBe(expected)
        expect(result.data.about).toContain(`<a href="${unsubscribeUrl}">${expected}</a>`)
    })

    it.each([
        'https://f4.bcbits.com.evil.example/img/a123_9.jpg',
        'https://evil.example/f4.bcbits.com/img/a123_9.jpg',
        'https://f4.bcbits.com@evil.example/img/a123_9.jpg',
        'not a URL',
    ])('does not use %s as Bandcamp artwork', link => {
        const item: BandcampFeedItem = {
            ...fansBoughtMusicFeedItem,
            source: {
                ...newReleaseEmail,
                type: 'EMAIL.BANDCAMP_NEW_RELEASE',
                releaseUrl: fansBoughtMusicFeedItem.data.tralbumUrl,
                releaseType: 'album',
                links: [link],
            },
        }
        const result = mapBandcampReleaseFeedItemToHydratedFeedItem(item, null, null, null)

        expect(result.data.imageUrl).toBeUndefined()
        expect(isUsefulUrlFromBandcampEmail(link)).toBe(true)
    })
})

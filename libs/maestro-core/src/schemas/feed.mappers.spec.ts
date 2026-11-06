import { BandcampFeedItem } from './feed.schema'
import { ScrapedTralbumInfo } from './bandcamp-api.schema'
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
    if (source.source.type !== 'EMAIL.BANDCAMP_NEW_RELEASE') throw new Error('Wrong test source')
    source.source.releaseUrl = 'javascript:alert(1)'
    expect(mapBandcampReleaseFeedItemToHydratedFeedItem(source, null, null, null).data.about).toBe(
        'Check it out here',
    )
})

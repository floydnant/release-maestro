import { BandcampFeedItem, ScrapedTralbumInfo } from '@release-maestro/core'

export const bandcampFeedItem = (id: string, eventDate: Date): BandcampFeedItem => ({
    id,
    type: 'BANDCAMP.TRALBUM',
    dedupeIdentifier: `https://test.bandcamp.com/album/${id}`,
    ingestedAt: eventDate,
    eventDate,
    isSnoozed: false,
    lastViewedAt: null,
    data: { tralbumUrl: `https://test.bandcamp.com/album/${id}`, tralbumType: 'album' },
    source: {
        type: 'EMAIL.BANDCAMP_NEW_RELEASE',
        messageId: `<${id}@example.com>`,
        subject: `New release: ${id}`,
        dateReceived: eventDate.toISOString(),
        sender: 'Bandcamp <noreply@bandcamp.com>',
        plainBody: '',
        htmlBody: '',
        isRead: false,
        vendor: 'APPLE_MAIL',
        releaseUrl: `https://test.bandcamp.com/album/${id}`,
        releaseType: 'album',
        links: [],
    },
})

export const scrapedRelease = (streamUrls: (string | null)[]): ScrapedTralbumInfo => ({
    title: 'Test release',
    artist: 'Test artist',
    releaseDate: null,
    type: 'album',
    id: 1,
    artworkUrl: null,
    about: '',
    aboutLinks: [],
    band: null,
    tracks: streamUrls.map((streamUrl, index) => ({
        title: `Track ${index + 1}`,
        id: index + 1,
        artist: null,
        duration: 60,
        titleLink: null,
        albumPreorder: true,
        streamUrl,
    })),
})

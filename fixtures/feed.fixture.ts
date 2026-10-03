import type { BandcampFeedItem, Email, ScrapedTralbumInfo } from '@release-maestro/core'

export const fansBoughtMusicEmail: Email = {
    messageId: '<fan-purchases@bandcamp.com>',
    subject: 'Fans you follow bought new music on Bandcamp',
    dateReceived: '2026-10-01T21:40:12Z',
    sender: 'Bandcamp <noreply@bandcamp.com>',
    plainBody: 'Fans you follow bought First Release and Second Release.',
    htmlBody: `
        <a href="https://test.bandcamp.com/album/first?from=fan">First Release</a>
        <a href="https://test.bandcamp.com/album/first?from=artwork">First Release artwork</a>
        <a href="https://other.bandcamp.com/track/second?from=fan">Second Release</a>
    `,
    isRead: true,
    vendor: 'APPLE_MAIL',
}

export const newReleaseEmail: Email = {
    ...fansBoughtMusicEmail,
    messageId: '<new-release@bandcamp.com>',
    subject: 'New release from Test Artist',
    plainBody: 'Check it out here\n\nUnfollow Test Artist\n',
    htmlBody: '<a href="https://test.bandcamp.com/album/first">check it out here</a>',
    isRead: false,
}

export const fansBoughtMusicFeedItem: BandcampFeedItem = {
    id: 'fan-purchase-album',
    type: 'BANDCAMP.TRALBUM',
    dedupeIdentifier: 'https://test.bandcamp.com/album/first',
    ingestedAt: new Date('2026-10-02T10:00:00Z'),
    eventDate: new Date(fansBoughtMusicEmail.dateReceived),
    isSnoozed: false,
    lastViewedAt: null,
    data: {
        tralbumUrl: 'https://test.bandcamp.com/album/first',
        tralbumType: 'album',
    },
    source: {
        type: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
        messageId: fansBoughtMusicEmail.messageId,
        dateReceived: fansBoughtMusicEmail.dateReceived,
        isRead: fansBoughtMusicEmail.isRead,
        tralbumUrls: ['https://test.bandcamp.com/album/first', 'https://other.bandcamp.com/track/second'],
    },
}

export const scrapedBandcampAlbum: ScrapedTralbumInfo = {
    title: 'First Release',
    artist: 'Test Artist',
    releaseDate: null,
    type: 'album',
    id: 123,
    artworkUrl: 'https://f4.bcbits.com/img/a123_16.jpg',
    about: 'An album bought by a fan.\nreleased October 1, 2026\n',
    aboutLinks: [],
    band: { name: 'Test Artist', imageUrl: null, location: null, bio: null, links: [] },
    tracks: [
        {
            title: 'First Track',
            id: 456,
            artist: 'Test Artist',
            duration: 120,
            titleLink: '/track/first-track',
            albumPreorder: false,
            streamUrl: 'https://audio.example.com/first-track.mp3',
        },
    ],
}

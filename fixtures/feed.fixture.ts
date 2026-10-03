import type { BandcampFeedItem, Email, ScrapedTralbumInfo } from '@release-maestro/core'

export const fansBoughtMusicEmail: Email = {
    messageId: '<fan-purchases@bandcamp.com>',
    subject: 'Fans you follow bought new music on Bandcamp',
    dateReceived: '2026-10-01T21:40:12Z',
    sender: 'Bandcamp <noreply@bandcamp.com>',
    plainBody: 'First Release: Bought by Adam Pitts. Second Release: Bought by Maya and River & Rain.',
    // Reduced Bandcamp email structure, with synthetic releases and fan names.
    htmlBody: `
        <a href="https://bandcamp.com/someone-else">Someone Else</a> and others bought new music.
        <div>
            <a href="https://test.bandcamp.com/album/first?from=artwork"><img alt="First Release artwork"></a>
            <div class="item-tralbum-text">
                <a href="https://test.bandcamp.com/album/first?t=1&amp;from=fanactv-adam">First Release</a>
                <div class="bought-by">
                    Bought by <a href="http://bandcamp.com/adam">Adam Pitts</a>
                    <div class="purchaser-photos"><a href="http://bandcamp.com/adam"><img></a></div>
                </div>
            </div>
        </div>
        <div class="item-tralbum-text">
            <a href="https://other.bandcamp.com/track/second?from=fanactv-maya">Second Release</a>
            <div class="bought-by">
                Bought by <a href="http://bandcamp.com/maya">Maya</a> and
                <a href="http://bandcamp.com/river">River &amp; Rain</a>
                <div class="purchaser-photos">
                    <a href="http://bandcamp.com/maya"><img></a>
                    <a href="http://bandcamp.com/river"><img></a>
                </div>
            </div>
        </div>
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
        purchases: [
            { tralbumUrl: 'https://test.bandcamp.com/album/first', fanNames: ['Adam Pitts'] },
            {
                tralbumUrl: 'https://other.bandcamp.com/track/second',
                fanNames: ['Maya', 'River & Rain'],
            },
        ],
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

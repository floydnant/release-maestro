// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared synthetic fixtures live in fixtures/, per docs/testing.md.
import { fansBoughtMusicEmail, newReleaseEmail } from '../../../../../../fixtures/feed.fixture'
import { parseBandcampEmail } from './bandcamp.email-parser'

describe('parseBandcampEmail', () => {
    it('extracts distinct album and track URLs from fan purchases without tracking queries', () => {
        expect(parseBandcampEmail(fansBoughtMusicEmail)).toMatchObject({
            type: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            messageId: fansBoughtMusicEmail.messageId,
            dateReceived: fansBoughtMusicEmail.dateReceived,
            isRead: true,
            tralbumUrls: ['https://test.bandcamp.com/album/first', 'https://other.bandcamp.com/track/second'],
            purchases: [
                { tralbumUrl: 'https://test.bandcamp.com/album/first', fanNames: ['Adam Pitts'] },
                {
                    tralbumUrl: 'https://other.bandcamp.com/track/second',
                    fanNames: ['Maya', 'River & Rain'],
                },
            ],
        })
    })

    it('combines buyers of repeated releases without duplicating names or assigning other releases buyers', () => {
        const result = parseBandcampEmail({
            ...fansBoughtMusicEmail,
            htmlBody: `${fansBoughtMusicEmail.htmlBody}
                <div class="item-tralbum-text">
                    <a href='https://test.bandcamp.com/album/first?from=fanactv-taylor#artwork'>First Release</a>
                    <div class="bought-by">
                        Bought by <a href="http://bandcamp.com/adam">Adam   Pitts</a> and
                        <a href="http://bandcamp.com/taylor"><span>Taylor</span></a>
                    </div>
                </div>`,
        })

        expect(result).toMatchObject({
            tralbumUrls: ['https://test.bandcamp.com/album/first', 'https://other.bandcamp.com/track/second'],
            purchases: [
                { tralbumUrl: 'https://test.bandcamp.com/album/first', fanNames: ['Adam Pitts', 'Taylor'] },
                {
                    tralbumUrl: 'https://other.bandcamp.com/track/second',
                    fanNames: ['Maya', 'River & Rain'],
                },
            ],
        })
    })

    it('keeps release links when an email has no recognizable buyer section', () => {
        expect(
            parseBandcampEmail({
                ...fansBoughtMusicEmail,
                htmlBody: '<a href="https://test.bandcamp.com/album/first">First Release</a>',
            }),
        ).toMatchObject({ tralbumUrls: ['https://test.bandcamp.com/album/first'], purchases: [] })
    })

    it('continues to recognize a new-release notification', () => {
        expect(parseBandcampEmail(newReleaseEmail)).toMatchObject({
            type: 'EMAIL.BANDCAMP_NEW_RELEASE',
            releaseUrl: 'https://test.bandcamp.com/album/first',
            releaseType: 'album',
        })
    })

    it('ignores unrelated email', () => {
        expect(parseBandcampEmail({ ...fansBoughtMusicEmail, subject: 'Your receipt' })).toBeNull()
    })
})

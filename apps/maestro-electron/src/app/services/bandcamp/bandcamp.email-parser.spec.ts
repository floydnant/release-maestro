// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared synthetic fixtures live in fixtures/, per docs/testing.md.
import {
    adamFan,
    mayaFan,
    riverFan,
    fansBoughtMusicEmail,
    newReleaseEmail,
} from '../../../../../../fixtures/feed.fixture'
import { parseBandcampEmail } from './bandcamp.email-parser'

describe('parseBandcampEmail', () => {
    it('matches photos by fan profile and keeps different fans with the same display name', () => {
        const parsed = parseBandcampEmail({
            ...fansBoughtMusicEmail,
            htmlBody: `<div class="item-tralbum-text">
                <a href="https://test.bandcamp.com/album/first">First release</a>
                <div class="bought-by"><a href="http://bandcamp.com/first-fan">Sam</a> and <a href="https://bandcamp.com/second-fan">Sam</a>
                    <div class="purchaser-photos">
                        <a href="http://bandcamp.com/second-fan"><img src="https://f4.bcbits.com/img/second.jpg"></a>
                        <a href="https://bandcamp.com/first-fan"><img src="https://f4.bcbits.com/img/first.jpg"></a>
                    </div>
                </div>
            </div>`,
        })

        expect(parsed).toMatchObject({
            purchases: [
                {
                    tralbumUrl: 'https://test.bandcamp.com/album/first',
                    fans: [
                        {
                            name: 'Sam',
                            profileUrl: 'https://bandcamp.com/first-fan',
                            imageUrl: 'https://f4.bcbits.com/img/first.jpg',
                        },
                        {
                            name: 'Sam',
                            profileUrl: 'https://bandcamp.com/second-fan',
                            imageUrl: 'https://f4.bcbits.com/img/second.jpg',
                        },
                    ],
                },
            ],
        })
    })

    it('extracts distinct album and track URLs from fan purchases without tracking queries', () => {
        expect(parseBandcampEmail(fansBoughtMusicEmail)).toMatchObject({
            type: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            messageId: fansBoughtMusicEmail.messageId,
            dateReceived: fansBoughtMusicEmail.dateReceived,
            isRead: true,
            purchases: [
                { tralbumUrl: 'https://test.bandcamp.com/album/first', fans: [adamFan] },
                {
                    tralbumUrl: 'https://other.bandcamp.com/track/second',
                    fans: [mayaFan, riverFan],
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
            purchases: [
                {
                    tralbumUrl: 'https://test.bandcamp.com/album/first',
                    fans: [
                        adamFan,
                        { name: 'Taylor', profileUrl: 'https://bandcamp.com/taylor', imageUrl: null },
                    ],
                },
                {
                    tralbumUrl: 'https://other.bandcamp.com/track/second',
                    fans: [mayaFan, riverFan],
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
        ).toMatchObject({ purchases: [{ tralbumUrl: 'https://test.bandcamp.com/album/first', fans: [] }] })
    })

    it('continues to recognize a new-release notification', () => {
        expect(parseBandcampEmail(newReleaseEmail)).toMatchObject({
            type: 'EMAIL.BANDCAMP_NEW_RELEASE',
            releaseUrl: 'https://test.bandcamp.com/album/first',
            releaseType: 'album',
        })
    })

    it('uses the same release URL for new-release and fan-purchase notifications with tracking fragments', () => {
        const url = 'http://test.bandcamp.com/album/first/?from=email#artwork'
        const newRelease = parseBandcampEmail({
            ...newReleaseEmail,
            htmlBody: `<a href="${url}">check it out here</a>`,
        })
        const fanPurchase = parseBandcampEmail({
            ...fansBoughtMusicEmail,
            htmlBody: `<a href="${url}?from=fan">First release</a>`,
        })

        expect(newRelease).toMatchObject({ releaseUrl: 'https://test.bandcamp.com/album/first' })
        expect(fanPurchase).toMatchObject({
            purchases: [{ tralbumUrl: 'https://test.bandcamp.com/album/first' }],
        })
    })

    it('ignores unrelated email', () => {
        expect(parseBandcampEmail({ ...fansBoughtMusicEmail, subject: 'Your receipt' })).toBeNull()
    })
})

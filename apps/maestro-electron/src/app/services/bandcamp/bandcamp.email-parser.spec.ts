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
        })
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

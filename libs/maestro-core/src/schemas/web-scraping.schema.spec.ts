import { loadLinkPreviewsRequestSchema } from './web-scraping.schema'

describe('loadLinkPreviewsRequestSchema', () => {
    it('accepts HTTP and HTTPS links without changing their identities', () => {
        const request = {
            urls: ['https://artist.bandcamp.com/album/release?from=email', 'http://artist.example/music'],
        }
        expect(loadLinkPreviewsRequestSchema.parse(request)).toEqual(request)
        expect(loadLinkPreviewsRequestSchema.parse({ urls: [] })).toEqual({ urls: [] })
    })

    it.each([
        'invalid',
        '/album/release',
        'file:///tmp/release',
        'ftp://artist.example/release',
        'javascript:alert(1)',
        'data:text/html,release',
        42,
    ])('rejects a malformed or unsupported URL in a batch: %s', url => {
        expect(() =>
            loadLinkPreviewsRequestSchema.parse({
                urls: ['https://artist.bandcamp.com/album/release', url],
            }),
        ).toThrow()
    })

    it.each([null, {}, { urls: 'https://artist.example' }])('rejects malformed request data: %s', request => {
        expect(() => loadLinkPreviewsRequestSchema.parse(request)).toThrow()
    })
})

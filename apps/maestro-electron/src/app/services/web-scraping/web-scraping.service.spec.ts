import { BandcampHttpClient } from '../bandcamp/bandcamp-http.client'
import { WebScrapingService } from './web-scraping.service'

describe('WebScrapingService Bandcamp previews', () => {
    afterEach(() => jest.restoreAllMocks())

    it.each(['https://artist.bandcamp.com/album/release', 'https://artist.example/album/release'])(
        'loads the title and favicon for an uncached link: %s',
        async url => {
            const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response(`
                <title>Release | Artist</title>
                <link rel="icon" href="https://f4.bcbits.com/img/favicon/favicon-32x32.png">
            `),
            )
            const service = new WebScrapingService(new BandcampHttpClient())

            await expect(service.getLinkMetaData(url)).resolves.toMatchObject({
                url,
                title: 'Release | Artist',
                favicon: 'https://f4.bcbits.com/img/favicon/favicon-32x32.png',
            })
            expect(fetchMock).toHaveBeenCalledTimes(1)
        },
    )

    it.each([
        ['//f4.bcbits.com/icon.png', 'https://f4.bcbits.com/icon.png'],
        ['/favicon.ico', 'https://artist.bandcamp.com/favicon.ico'],
        ['icon.png', 'https://artist.bandcamp.com/album/icon.png'],
        ['data:image/png;base64,a', 'https://artist.bandcamp.com/favicon.ico'],
        ['javascript:alert(1)', 'https://artist.bandcamp.com/favicon.ico'],
    ])('resolves a favicon URL against the fetched page: %s', async (favicon, expected) => {
        const url = 'https://artist.bandcamp.com/album/release'
        jest.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(`<title>Release</title><link rel="icon" href="${favicon}">`),
        )
        const http = new BandcampHttpClient()
        await http.get(url)

        await expect(new WebScrapingService(http).getLinkMetaData(url)).resolves.toMatchObject({
            title: 'Release',
            favicon: expected,
        })
    })

    it('shares simultaneous lookups and reuses parsed metadata until it expires', async () => {
        const now = jest.spyOn(Date, 'now').mockReturnValue(0)
        const fetchMock = jest
            .spyOn(globalThis, 'fetch')
            .mockResolvedValue(new Response('<title>Artist</title>'))
        const service = new WebScrapingService(new BandcampHttpClient())
        const url = 'https://artist.example/music'
        const first = service.getLinkMetaData(url)
        const second = service.getLinkMetaData(url)
        await expect(Promise.all([first, second])).resolves.toMatchObject([
            { title: 'Artist' },
            { title: 'Artist' },
        ])
        await service.getLinkMetaData(url)
        expect(fetchMock).toHaveBeenCalledTimes(1)

        now.mockReturnValue(60 * 60_000)
        fetchMock.mockResolvedValueOnce(new Response('<title>Updated artist</title>'))
        await expect(service.getLinkMetaData(url)).resolves.toMatchObject({ title: 'Updated artist' })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('does not cache failed lookups', async () => {
        const fetchMock = jest
            .spyOn(globalThis, 'fetch')
            .mockRejectedValueOnce(new Error('Offline'))
            .mockResolvedValueOnce(new Response('<title>Recovered</title>'))
        const service = new WebScrapingService(new BandcampHttpClient())
        const url = 'https://artist.example/music'

        await expect(service.getLinkMetaData(url)).resolves.toMatchObject({ title: null })
        await expect(service.getLinkMetaData(url)).resolves.toMatchObject({ title: 'Recovered' })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('evicts old metadata while retaining recently used previews', async () => {
        const fetchMock = jest
            .spyOn(globalThis, 'fetch')
            .mockImplementation(async () => new Response('<title>Artist</title>'))
        const service = new WebScrapingService(new BandcampHttpClient())
        const urls = Array.from({ length: 501 }, (_, index) => `https://artist.example/${index}`)
        for (const url of urls.slice(0, 500)) await service.getLinkMetaData(url)
        await service.getLinkMetaData('https://artist.example/0')
        await service.getLinkMetaData('https://artist.example/500')
        expect(fetchMock).toHaveBeenCalledTimes(501)
        await service.getLinkMetaData('https://artist.example/0')
        expect(fetchMock).toHaveBeenCalledTimes(501)
        await service.getLinkMetaData('https://artist.example/1')
        expect(fetchMock).toHaveBeenCalledTimes(502)
    })
})

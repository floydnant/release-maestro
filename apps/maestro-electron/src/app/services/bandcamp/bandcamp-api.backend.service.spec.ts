import { load } from 'cheerio'
import { BandcampApiBackendService } from './bandcamp-api.backend.service'

describe('BandcampApiBackendService release links', () => {
    const releaseUrl = 'https://label.bandcamp.com/track/elemento'

    beforeEach(() => {
        const tralbum = {
            album_url: '/album/occultation',
            current: { title: 'Elemento', type: 'track', id: 123 },
            trackinfo: [],
        }
        jest.spyOn(globalThis, 'fetch').mockResolvedValue(
            new Response(`
                <div data-tralbum='${JSON.stringify(tralbum)}'></div>
                <div id="trackInfoInner">
                    <div class="tralbumData tralbum-about">
                        <a href="https://artist.example.com">Artist website</a>
                    </div>
                    <div class="tralbumData tralbum-credits">
                        from <a href="/album/occultation"><em>OCCULTATION</em></a>,
                        <a href="../album/another-release">Another release</a>
                    </div>
                </div>
            `),
        )
    })

    afterEach(() => jest.restoreAllMocks())

    it.each(['/', '/album/', '/track/elemento', null, undefined])(
        'keeps a track without an album when album_url is %s',
        async albumUrl => {
            jest.spyOn(globalThis, 'fetch').mockResolvedValue(
                new Response(
                    `<div data-tralbum='${JSON.stringify({
                        album_url: albumUrl,
                        current: { title: 'Elemento', type: 'track', id: 123 },
                        trackinfo: [],
                    })}'></div>`,
                ),
            )

            const result = await new BandcampApiBackendService().scrapeTralbumInfo(releaseUrl)
            expect(result.parentAlbumUrl).toBeNull()
            expect(result.type).toBe('track')
        },
    )

    it('opens the parent album from the track credits on Bandcamp', async () => {
        const result = await new BandcampApiBackendService().scrapeTralbumInfo(releaseUrl)
        const $ = load(result.about)
        const parentAlbum = $('a').filter((_, link) => $(link).text() === 'OCCULTATION')

        expect(parentAlbum.attr('href')).toBe('https://label.bandcamp.com/album/occultation')
        expect(result.parentAlbumUrl).toBe('https://label.bandcamp.com/album/occultation')
        expect(parentAlbum.attr('target')).toBe('_blank')
        expect(parentAlbum.attr('rel')).toBe('noopener noreferrer')
        expect(parentAlbum.find('em').text()).toBe('OCCULTATION')
        expect(result.aboutLinks).toContainEqual({
            url: 'https://label.bandcamp.com/album/occultation',
            text: 'OCCULTATION',
        })
    })

    it('keeps absolute links and resolves other relative credits links against the release page', async () => {
        const result = await new BandcampApiBackendService().scrapeTralbumInfo(releaseUrl)
        const $ = load(result.about)

        expect(
            $('a')
                .map((_, link) => $(link).attr('href'))
                .get(),
        ).toEqual([
            'https://artist.example.com/',
            'https://label.bandcamp.com/album/occultation',
            'https://label.bandcamp.com/album/another-release',
        ])
        for (const link of $('a').toArray()) {
            expect($(link).attr('target')).toBe('_blank')
            expect($(link).attr('rel')).toBe('noopener noreferrer')
        }
    })
})

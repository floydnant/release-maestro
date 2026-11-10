import { createServer } from 'node:http'
import { BandcampApiBackendService } from './bandcamp-api.backend.service'
import {
    BandcampApiFailedToFetchTralbumException,
    BandcampApiMalformedTralbumDataException,
} from './bandcamp-api.exceptions'

const releaseData = {
    current: { title: 'Night Signals', artist: 'Test Artist', type: 'album', id: 42 },
    album_release_date: '03 Nov 2026 00:00:00 GMT',
    trackinfo: [
        {
            title: 'First Light',
            duration: 180,
            id: 43,
            title_link: '/track/first-light',
            album_preorder: false,
            file: { 'mp3-128': 'https://audio.example/first-light.mp3' },
        },
    ],
}

const releaseHtml = `
    <script data-tralbum="${JSON.stringify(releaseData).replaceAll('"', '&quot;')}"></script>
    <div id="tralbumArt"><img src="https://images.example/cover.jpg"></div>
    <div id="bio-container">
        <img src="https://images.example/artist.jpg">
        <div id="band-name-location"><span class="title">Test Artist</span><span class="location">Berlin</span></div>
        <div id="bio-text">Artist biography</div>
        <div id="band-links"><a href="https://artist.example">Website</a></div>
    </div>
    <div id="trackInfoInner">
        <div class="tralbumData tralbum-about">About <a href="https://label.example">the label</a></div>
    </div>
`

describe('BandcampApiBackendService HTTP hydration', () => {
    const service = new BandcampApiBackendService()
    const server = createServer((request, response) => {
        response.setHeader('Content-Type', 'text/html')
        if (request.url === '/album/night-signals') {
            response.end(releaseHtml)
        } else if (request.url === '/album/malformed') {
            response.end('<script data-tralbum="{}"></script>')
        } else {
            response.writeHead(429).end('Too Many Requests')
        }
    })
    let origin: string

    beforeAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.once('error', reject)
            server.listen(0, '127.0.0.1', resolve)
        })
        const address = server.address()
        if (!address || typeof address === 'string') throw new Error('Expected an HTTP server address')
        origin = `http://127.0.0.1:${address.port}`
    })

    afterAll(async () => {
        await new Promise<void>((resolve, reject) => {
            server.close(error => (error ? reject(error) : resolve()))
        })
    })

    it('hydrates release metadata and playable tracks through fetch without a browser', async () => {
        const release = await service.scrapeTralbumInfo(`${origin}/album/night-signals`)

        expect(release).toMatchObject({
            title: 'Night Signals',
            artist: 'Test Artist',
            releaseDate: '2026-11-03',
            type: 'album',
            id: 42,
            artworkUrl: 'https://images.example/cover.jpg',
            band: {
                name: 'Test Artist',
                location: 'Berlin',
                bio: 'Artist biography',
                links: [{ url: 'https://artist.example', text: 'Website' }],
            },
            tracks: [
                {
                    title: 'First Light',
                    duration: 180,
                    streamUrl: 'https://audio.example/first-light.mp3',
                },
            ],
        })
        expect(release.about).toContain('target="_blank" rel="noopener noreferrer"')
        expect(release.aboutLinks).toEqual([{ url: 'https://label.example', text: 'the label' }])
    })

    it('reports malformed Bandcamp data as a hydration error', async () => {
        await expect(service.scrapeTralbumInfo(`${origin}/album/malformed`)).rejects.toBeInstanceOf(
            BandcampApiMalformedTralbumDataException,
        )
    })

    it('reports rate limits without attempting browser cookie retrieval', async () => {
        const url = `${origin}/album/rate-limited`
        await expect(service.scrapeTralbumInfo(url)).rejects.toEqual(
            new BandcampApiFailedToFetchTralbumException(url, 429),
        )
    })
})

import bandcampFetch, { Album, Artist, Label, Track } from 'bandcamp-fetch'
import { load as cheerioLoad } from 'cheerio'

export type ScrapedBandcampData = {
    artworkUrl: string
    about: string
    aboutLinks: { url: string; text: string }[]
}

export class BandcampApiBackendService {
    async getAlbum(url: string): Promise<Album> {
        return await bandcampFetch.album.getInfo({ albumUrl: url })
    }

    async getTrack(url: string): Promise<Track> {
        return await bandcampFetch.track.getInfo({ trackUrl: url })
    }

    async getBand(url: string): Promise<Label | Artist> {
        return await bandcampFetch.band.getInfo({ bandUrl: url })
    }

    async getRelease(url: string): Promise<Album | Track> {
        const isTrack = url.includes('/track/')
        if (isTrack) {
            return await bandcampFetch.track.getInfo({ trackUrl: url })
        }
        return await bandcampFetch.album.getInfo({ albumUrl: url })
    }

    async scrapeRelease(url: string): Promise<ScrapedBandcampData> {
        const result = await fetch(url)
        if (!result.ok) {
            throw new Error(
                `Failed to fetch release from Bandcamp: ${result.statusText}, ${JSON.stringify(result.json(), null, 2)}`,
            )
        }
        const html = await result.text()
        const $ = cheerioLoad(html)
        const artworkUrl = $('#tralbumArt > a > img').attr('src') || ''

        let about = $('#trackInfoInner > div.tralbumData.tralbum-about').html() || ''
        const aboutLinks = $('#trackInfoInner > div.tralbumData.tralbum-about a')
            .toArray()
            .map(link => ({ url: $(link).attr('href') || '', text: $(link).text().trim() }))
        let credits = $('#trackInfoInner > div.tralbumData.tralbum-credits').html() || ''
        const creditsLinks = $('#trackInfoInner > div.tralbumData.tralbum-credits a')
            .toArray()
            .map(link => ({ url: $(link).attr('href') || '', text: $(link).text().trim() }))

        // Ensure links open in a new tab
        $('#trackInfoInner > div.tralbumData a')
            .toArray()
            .forEach(link => {
                const cheerioLink = $(link)
                const originalHtml = cheerioLink.prop('outerHTML')
                cheerioLink.attr('target', '_blank')
                cheerioLink.attr('rel', 'noopener noreferrer')
                const fixedHtml = cheerioLink.prop('outerHTML')

                if (!originalHtml || !fixedHtml) return

                about = about.replace(originalHtml, fixedHtml)
            })

        // @TODO: we could scrape the collectors info too (people supporting the release)

        return {
            artworkUrl,
            about: about + credits,
            aboutLinks: [...aboutLinks, ...creditsLinks],
        }
    }
}

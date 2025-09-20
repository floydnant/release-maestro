import bandcampFetch, { Artist, Label } from 'bandcamp-fetch'
import { CheerioAPI, load as cheerioLoad } from 'cheerio'
import { FetchFailedException } from '@release-maestro/core'
import {
    BandcampApiFailedToFetchTralbumException,
    BandcampApiMalformedTralbumDataException,
} from './bandcamp-api.exceptions'
import {
    AttributeTralbumData,
    tralbumDataAttrSchema,
    ScrapedTralbumInfo,
    BandData,
} from '../../libs/maestro-core/src/schemas/bandcamp-api.schema'

const parseTralbumData = ($: CheerioAPI): AttributeTralbumData => {
    const tralbumJson = $('[data-tralbum]').attr('data-tralbum')
    if (!tralbumJson) throw new Error('No tralbum data found')

    const parsed = JSON.parse(tralbumJson)
    return tralbumDataAttrSchema.parse(parsed)
}

const parseBandData = ($: CheerioAPI): BandData | null => {
    const bandImageUrl = $('#bio-container img').attr('src')
    const bandName = $('#bio-container #band-name-location .title').text()
    const bandLocation = $('#bio-container #band-name-location .location').text()
    const bandBioText =
        $('#bio-container #bio-text').contents().first().text() +
        $('#bio-container #bio-text .peekaboo-text').text()
    // @TODO: the recommended link could prove useful for crawling the network of labels/artists in the future
    const bandLinks = $('#bio-container #band-links a, #bio-container #recommended a')
        .map((_, link) => {
            const cheerioLink = $(link)
            return {
                url: cheerioLink.attr('href') || '',
                text: cheerioLink.text().trim(),
            }
        })
        .get()

    return {
        name: bandName,
        imageUrl: bandImageUrl || null,
        location: bandLocation || null,
        bio: bandBioText || null,
        links: bandLinks,
    }
}

export class BandcampApiBackendService {
    async getBand(url: string): Promise<Label | Artist> {
        return await bandcampFetch.band.getInfo({ bandUrl: url })
    }

    async scrapeTralbumInfo(url: string): Promise<ScrapedTralbumInfo> {
        const result = await fetch(url).catch(err => {
            if (err instanceof Error) {
                throw new FetchFailedException(
                    'Failed to fetch tralbum',
                    url,
                    err,
                    'Check your internet connection and retry.',
                )
            }
            throw err
        })
        if (!result.ok) {
            throw new BandcampApiFailedToFetchTralbumException(url, result.status)
        }

        const html = await result.text()
        const $ = cheerioLoad(html)

        const artworkUrl = $('#tralbumArt img').attr('src') || null
        let tralbumData: AttributeTralbumData | null = null
        try {
            tralbumData = parseTralbumData($)
        } catch (err) {
            if (err instanceof Error) {
                throw new BandcampApiMalformedTralbumDataException(url, err)
            }
            throw err
        }
        const bandData = parseBandData($)

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
            title: tralbumData?.current.title || null,
            artist: tralbumData?.current.artist || null,
            releaseDate: tralbumData?.album_release_date || tralbumData?.current.release_date || null,
            type: tralbumData?.current.type || 'album',
            id: tralbumData?.current.id || null,
            about: about + credits,
            aboutLinks: [...aboutLinks, ...creditsLinks],
            band: bandData
                ? {
                      name: bandData.name,
                      imageUrl: bandData.imageUrl,
                      location: bandData.location,
                      bio: bandData.bio,
                      links: bandData.links,
                  }
                : null,
            tracks:
                tralbumData?.trackinfo.map(track => ({
                    title: track.title,
                    id: track.id || null,
                    artist: track.artist || null,
                    duration: track.duration,
                    titleLink: track.title_link || null,
                    albumPreorder: track.album_preorder,
                    streamUrl: track.file ? track.file['mp3-128'] : null,
                })) || [],
        }
    }
}

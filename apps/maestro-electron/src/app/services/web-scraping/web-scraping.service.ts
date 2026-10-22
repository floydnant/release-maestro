import { load as cheerioLoad } from 'cheerio'
import { ScrapedLinkMetadata } from '@release-maestro/core'
import { BandcampHttpClient } from '../bandcamp/bandcamp-http.client'

const METADATA_CACHE_MS = 60 * 60_000
const MAX_CACHED_PREVIEWS = 500

/** Shares pending lookups and caches parsed previews without retaining their HTML. Failures can retry. */
export class WebScrapingService {
    private readonly pending = new Map<string, Promise<ScrapedLinkMetadata>>()
    private readonly previews = new Map<string, { metadata: ScrapedLinkMetadata; expiresAt: number }>()

    constructor(private readonly bandcampHttp: BandcampHttpClient) {}

    getLinkMetaData(url: string): Promise<ScrapedLinkMetadata> {
        const cached = this.previews.get(url)
        if (cached && cached.expiresAt > Date.now()) {
            this.previews.delete(url)
            this.previews.set(url, cached)
            return Promise.resolve(cached.metadata)
        }
        this.previews.delete(url)
        const pending = this.pending.get(url)
        if (pending) return pending

        const request = this.scrapeLinkMetadata(url)
            .then(metadata => {
                this.previews.set(url, { metadata, expiresAt: Date.now() + METADATA_CACHE_MS })
                if (this.previews.size > MAX_CACHED_PREVIEWS) {
                    const oldest = this.previews.keys().next().value
                    if (oldest !== undefined) this.previews.delete(oldest)
                }
                return metadata
            })
            .catch(() => ({
                url,
                title: null,
                description: null,
                image: null,
                favicon: 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname,
            }))
            .finally(() => this.pending.delete(url))
        this.pending.set(url, request)
        return request
    }

    private async scrapeLinkMetadata(url: string): Promise<ScrapedLinkMetadata> {
        const page = await this.bandcampHttp.get(url, { purpose: 'preview' })
        const $ = cheerioLoad(page.html)

        // @TODO: make this more resilient/add more fallbacks
        const title = $('title').text() || null
        const description = $('meta[name="description"]').attr('content') || null
        const image = $('meta[property="og:image"]').attr('content') || null

        // Try multiple favicon selectors
        const faviconSelectors = [
            'link[rel="icon"]',
            'link[rel="shortcut icon"]',
            'link[rel="apple-touch-icon"]',
            'link[rel="apple-touch-icon-precomposed"]',
            'link[rel="fluid-icon"]',
            'link[rel="mask-icon"]',
        ]
        let favicon = null
        for (const selector of faviconSelectors) {
            favicon = $(selector).attr('href')
            if (favicon) break
        }

        const parsedFavicon = URL.parse(favicon || '/favicon.ico', page.url)
        const fullFavicon =
            parsedFavicon && ['https:', 'http:'].includes(parsedFavicon.protocol)
                ? parsedFavicon.href
                : new URL('/favicon.ico', page.url).href

        return { url, title, description, image, favicon: fullFavicon }
    }

    async getLinkMetaDataBatch(urls: string[]): Promise<Record<string, ScrapedLinkMetadata>> {
        const results: Record<string, ScrapedLinkMetadata> = {}
        const fetchPromises = urls.map(async url => {
            results[url] = await this.getLinkMetaData(url)
        })
        await Promise.all(fetchPromises)
        return results
    }
}

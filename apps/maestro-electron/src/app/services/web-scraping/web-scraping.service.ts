import { load as cheerioLoad } from 'cheerio'
import { ScrapedLinkMetadata } from '@release-maestro/core'

export class WebScrapingService {
    async getLinkMetaData(url: string): Promise<ScrapedLinkMetadata> {
        try {
            // @TODO: cache this
            const res = await fetch(url, { signal: AbortSignal.timeout(5000) })
            const html = await res.text()
            const $ = cheerioLoad(html)

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

            // Fallback to default favicon if none found
            favicon = favicon || '/favicon.ico'

            // Ensure favicon is either a full URL or starts with exactly one slash
            if (favicon && !favicon.startsWith('http')) {
                // Remove leading slashes and add exactly one
                favicon = '/' + favicon.replace(/^\/+/, '')
            }

            // @TODO: we could test if the favicon url returns a 200, but we can also fallback to a default in the UI
            const fullFavicon = favicon.startsWith('http') ? favicon : new URL(favicon, url).href

            return { url, title, description, image, favicon: fullFavicon }
        } catch {
            return {
                url,
                title: null,
                description: null,
                image: null,
                favicon: 'https://www.google.com/s2/favicons?domain=' + new URL(url).hostname,
            }
        }
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
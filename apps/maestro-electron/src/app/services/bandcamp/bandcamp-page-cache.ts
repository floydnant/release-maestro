import { normalizeBandcampReleaseUrl } from '@release-maestro/core'
import { BandcampRequestPurpose } from './bandcamp-request-gate'

const PAGE_CACHE_MS = 5 * 60_000
const MAX_CACHED_PAGES = 20
const MAX_CACHED_HTML_BYTES = 8 * 1024 * 1024

export type Page = { readonly url: string; readonly html: string }

/** Who a cached page was fetched for. Previews are never cached as pages. */
type PageOwner = Exclude<BandcampRequestPurpose, 'preview'>

type CachedPage = { page: Page; expiresAt: number; bytes: number; owner: PageOwner }

/** Release URLs share one entry across HTTP, tracking queries and trailing slashes. */
const cacheKey = (url: string): string => {
    const parsed = new URL(url)
    parsed.hash = ''
    return /^\/(album|track)\/[^/]+\/?$/.test(parsed.pathname)
        ? (normalizeBandcampReleaseUrl(url) ?? parsed.href)
        : parsed.href
}

/**
 * Bandcamp pages kept for five minutes, so Retry, previews and imports can reuse a recent fetch.
 *
 * Bounded to 20 pages and 8 MiB of UTF-16 HTML; a larger page is served but not kept. Pages the feed
 * used outrank import pages: imports are evicted first, and an import response can neither evict
 * nor replace a feed page, even one that finished after the feed's.
 */
export class BandcampPageCache {
    private readonly entries = new Map<string, CachedPage>()
    private bytes = 0

    /** The fresh page for this URL, if any. A feed hit makes the page the feed's. */
    get(url: string, purpose: BandcampRequestPurpose): Page | null {
        const key = cacheKey(url)
        const cached = this.entries.get(key)
        if (cached && cached.expiresAt > Date.now()) {
            if (purpose === 'feed') cached.owner = 'feed'
            return cached.page
        }
        this.forget(key)
        return null
    }

    store(url: string, page: Page, owner: PageOwner): void {
        const bytes = page.html.length * 2
        if (bytes > MAX_CACHED_HTML_BYTES) return
        const key = cacheKey(url)
        if (owner === 'import' && this.entries.get(key)?.owner === 'feed') return
        this.forget(key)
        while (this.entries.size >= MAX_CACHED_PAGES || this.bytes + bytes > MAX_CACHED_HTML_BYTES) {
            const evicted =
                [...this.entries].find(([, entry]) => entry.owner === 'import')?.[0] ??
                (owner === 'feed' ? this.entries.keys().next().value : undefined)
            // Only feed pages are left, and an import may not evict them.
            if (evicted === undefined) return
            this.forget(evicted)
        }
        this.entries.set(key, { page, expiresAt: Date.now() + PAGE_CACHE_MS, bytes, owner })
        this.bytes += bytes
    }

    /** Drops a page its consumer rejected, so Retry fetches it again. A newer response stays. */
    discard(page: Page): void {
        for (const [key, cached] of this.entries) {
            if (cached.page === page) this.forget(key)
        }
    }

    private forget(key: string): void {
        const cached = this.entries.get(key)
        if (cached) this.bytes -= cached.bytes
        this.entries.delete(key)
    }
}

import { FetchFailedException, normalizeBandcampReleaseUrl } from '@release-maestro/core'
import {
    BandcampApiException,
    BandcampApiFailedToFetchTralbumException,
    BandcampApiRateLimitedException,
} from './bandcamp-api.exceptions'

// Conservative app-wide pacing, not a published Bandcamp quota.
const REQUEST_INTERVAL_MS = 1000
const RATE_LIMIT_BACKOFF_MS = 30_000
const MAX_RATE_LIMIT_BACKOFF_MS = 5 * 60_000
const MAX_IMPORT_WAIT_MS = 60_000
const MAX_RATE_LIMIT_RETRIES = 2
const REQUEST_TIMEOUT_MS = 15_000
const PREVIEW_TIMEOUT_MS = 5000
const PAGE_CACHE_MS = 5 * 60_000
const MAX_CACHED_PAGES = 20
const MAX_CACHED_HTML_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 10

type Page = { readonly url: string; readonly html: string }
type PageResult = { kind: 'page'; page: Page } | { kind: 'redirect'; url: string } | { kind: 'cooldown' }
export type BandcampRequestPurpose = 'import' | 'feed' | 'preview'

const isBandcampHostname = (hostname: string): boolean => {
    return hostname === 'bandcamp.com' || hostname.endsWith('.bandcamp.com')
}

const pageCacheKey = (url: string): string => {
    const parsed = new URL(url)
    parsed.hash = ''
    return /^\/(album|track)\/[^/]+\/?$/.test(parsed.pathname)
        ? (normalizeBandcampReleaseUrl(url) ?? parsed.href)
        : parsed.href
}

const abortable = async <T>(promise: Promise<T>, signal: AbortSignal): Promise<T> => {
    signal.throwIfAborted()
    let onAbort = () => {}
    const aborted = new Promise<never>((_resolve, reject) => {
        onAbort = () => reject(signal.reason)
        signal.addEventListener('abort', onAbort, { once: true })
    })
    try {
        return await Promise.race([promise, aborted])
    } finally {
        signal.removeEventListener('abort', onAbort)
    }
}

const wait = async (delay: number, signal: AbortSignal): Promise<void> => {
    let timeout: ReturnType<typeof setTimeout> | undefined
    try {
        await abortable(new Promise<void>(resolve => (timeout = setTimeout(resolve, delay))), signal)
    } finally {
        clearTimeout(timeout)
    }
}

const retryAfterDelay = (header: string | null): number | null => {
    if (header === null) return null
    const value = header.trim()
    if (/^\d+$/.test(value)) {
        const seconds = Number(value)
        return Number.isSafeInteger(seconds) ? seconds * 1000 : null
    }
    // Reject numeric values such as -1 or 1.5 that Date.parse would treat as dates.
    if (!/^[A-Za-z]/.test(value)) return null
    const timestamp = Date.parse(value)
    return Number.isFinite(timestamp) ? Math.max(0, timestamp - Date.now()) : null
}

/**
 * Routes web pages and every redirect. Known Bandcamp requests share one gate.
 * Feed and import callers identify known Bandcamp releases, including custom domains. Their
 * redirects retain that ownership. Preview callers use Bandcamp hostnames and learned custom domains.
 * Imports may wait through cooldowns; the interactive feed and previews fail fast. Bandcamp previews
 * enter the shared gate one at a time, so at most one can queue ahead of release metadata. Other websites retain
 * a five-second budget across redirects. Unknown custom domains remain outside sites until a
 * release lookup identifies them as Bandcamp.
 *
 * Bandcamp requests start one second apart, including body reads in a 15-second timeout.
 * Imports retry 429 twice and wait at most a minute per cooldown. Successful Bandcamp release HTML stays
 * cached for five minutes, bounded by 20 pages and 8 MiB measured as UTF-16 strings.
 */
export class BandcampHttpClient {
    private queue: Promise<void> = Promise.resolve()
    private previewQueue: Promise<void> = Promise.resolve()
    private nextRequestAt = 0
    private cooldownUntil = 0
    private consecutiveRateLimits = 0
    private pages = new Map<string, { page: Page; expiresAt: number; bytes: number }>()
    private cachedHtmlBytes = 0
    private knownBandcampHosts = new Set<string>()

    async get(
        url: string,
        { signal, purpose = 'feed' }: { signal?: AbortSignal; purpose?: BandcampRequestPurpose } = {},
    ): Promise<Page> {
        signal?.throwIfAborted()
        const originalUrl = url
        const callerSignal = signal ?? AbortSignal.any([])
        const previewDeadline = purpose === 'preview' ? AbortSignal.timeout(PREVIEW_TIMEOUT_MS) : null
        let retries = purpose === 'import' ? MAX_RATE_LIMIT_RETRIES : 0
        let redirects = 0
        let bandcamp = purpose !== 'preview'
        for (;;) {
            callerSignal.throwIfAborted()
            const cached = this.cachedPage(url)
            if (cached) return cached
            const hostname = new URL(url).hostname
            bandcamp ||= isBandcampHostname(hostname) || this.knownBandcampHosts.has(hostname)
            if (bandcamp && !isBandcampHostname(hostname)) this.knownBandcampHosts.add(hostname)
            const requestSignal =
                !bandcamp && previewDeadline ? AbortSignal.any([callerSignal, previewDeadline]) : callerSignal
            requestSignal.throwIfAborted()
            if (bandcamp && this.cooldownUntil > Date.now()) {
                const delay = this.cooldownUntil - Date.now()
                if (purpose !== 'import' || delay > MAX_IMPORT_WAIT_MS)
                    throw new BandcampApiRateLimitedException(url, new Date(this.cooldownUntil))
                // A background cooldown must not occupy the queue while the feed fails fast.
                await wait(delay, requestSignal)
                continue
            }
            let result: PageResult
            try {
                if (bandcamp) {
                    const request = this.queueBandcampPage(url, requestSignal, purpose)
                    result = await abortable(request, requestSignal)
                } else {
                    result = await this.fetchPage(url, requestSignal, false)
                }
            } catch (error) {
                if (error instanceof BandcampApiRateLimitedException && retries-- > 0) continue
                throw error
            }
            if (result.kind === 'cooldown') continue
            if (result.kind === 'page') return result.page
            if (++redirects > MAX_REDIRECTS)
                throw new Error(
                    `Too many page redirects for ${originalUrl} (last redirect: ${url} -> ${result.url})`,
                )
            url = result.url
        }
    }

    private queueBandcampPage(
        url: string,
        signal: AbortSignal,
        purpose: BandcampRequestPurpose,
    ): Promise<PageResult> {
        const enqueue = () => {
            const request = this.queue.then(() =>
                this.requestBandcampPage(url, signal, purpose !== 'preview'),
            )
            // A failed or cancelled caller must not poison either queue.
            this.queue = request.then(
                () => undefined,
                () => undefined,
            )
            return request
        }
        if (purpose !== 'preview') return enqueue()
        const request = this.previewQueue.then(enqueue)
        this.previewQueue = request.then(
            () => undefined,
            () => undefined,
        )
        return request
    }

    private cachedPage(url: string): Page | null {
        const key = pageCacheKey(url)
        const cached = this.pages.get(key)
        if (cached && cached.expiresAt > Date.now()) return cached.page
        this.forgetPage(key)
        return null
    }

    private forgetPage(key: string): void {
        const cached = this.pages.get(key)
        if (cached) this.cachedHtmlBytes -= cached.bytes
        this.pages.delete(key)
    }

    private cachePage(url: string, page: Page): void {
        const bytes = page.html.length * 2
        if (bytes > MAX_CACHED_HTML_BYTES) return
        const key = pageCacheKey(url)
        this.forgetPage(key)
        while (this.pages.size >= MAX_CACHED_PAGES || this.cachedHtmlBytes + bytes > MAX_CACHED_HTML_BYTES) {
            const oldest = this.pages.keys().next().value
            if (oldest === undefined) break
            this.forgetPage(oldest)
        }
        this.pages.set(key, { page, expiresAt: Date.now() + PAGE_CACHE_MS, bytes })
        this.cachedHtmlBytes += bytes
    }

    private async requestBandcampPage(
        url: string,
        signal: AbortSignal,
        retainPage: boolean,
    ): Promise<PageResult> {
        signal.throwIfAborted()
        // A queued lookup can reuse a page that another caller just fetched.
        const cached = this.cachedPage(url)
        if (cached) return { kind: 'page', page: cached }
        if (this.cooldownUntil > Date.now()) return { kind: 'cooldown' }
        const delay = this.nextRequestAt - Date.now()
        if (delay > 0) await wait(delay, signal)
        signal.throwIfAborted()
        this.nextRequestAt = Date.now() + REQUEST_INTERVAL_MS
        return this.fetchPage(url, signal, true, retainPage)
    }

    private async fetchPage(
        url: string,
        signal: AbortSignal,
        bandcamp: boolean,
        retainPage = false,
    ): Promise<PageResult> {
        const requestSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(bandcamp ? REQUEST_TIMEOUT_MS : PREVIEW_TIMEOUT_MS),
        ])
        let response: Response | undefined
        try {
            response = await fetch(url, { signal: requestSignal, redirect: 'manual' })
            if (bandcamp && response.status === 429) {
                const backoff = Math.min(
                    RATE_LIMIT_BACKOFF_MS * 2 ** this.consecutiveRateLimits++,
                    MAX_RATE_LIMIT_BACKOFF_MS,
                )
                const delay = retryAfterDelay(response.headers.get('Retry-After')) ?? backoff
                this.cooldownUntil = Math.max(this.cooldownUntil, Date.now() + delay)
                throw new BandcampApiRateLimitedException(url, new Date(this.cooldownUntil))
            }
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('Location')
                const destination = location ? URL.parse(location, url) : null
                if (!destination || !['http:', 'https:'].includes(destination.protocol))
                    throw new Error('Invalid page redirect')
                return { kind: 'redirect', url: destination.href }
            }
            if (!response.ok) throw new BandcampApiFailedToFetchTralbumException(url, response.status)
            const page = { url: response.url || url, html: await response.text() }
            if (bandcamp) {
                if (retainPage) this.cachePage(url, page)
                this.consecutiveRateLimits = 0
            }
            return { kind: 'page', page }
        } catch (error) {
            signal.throwIfAborted()
            if (error instanceof BandcampApiException) throw error
            if (error instanceof Error || error instanceof DOMException)
                throw new FetchFailedException(
                    'Failed to fetch page',
                    url,
                    error,
                    'Check your internet connection and retry.',
                )
            throw error
        } finally {
            // Consume successful bodies above; release rejected and redirected bodies here.
            if (response && !response.bodyUsed) await response.body?.cancel().catch(() => {})
        }
    }
}

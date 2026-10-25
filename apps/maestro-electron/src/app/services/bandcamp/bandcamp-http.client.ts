import { FetchFailedException, normalizeBandcampReleaseUrl } from '@release-maestro/core'
import {
    BandcampApiException,
    BandcampApiFailedToFetchTralbumException,
    BandcampApiRateLimitedException,
    BandcampApiRedirectException,
} from './bandcamp-api.exceptions'
import { BandcampRequestGate, BandcampRequestPurpose } from './bandcamp-request-gate'
import { BandcampRequestDetails, BandcampRequestJournal } from './bandcamp-request-journal'
export type { BandcampRequestPurpose } from './bandcamp-request-gate'

const REQUEST_TIMEOUT_MS = 15_000
const PREVIEW_TIMEOUT_MS = 5000
const PAGE_CACHE_MS = 5 * 60_000
const MAX_CACHED_PAGES = 20
const MAX_CACHED_HTML_BYTES = 8 * 1024 * 1024
const MAX_REDIRECTS = 10

type Page = { readonly url: string; readonly html: string }
type PageRequest = BandcampRequestDetails & { signal: AbortSignal }
type PageResult = { kind: 'page'; page: Page } | { kind: 'redirect'; url: string } | { kind: 'cooldown' }

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
 * Routes every page and redirect through one admission gate. Feed requests reserve foreground
 * capacity for their whole chain; imports and previews yield, including between scroll loads.
 * Background admission and recovery belong to BandcampRequestGate. Background work waits cancellably
 * through cooldowns. Foreground requests never queue behind background bodies; existing background
 * bodies may overlap foreground loads. The bounded local request journal measures the gate's policies.
 * Each Bandcamp body has a 15-second timeout. Other sites share a five-second redirect budget.
 * Successful release HTML stays for five minutes, bounded by 20 pages and 8 MiB of UTF-16 strings.
 * Imports cannot evict feed pages. Tracking queries, cookie values and email data never enter the journal.
 */
export class BandcampHttpClient {
    private pages = new Map<
        string,
        { page: Page; expiresAt: number; bytes: number; purpose: 'feed' | 'import' }
    >()
    private cachedHtmlBytes = 0
    private knownBandcampHosts = new Set<string>()
    private nextChainId = 1

    constructor(
        private readonly gate = new BandcampRequestGate(),
        private readonly journal = new BandcampRequestJournal(),
    ) {}

    holdFeedPriority(): () => void {
        return this.gate.holdForeground()
    }

    async get(
        url: string,
        { signal, purpose = 'feed' }: { signal?: AbortSignal; purpose?: BandcampRequestPurpose } = {},
    ): Promise<Page> {
        const release = purpose === 'feed' ? this.gate.holdForeground() : () => {}
        try {
            return await this.getPage(url, signal, purpose)
        } finally {
            release()
        }
    }

    private async getPage(
        url: string,
        signal: AbortSignal | undefined,
        purpose: BandcampRequestPurpose,
    ): Promise<Page> {
        signal?.throwIfAborted()
        const originalUrl = url
        const chainId = this.nextChainId++
        const initial = new URL(url)
        initial.hash = ''
        const visited = new Set([initial.href])
        const callerSignal = signal ?? AbortSignal.any([])
        const previewDeadline = purpose === 'preview' ? AbortSignal.timeout(PREVIEW_TIMEOUT_MS) : null
        let redirects = 0
        let bandcamp = purpose !== 'preview'
        for (;;) {
            callerSignal.throwIfAborted()
            const cached = this.cachedPage(url, purpose)
            if (cached) return cached
            const hostname = new URL(url).hostname
            bandcamp ||= isBandcampHostname(hostname) || this.knownBandcampHosts.has(hostname)
            if (bandcamp && !isBandcampHostname(hostname)) this.knownBandcampHosts.add(hostname)
            const requestSignal =
                !bandcamp && previewDeadline ? AbortSignal.any([callerSignal, previewDeadline]) : callerSignal
            requestSignal.throwIfAborted()
            const request: PageRequest = {
                url,
                signal: requestSignal,
                purpose,
                queuedAt: Date.now(),
                chainId,
                hop: redirects,
            }
            let result: PageResult
            if (bandcamp) {
                try {
                    result = await abortable(this.requestBandcampPage(request), requestSignal)
                } catch (error) {
                    if (purpose === 'import' && error instanceof BandcampApiRateLimitedException) continue
                    throw error
                }
            } else {
                result = await this.fetchPage(request, false)
            }
            if (result.kind === 'cooldown') {
                if (purpose === 'import') continue
                throw new BandcampApiRateLimitedException(url, new Date(this.gate.state.cooldownUntil))
            }
            if (result.kind === 'page') return result.page
            const redirected = new URL(result.url)
            redirected.hash = ''
            if (visited.has(redirected.href))
                throw new BandcampApiRedirectException(
                    originalUrl,
                    `Page redirect loop for ${originalUrl} (last redirect: ${url} -> ${result.url})`,
                )
            if (++redirects > MAX_REDIRECTS)
                throw new BandcampApiRedirectException(
                    originalUrl,
                    `Too many page redirects for ${originalUrl} (last redirect: ${url} -> ${result.url})`,
                )
            visited.add(redirected.href)
            url = result.url
        }
    }

    private cachedPage(url: string, purpose: BandcampRequestPurpose): Page | null {
        const key = pageCacheKey(url)
        const cached = this.pages.get(key)
        if (cached && cached.expiresAt > Date.now()) {
            if (purpose === 'feed') cached.purpose = 'feed'
            this.journal.cacheHit()
            return cached.page
        }
        this.forgetPage(key)
        return null
    }

    private forgetPage(key: string): void {
        const cached = this.pages.get(key)
        if (cached) this.cachedHtmlBytes -= cached.bytes
        this.pages.delete(key)
    }

    private cachePage(url: string, page: Page, purpose: 'feed' | 'import'): void {
        const bytes = page.html.length * 2
        if (bytes > MAX_CACHED_HTML_BYTES) return
        const key = pageCacheKey(url)
        // An import admitted before the feed may finish later; it cannot demote the feed's page.
        if (purpose === 'import' && this.pages.get(key)?.purpose === 'feed') return
        this.forgetPage(key)
        while (this.pages.size >= MAX_CACHED_PAGES || this.cachedHtmlBytes + bytes > MAX_CACHED_HTML_BYTES) {
            const oldest =
                [...this.pages].find(([, entry]) => entry.purpose === 'import')?.[0] ??
                (purpose === 'feed' ? this.pages.keys().next().value : undefined)
            if (oldest === undefined) return
            this.forgetPage(oldest)
        }
        this.pages.set(key, { page, expiresAt: Date.now() + PAGE_CACHE_MS, bytes, purpose })
        this.cachedHtmlBytes += bytes
    }

    private async requestBandcampPage(request: PageRequest): Promise<PageResult> {
        const { url, signal, purpose } = request
        signal.throwIfAborted()
        // A queued lookup can reuse a page that another caller just fetched.
        const cached = this.cachedPage(url, purpose)
        if (cached) return { kind: 'page', page: cached }
        const release = await this.gate.acquire(purpose, signal)
        if (!release) return { kind: 'cooldown' }
        try {
            signal.throwIfAborted()
            // Admission can follow a long background wait; reuse pages fetched during that wait.
            const cached = this.cachedPage(url, purpose)
            if (cached) return { kind: 'page', page: cached }
            if (this.gate.state.cooldownUntil > Date.now()) return { kind: 'cooldown' }
            return await this.fetchPage(request, true)
        } finally {
            release()
        }
    }

    private async fetchPage(request: PageRequest, bandcamp: boolean): Promise<PageResult> {
        const { url, signal, purpose } = request
        const requestSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(bandcamp ? REQUEST_TIMEOUT_MS : PREVIEW_TIMEOUT_MS),
        ])
        let response: Response | undefined
        const rateLimitEpochAtStart = this.gate.state.epoch
        const entry = bandcamp ? this.journal.start(request, this.gate.state) : null
        let failure: string | undefined
        try {
            response = await fetch(url, { signal: requestSignal, redirect: 'manual' })
            if (entry) this.journal.response(entry, response)
            if (bandcamp && response.status === 429) {
                const cooldownUntil = this.gate.rateLimited(
                    retryAfterDelay(response.headers.get('Retry-After')),
                    rateLimitEpochAtStart,
                )
                this.journal.rateLimited(this.gate.state)
                throw new BandcampApiRateLimitedException(url, new Date(cooldownUntil))
            }
            if ([301, 302, 303, 307, 308].includes(response.status)) {
                const location = response.headers.get('Location')
                const destination = location ? URL.parse(location, url) : null
                if (!destination || !['http:', 'https:'].includes(destination.protocol))
                    throw new BandcampApiRedirectException(url, `Invalid page redirect for ${url}`)
                return { kind: 'redirect', url: destination.href }
            }
            if (!response.ok) throw new BandcampApiFailedToFetchTralbumException(url, response.status)
            const page = { url: response.url || url, html: await response.text() }
            if (bandcamp) {
                if (purpose !== 'preview') this.cachePage(url, page, purpose)
                this.gate.succeeded(purpose, rateLimitEpochAtStart)
            }
            return { kind: 'page', page }
        } catch (error) {
            failure = error instanceof Error ? error.name : 'UnknownError'
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
            if (entry) this.journal.finish(entry, failure)
            // Consume successful bodies above; release rejected and redirected bodies here.
            if (response && !response.bodyUsed) await response.body?.cancel().catch(() => {})
        }
    }
}

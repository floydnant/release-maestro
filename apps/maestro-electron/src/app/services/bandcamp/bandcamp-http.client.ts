import { FetchFailedException } from '@release-maestro/core'
import {
    BandcampApiException,
    BandcampApiFailedToFetchTralbumException,
    BandcampApiRateLimitedException,
    BandcampApiRedirectException,
} from './bandcamp-api.exceptions'
import { BandcampPageCache, Page } from './bandcamp-page-cache'
import { BandcampRequestGate, BandcampRequestPurpose } from './bandcamp-request-gate'
import { BandcampRequestDetails, BandcampRequestJournal } from './bandcamp-request-journal'
export type { BandcampRequestPurpose } from './bandcamp-request-gate'

const REQUEST_TIMEOUT_MS = 15_000
const PREVIEW_TIMEOUT_MS = 5000
const MAX_REDIRECTS = 10

type PageRequest = BandcampRequestDetails & { signal: AbortSignal }
type PageResult = { kind: 'page'; page: Page } | { kind: 'redirect'; url: string }

const isBandcampHostname = (hostname: string): boolean => {
    return hostname === 'bandcamp.com' || hostname.endsWith('.bandcamp.com')
}

const withoutHash = (url: string): string => {
    const parsed = new URL(url)
    parsed.hash = ''
    return parsed.href
}

/** Rejects as soon as the signal aborts, while the promise itself may still be settling. */
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
 * Fetches Bandcamp pages, following redirects by hand so every hop is admitted by one
 * {@link BandcampRequestGate}, including custom domains that serve Bandcamp releases.
 *
 * - Feed requests hold foreground priority for their whole redirect chain, and fail at once with
 *   the retry time during a cooldown. Imports wait out cooldowns cancellably and retry the hop.
 * - A cancelled caller returns at once; its request keeps its gate slot until its body has stopped.
 * - Each Bandcamp body has a 15-second timeout. Previews of other sites share one five-second
 *   budget across their redirects and bypass the gate.
 * - Successful release HTML stays in a {@link BandcampPageCache}.
 * - Real requests are measured in a bounded local {@link BandcampRequestJournal}, which excludes
 *   tracking queries, cookie values and email data.
 */
export class BandcampHttpClient {
    private readonly cache = new BandcampPageCache()
    /** Custom domains seen serving Bandcamp pages; their requests go through the gate too. */
    private readonly knownBandcampHosts = new Set<string>()
    private nextChainId = 1

    constructor(
        private readonly gate = new BandcampRequestGate(),
        private readonly journal = new BandcampRequestJournal(),
    ) {}

    holdFeedPriority(): () => void {
        return this.gate.holdForeground()
    }

    /** A page consumer rejected this document; don't keep serving it on Retry. */
    discardPage(page: Page): void {
        this.cache.discard(page)
    }

    async get(
        url: string,
        { signal, purpose = 'feed' }: { signal?: AbortSignal; purpose?: BandcampRequestPurpose } = {},
    ): Promise<Page> {
        const release = purpose === 'feed' ? this.gate.holdForeground() : () => {}
        try {
            return await this.followRedirects(url, signal ?? AbortSignal.any([]), purpose)
        } finally {
            release()
        }
    }

    private async followRedirects(
        originalUrl: string,
        signal: AbortSignal,
        purpose: BandcampRequestPurpose,
    ): Promise<Page> {
        signal.throwIfAborted()
        const chainId = this.nextChainId++
        const visited = new Set([withoutHash(originalUrl)])
        const previewDeadline = purpose === 'preview' ? AbortSignal.timeout(PREVIEW_TIMEOUT_MS) : null
        // Feed and import requests are for Bandcamp releases, even on a custom domain. A preview
        // joins the gate once a hop reaches a Bandcamp host.
        let viaBandcamp = purpose !== 'preview'
        let redirects = 0
        let url = originalUrl
        for (;;) {
            signal.throwIfAborted()
            const cached = this.cachedPage(url, purpose)
            if (cached) return cached
            const { hostname } = new URL(url)
            viaBandcamp ||= isBandcampHostname(hostname) || this.knownBandcampHosts.has(hostname)
            if (viaBandcamp && !isBandcampHostname(hostname)) this.knownBandcampHosts.add(hostname)
            const requestSignal =
                !viaBandcamp && previewDeadline ? AbortSignal.any([signal, previewDeadline]) : signal
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
            try {
                result = viaBandcamp
                    ? await abortable(this.requestThroughGate(request), requestSignal)
                    : await this.fetchPage(request, false)
            } catch (error) {
                // The gate holds a waiting import until the cooldown ends, then the hop is retried.
                if (purpose === 'import' && error instanceof BandcampApiRateLimitedException) continue
                throw error
            }
            if (result.kind === 'page') return result.page

            const lastRedirect = `${url} -> ${result.url}`
            if (visited.has(withoutHash(result.url)))
                throw new BandcampApiRedirectException(
                    originalUrl,
                    `Page redirect loop for ${originalUrl} (last redirect: ${lastRedirect})`,
                )
            if (++redirects > MAX_REDIRECTS)
                throw new BandcampApiRedirectException(
                    originalUrl,
                    `Too many page redirects for ${originalUrl} (last redirect: ${lastRedirect})`,
                )
            visited.add(withoutHash(result.url))
            url = result.url
        }
    }

    private cachedPage(url: string, purpose: BandcampRequestPurpose): Page | null {
        const page = this.cache.get(url, purpose)
        if (page) this.journal.cacheHit()
        return page
    }

    /** One Bandcamp hop. During a cooldown it throws {@link BandcampApiRateLimitedException}. */
    private async requestThroughGate(request: PageRequest): Promise<PageResult> {
        const { url, signal, purpose } = request
        signal.throwIfAborted()
        const release = await this.gate.acquire(purpose, signal)
        // The gate turns feed and preview requests away during a cooldown rather than queueing them.
        if (!release) throw new BandcampApiRateLimitedException(url, new Date(this.gate.state.cooldownUntil))
        try {
            signal.throwIfAborted()
            // Admission can follow a long background wait; reuse pages fetched during that wait.
            const cached = this.cachedPage(url, purpose)
            if (cached) return { kind: 'page', page: cached }
            if (this.gate.state.cooldownUntil > Date.now())
                throw new BandcampApiRateLimitedException(url, new Date(this.gate.state.cooldownUntil))
            return await this.fetchPage(request, true)
        } finally {
            release()
        }
    }

    /** One request without following redirects. Bandcamp responses inform the gate's recovery. */
    private async fetchPage(request: PageRequest, viaBandcamp: boolean): Promise<PageResult> {
        const { url, signal, purpose } = request
        const requestSignal = AbortSignal.any([
            signal,
            AbortSignal.timeout(viaBandcamp ? REQUEST_TIMEOUT_MS : PREVIEW_TIMEOUT_MS),
        ])
        let response: Response | undefined
        const rateLimitEpochAtStart = this.gate.state.epoch
        const entry = viaBandcamp ? this.journal.start(request, this.gate.state) : null
        let failure: string | undefined
        try {
            response = await fetch(url, { signal: requestSignal, redirect: 'manual' })
            if (entry) this.journal.response(entry, response)
            if (viaBandcamp && response.status === 429) {
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
            if (viaBandcamp) {
                if (purpose !== 'preview') this.cache.store(url, page, purpose)
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

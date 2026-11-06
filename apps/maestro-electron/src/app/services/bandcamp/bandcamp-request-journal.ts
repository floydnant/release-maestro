import { BandcampRequestGate, BandcampRequestPurpose } from './bandcamp-request-gate'

const MAX_ENTRIES = 1000
const WINDOW_SECONDS = 300
const emptyCounts = () => ({
    feed: { requests: 0, rateLimited: 0 },
    import: { requests: 0, rateLimited: 0 },
    preview: { requests: 0, rateLimited: 0 },
})
export type BandcampRequestDetails = {
    url: string
    purpose: BandcampRequestPurpose
    queuedAt: number
    chainId: number
    hop: number
}

type RequestEntry = {
    chainId: number
    hop: number
    startedAt: number
    purpose: BandcampRequestPurpose
    url: string
    queueWaitMs: number
    status: number | null
    durationMs: number | null
    retryAfter: string | null
    redirectTo?: string
    cookies?: { name: string; domain: string | null }[]
    error?: string
    gate: BandcampRequestGate['state']
}

const publicUrl = (url: string): string => {
    const parsed = new URL(url)
    return parsed.origin + parsed.pathname
}

/** Local measurements of real requests. Query strings, cookie values and email content are excluded. */
export class BandcampRequestJournal {
    private entries: RequestEntry[] = []
    private cacheHits = 0
    private seconds = new Map<number, ReturnType<typeof emptyCounts>>()

    private prune(now: number): void {
        for (const timestamp of this.seconds.keys()) {
            if (timestamp <= Math.floor(now / 1000) - WINDOW_SECONDS) this.seconds.delete(timestamp)
        }
    }

    cacheHit(): void {
        this.cacheHits++
    }

    start(
        { url, purpose, queuedAt, chainId, hop }: BandcampRequestDetails,
        gate: BandcampRequestGate['state'],
    ): RequestEntry {
        const entry: RequestEntry = {
            chainId,
            hop,
            startedAt: Date.now(),
            purpose,
            url: publicUrl(url),
            queueWaitMs: Date.now() - queuedAt,
            status: null,
            durationMs: null,
            retryAfter: null,
            gate,
        }
        const second = Math.floor(entry.startedAt / 1000)
        const counts = this.seconds.get(second) ?? emptyCounts()
        counts[purpose].requests++
        this.seconds.set(second, counts)
        this.prune(entry.startedAt)
        this.entries.push(entry)
        if (this.entries.length > MAX_ENTRIES) this.entries.shift()
        return entry
    }

    response(entry: RequestEntry, response: Response): void {
        entry.status = response.status
        const counts = this.seconds.get(Math.floor(entry.startedAt / 1000))
        if (response.status === 429 && counts) counts[entry.purpose].rateLimited++
        entry.retryAfter = response.headers.get('Retry-After')
        const location = response.headers.get('Location')
        const destination = location ? URL.parse(location, entry.url) : null
        if (destination && ['http:', 'https:'].includes(destination.protocol))
            entry.redirectTo = publicUrl(destination.href)
        const cookies = response.headers.getSetCookie().map(header => ({
            name: header.slice(0, header.indexOf('=')),
            domain: header.match(/;\s*domain=([^;]+)/i)?.[1] ?? null,
        }))
        if (cookies.length) entry.cookies = cookies
    }

    finish(entry: RequestEntry, error?: string): void {
        entry.durationMs = Date.now() - entry.startedAt
        if (error) entry.error = error
        if (process.env.MAESTRO_BANDCAMP_DIAGNOSTICS === '1')
            console.info('[Bandcamp request]', JSON.stringify(entry))
    }

    snapshot(now = Date.now()) {
        const counts = (windowMs: number) => {
            const result = emptyCounts()
            // One-second buckets keep counts bounded and independent of journal eviction.
            for (const [second, counts] of this.seconds) {
                if (second <= Math.floor((now - windowMs) / 1000)) continue
                for (const purpose of ['feed', 'import', 'preview'] satisfies BandcampRequestPurpose[]) {
                    result[purpose].requests += counts[purpose].requests
                    result[purpose].rateLimited += counts[purpose].rateLimited
                }
            }
            return result
        }
        return {
            recordedAt: now,
            cacheHits: this.cacheHits,
            lastMinute: counts(60_000),
            lastFiveMinutes: counts(300_000),
            recent: this.entries.slice(-20).map(entry => ({ ...entry })),
        }
    }

    rateLimited(gate: BandcampRequestGate['state']): void {
        console.warn('[Bandcamp rate limit]', JSON.stringify({ ...gate, ...this.snapshot() }))
    }
}

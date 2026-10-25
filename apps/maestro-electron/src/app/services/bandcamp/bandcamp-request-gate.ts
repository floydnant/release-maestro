export type BandcampRequestPurpose = 'import' | 'feed' | 'preview'

// bandcamp-fetch 3.2.1 uses 200ms between operation starts and five concurrent operations.
// Keep one fewer background slot; feed requests retain separate capacity instead of waiting on bodies.
// These are starting policies, not a published Bandcamp quota.
const MIN_BACKGROUND_INTERVAL_MS = 200
const MAX_BACKGROUND_REQUESTS = 4
const RATE_LIMIT_BACKGROUND_INTERVAL_MS = 3000
const MAX_BACKGROUND_INTERVAL_MS = 30_000
const FOREGROUND_QUIET_MS = 2000
const MAX_FOREGROUND_REQUESTS = 5
const RATE_LIMIT_BACKOFF_MS = 30_000
const MAX_RATE_LIMIT_BACKOFF_MS = 5 * 60_000
// The measured 180-start minute was rejected. Smooth sustained traffic to 120/minute,
// with a 30-start allowance for short bursts. This remains a client policy, not a known quota.
const REQUEST_BUDGET_COST_MS = 500
const REQUEST_BURST_TOLERANCE_MS = 29 * REQUEST_BUDGET_COST_MS
const MAX_FEED_BUDGET_DELAY_MS = 15_000

type Permit = (() => void) | null
type WaitingRequest = {
    purpose: BandcampRequestPurpose
    signal: AbortSignal
    resolve: (permit: Permit) => void
    reject: (error: unknown) => void
    onAbort: () => void
}

/** Owns admission for all Bandcamp requests. A null permit means the foreground must wait for a cooldown. */
export class BandcampRequestGate {
    private waiting: WaitingRequest[] = []
    private wakeup: ReturnType<typeof setTimeout> | undefined
    private foregroundLeases = 0
    private activeForeground = 0
    private activeBackground = 0
    private backgroundLimit = MAX_BACKGROUND_REQUESTS
    private quietUntil = 0
    private nextBackgroundAt = 0
    private backgroundInterval = MIN_BACKGROUND_INTERVAL_MS
    private cleanBackgroundResponses = 0
    private consecutiveRateLimits = 0
    private cooldown = 0
    private rateLimitEpoch = 0
    // Virtual finish time: background starts wait until the burst allowance catches up.
    private budgetFinishAt = 0

    get state() {
        return {
            cooldownUntil: this.cooldown,
            epoch: this.rateLimitEpoch,
            backgroundIntervalMs: this.backgroundInterval,
            backgroundLimit: this.backgroundLimit,
            foregroundLeases: this.foregroundLeases,
            activeForeground: this.activeForeground,
            activeBackground: this.activeBackground,
            queued: this.waiting.length,
            budgetReadyAt: Math.max(0, this.budgetFinishAt - REQUEST_BURST_TOLERANCE_MS),
        }
    }

    holdForeground(): () => void {
        this.foregroundLeases++
        this.pump()
        return this.once(() => {
            this.foregroundLeases--
            this.quietUntil = Math.max(this.quietUntil, Date.now() + FOREGROUND_QUIET_MS)
            this.pump()
        })
    }

    acquire(purpose: BandcampRequestPurpose, signal: AbortSignal): Promise<Permit> {
        signal.throwIfAborted()
        return new Promise((resolve, reject) => {
            const request: WaitingRequest = {
                purpose,
                signal,
                resolve,
                reject,
                onAbort: () => {
                    this.waiting = this.waiting.filter(item => item !== request)
                    signal.removeEventListener('abort', request.onAbort)
                    reject(signal.reason)
                    this.pump()
                },
            }
            signal.addEventListener('abort', request.onAbort, { once: true })
            this.waiting.push(request)
            this.pump()
        })
    }

    rateLimited(retryAfterMs: number | null, requestEpoch: number): number {
        const now = Date.now()
        // A burst counts as one attempt. Late responses cannot suppress the next attempt's backoff.
        if (this.rateLimitEpoch === requestEpoch) {
            this.consecutiveRateLimits++
            this.rateLimitEpoch++
            this.backgroundLimit = 1
            this.backgroundInterval = Math.min(
                Math.max(RATE_LIMIT_BACKGROUND_INTERVAL_MS, this.backgroundInterval * 2),
                MAX_BACKGROUND_INTERVAL_MS,
            )
            const backoff = Math.min(
                RATE_LIMIT_BACKOFF_MS * 2 ** (this.consecutiveRateLimits - 1),
                MAX_RATE_LIMIT_BACKOFF_MS,
            )
            // Retry-After is a minimum wait, not a guarantee that the next attempt will succeed.
            this.cooldown = Math.max(this.cooldown, now + Math.max(retryAfterMs ?? 0, backoff))
        } else if (retryAfterMs !== null) {
            // One rejected burst has one recovery deadline; only a longer server wait extends it.
            this.cooldown = Math.max(this.cooldown, now + retryAfterMs)
        }
        this.cleanBackgroundResponses = 0
        this.pump()
        return this.cooldown
    }

    succeeded(purpose: BandcampRequestPurpose, requestEpoch: number): void {
        if (this.rateLimitEpoch !== requestEpoch) return
        this.consecutiveRateLimits = 0
        if (purpose !== 'feed' && ++this.cleanBackgroundResponses >= 20) {
            if (this.backgroundInterval > MIN_BACKGROUND_INTERVAL_MS)
                this.backgroundInterval = Math.max(MIN_BACKGROUND_INTERVAL_MS, this.backgroundInterval / 2)
            else this.backgroundLimit = Math.min(MAX_BACKGROUND_REQUESTS, this.backgroundLimit + 1)
            this.cleanBackgroundResponses = 0
        }
    }

    private once(action: () => void): () => void {
        let released = false
        return () => {
            if (released) return
            released = true
            action()
        }
    }

    private admit(request: WaitingRequest, release: Permit): void {
        this.waiting = this.waiting.filter(item => item !== request)
        request.signal.removeEventListener('abort', request.onAbort)
        request.resolve(release)
    }

    private pump(): void {
        clearTimeout(this.wakeup)
        this.wakeup = undefined
        const now = Date.now()
        if (this.cooldown > now) {
            for (const request of [...this.waiting]) {
                if (request.purpose !== 'import') this.admit(request, null)
            }
        } else {
            for (const request of [...this.waiting]) {
                if (request.purpose !== 'feed' || this.activeForeground >= MAX_FOREGROUND_REQUESTS) continue
                this.activeForeground++
                // Feed never waits for this budget. Its traffic holds background work back instead.
                this.budgetFinishAt = Math.min(
                    Math.max(this.budgetFinishAt, now) + REQUEST_BUDGET_COST_MS,
                    now + REQUEST_BURST_TOLERANCE_MS + MAX_FEED_BUDGET_DELAY_MS,
                )
                this.admit(
                    request,
                    this.once(() => {
                        this.activeForeground--
                        this.pump()
                    }),
                )
            }
        }
        if (this.foregroundLeases || this.activeForeground || this.activeBackground >= this.backgroundLimit)
            return
        const next =
            this.waiting.find(request => request.purpose === 'preview') ??
            this.waiting.find(request => request.purpose === 'import')
        if (!next) return
        // Leave the first post-cooldown window for the renderer's automatic foreground retry.
        const readyAt = Math.max(
            this.nextBackgroundAt,
            this.quietUntil,
            this.cooldown ? this.cooldown + FOREGROUND_QUIET_MS : 0,
            this.budgetFinishAt - REQUEST_BURST_TOLERANCE_MS,
        )
        if (readyAt > now) {
            this.wakeup = setTimeout(() => this.pump(), readyAt - now)
            return
        }
        this.activeBackground++
        this.budgetFinishAt = Math.max(this.budgetFinishAt, now) + REQUEST_BUDGET_COST_MS
        this.nextBackgroundAt = now + this.backgroundInterval
        this.admit(
            next,
            this.once(() => {
                this.activeBackground--
                this.pump()
            }),
        )
        // Fill remaining slots at the next paced start, without waiting for an earlier body.
        this.pump()
    }
}

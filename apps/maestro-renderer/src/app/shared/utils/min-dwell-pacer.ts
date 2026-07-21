/**
 * Paces a stream of "phases" so each visible phase stays on screen for a minimum
 * dwell time before the display advances to the next phase or hides. This smooths
 * away flicker when the underlying state races through phases faster than the eye
 * can follow (e.g. a startup library scan that finishes almost instantly).
 *
 * Framework-agnostic: the clock and scheduler are injected so it can be driven
 * deterministically in tests. Values within the *same* phase (same `key`) update
 * immediately — only phase changes and hiding are held back.
 */
export interface PacedPhase<T> {
    /** Phase identity. Same key = same phase (payload updates pass through live). */
    key: string
    /** Payload handed to the consumer. */
    value: T
    /** Minimum time this phase must remain visible once shown, in ms. 0 = no pacing. */
    minDwellMs: number
}

type TimerHandle = ReturnType<typeof setTimeout>

export class MinDwellPacer<T> {
    private displayedKey: string | null = null
    private displayedDwellMs = 0
    private shownAt = 0
    private timer: TimerHandle | null = null
    private target: PacedPhase<T> | null = null

    constructor(
        private readonly emit: (value: T | null) => void,
        private readonly now: () => number = () => Date.now(),
        private readonly schedule: (ms: number, cb: () => void) => TimerHandle = (ms, cb) =>
            setTimeout(cb, ms),
        private readonly cancel: (handle: TimerHandle) => void = handle => clearTimeout(handle),
    ) {}

    /** Feed the latest desired phase (or `null` to hide). Reconciles against dwell timing. */
    set(target: PacedPhase<T> | null): void {
        this.target = target
        this.reconcile()
    }

    dispose(): void {
        if (this.timer !== null) {
            this.cancel(this.timer)
            this.timer = null
        }
    }

    private reconcile(): void {
        if (this.timer !== null) {
            this.cancel(this.timer)
            this.timer = null
        }

        const target = this.target

        // Nothing shown yet: reveal immediately (the dwell clock starts now).
        if (this.displayedKey === null) {
            if (target !== null) this.show(target)
            return
        }

        // Same phase: pass the fresh payload through without resetting timing.
        if (target !== null && target.key === this.displayedKey) {
            this.displayedDwellMs = target.minDwellMs
            this.emit(target.value)
            return
        }

        // Phase change or hide: honour the current phase's remaining dwell.
        const remaining = this.displayedDwellMs - (this.now() - this.shownAt)
        if (remaining <= 0) {
            if (target !== null) this.show(target)
            else this.hide()
        } else {
            this.timer = this.schedule(remaining, () => {
                this.timer = null
                this.reconcile()
            })
        }
    }

    private show(target: PacedPhase<T>): void {
        this.displayedKey = target.key
        this.displayedDwellMs = target.minDwellMs
        this.shownAt = this.now()
        this.emit(target.value)
    }

    private hide(): void {
        this.displayedKey = null
        this.displayedDwellMs = 0
        this.shownAt = 0
        this.emit(null)
    }
}

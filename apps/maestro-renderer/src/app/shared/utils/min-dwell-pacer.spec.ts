import { MinDwellPacer, PacedPhase } from './min-dwell-pacer'

describe('MinDwellPacer', () => {
    let now: number
    let scheduled: { at: number; cb: () => void }[]
    let emitted: (string | null)[]
    let pacer: MinDwellPacer<string>

    const phase = (key: string, value = key, minDwellMs = 1000): PacedPhase<string> => ({
        key,
        value,
        minDwellMs,
    })

    /** Advance the fake clock, firing any timers whose deadline has passed. */
    const advance = (ms: number) => {
        now += ms
        const due = scheduled.filter(timer => timer.at <= now)
        scheduled = scheduled.filter(timer => timer.at > now)
        for (const timer of due) timer.cb()
    }

    beforeEach(() => {
        now = 0
        scheduled = []
        emitted = []
        pacer = new MinDwellPacer<string>(
            value => emitted.push(value),
            () => now,
            (ms, cb) => {
                const handle = { at: now + ms, cb }
                scheduled.push(handle)
                return handle as unknown as ReturnType<typeof setTimeout>
            },
            handle => {
                scheduled = scheduled.filter(timer => timer !== (handle as unknown as (typeof scheduled)[0]))
            },
        )
    })

    it('shows the first phase immediately', () => {
        pacer.set(phase('discovering'))
        expect(emitted).toEqual(['discovering'])
    })

    it('holds a phase for its minimum dwell before hiding', () => {
        pacer.set(phase('discovering', 'discovering', 1000))
        pacer.set(null) // scan finished almost instantly

        expect(emitted).toEqual(['discovering']) // not hidden yet
        advance(999)
        expect(emitted).toEqual(['discovering'])
        advance(1)
        expect(emitted).toEqual(['discovering', null])
    })

    it('passes live payload updates within the same phase through immediately', () => {
        pacer.set(phase('discovering', '1 file'))
        pacer.set(phase('discovering', '2 files'))
        pacer.set(phase('discovering', '3 files'))

        expect(emitted).toEqual(['1 file', '2 files', '3 files'])
    })

    it('delays a phase change until the current phase has met its dwell', () => {
        pacer.set(phase('discovering', 'discovering', 1000))
        advance(400)
        pacer.set(phase('reading', 'reading', 1000))

        expect(emitted).toEqual(['discovering']) // reading is held back
        advance(600)
        expect(emitted).toEqual(['discovering', 'reading'])
    })

    it('reconciles to the latest target when a deferred timer fires', () => {
        pacer.set(phase('discovering', 'discovering', 1000))
        advance(200)
        pacer.set(phase('reading', 'reading', 1000)) // queued behind discovering's dwell
        advance(200)
        pacer.set(null) // scan finished before reading was ever shown

        // When discovering's dwell elapses, the newest target (hidden) wins —
        // the blink-and-gone reading phase is skipped entirely.
        advance(600)
        expect(emitted).toEqual(['discovering', null])
    })

    it('treats a zero dwell as immediate (no pacing)', () => {
        pacer.set(phase('discovering', 'discovering', 0))
        pacer.set(phase('reading', 'reading', 0))
        pacer.set(null)

        expect(emitted).toEqual(['discovering', 'reading', null])
    })

    it('starts a fresh dwell after re-showing from hidden', () => {
        pacer.set(phase('discovering', 'discovering', 1000))
        advance(1000)
        pacer.set(null)
        expect(emitted).toEqual(['discovering', null])

        pacer.set(phase('discovering', 'again', 1000))
        pacer.set(null)
        advance(999)
        expect(emitted).toEqual(['discovering', null, 'again'])
        advance(1)
        expect(emitted).toEqual(['discovering', null, 'again', null])
    })
})

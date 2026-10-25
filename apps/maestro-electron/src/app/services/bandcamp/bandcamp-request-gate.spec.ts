import { BandcampRequestGate } from './bandcamp-request-gate'

describe(BandcampRequestGate.name, () => {
    let gate: BandcampRequestGate
    const signal = () => new AbortController().signal
    beforeEach(() => {
        jest.useFakeTimers({ now: 1_000_000 })
        gate = new BandcampRequestGate()
    })
    afterEach(() => jest.useRealTimers())

    it('admits a cold page concurrently while holding background work through the foreground tail', async () => {
        const releaseLease = gate.holdForeground()
        const permits = await Promise.all(Array.from({ length: 5 }, () => gate.acquire('feed', signal())))
        expect(permits.every(permit => permit !== null)).toBe(true)
        const admitted = jest.fn()
        const background = gate.acquire('import', signal()).then(admitted)
        for (const permit of permits) permit?.()
        await jest.advanceTimersByTimeAsync(10_000)
        expect(admitted).not.toHaveBeenCalled()
        releaseLease()
        releaseLease()
        await jest.advanceTimersByTimeAsync(1999)
        expect(admitted).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        await background
        expect(admitted).toHaveBeenCalledTimes(1)
    })

    it('does not make the feed wait for a background response body', async () => {
        const background = Promise.all(Array.from({ length: 4 }, () => gate.acquire('import', signal())))
        await jest.advanceTimersByTimeAsync(600)
        const backgroundPermits = await background
        const foreground = gate.holdForeground()
        const permits = await Promise.all(Array.from({ length: 5 }, () => gate.acquire('feed', signal())))
        expect(gate.state).toMatchObject({ activeBackground: 4, activeForeground: 5 })
        const admitted = jest.fn()
        const waiting = gate.acquire('import', signal()).then(admitted)
        for (const permit of backgroundPermits) permit?.()
        await jest.advanceTimersByTimeAsync(1000)
        expect(admitted).not.toHaveBeenCalled()
        for (const permit of permits) permit?.()
        foreground()
        await jest.advanceTimersByTimeAsync(1999)
        expect(admitted).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        await waiting
        expect(admitted).toHaveBeenCalledTimes(1)
        admitted.mock.calls[0][0]?.()
    })

    it('starts the next background request after 200ms while the first body is still running', async () => {
        const first = await gate.acquire('import', signal())
        const admitted = jest.fn()
        const second = gate.acquire('import', signal()).then(admitted)

        await jest.advanceTimersByTimeAsync(199)
        expect(admitted).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        expect(admitted).toHaveBeenCalledTimes(1)

        first?.()
        await second
        admitted.mock.calls[0][0]?.()
    })

    it('paces background starts 200ms apart and prioritizes queued previews', async () => {
        const first = await gate.acquire('import', signal())
        const imported = jest.fn()
        const previewed = jest.fn()
        const importRequest = gate.acquire('import', signal()).then(imported)
        const previewRequest = gate.acquire('preview', signal()).then(previewed)
        first?.()
        await jest.advanceTimersByTimeAsync(199)
        expect(previewed).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        await previewRequest
        expect(imported).not.toHaveBeenCalled()
        previewed.mock.calls[0][0]?.()
        await jest.advanceTimersByTimeAsync(200)
        await importRequest
        expect(imported).toHaveBeenCalledTimes(1)
    })

    it('fills four background slots and waits for both a free slot and the next paced start', async () => {
        const starts: number[] = []
        const releases: (() => void)[] = []
        const requests = Array.from({ length: 6 }, () =>
            gate.acquire('import', signal()).then(permit => {
                starts.push(Date.now())
                if (permit) releases.push(permit)
            }),
        )
        await jest.advanceTimersByTimeAsync(800)
        expect(starts).toEqual([1_000_000, 1_000_200, 1_000_400, 1_000_600])
        expect(gate.state.activeBackground).toBe(4)
        await jest.advanceTimersByTimeAsync(1000)
        expect(starts).toHaveLength(4)

        releases[0]?.()
        await jest.advanceTimersByTimeAsync(0)
        expect(starts).toHaveLength(5)
        releases[1]?.()
        await jest.advanceTimersByTimeAsync(199)
        expect(starts).toHaveLength(5)
        await jest.advanceTimersByTimeAsync(1)
        await Promise.all(requests)
        expect(starts.slice(-2)).toEqual([1_001_800, 1_002_000])
        for (const release of releases) release()
        expect(gate.state.activeBackground).toBe(0)
    })

    it('waits through a long cooldown without failing imports and cancels a waiting caller promptly', async () => {
        gate.rateLimited(600_000, gate.state.epoch)
        const controller = new AbortController()
        const cancelled = gate.acquire('import', controller.signal).catch(error => error)
        controller.abort()
        await expect(cancelled).resolves.toBe(controller.signal.reason)
        await expect(gate.acquire('feed', signal())).resolves.toBeNull()
        await expect(gate.acquire('preview', signal())).resolves.toBeNull()
        const admitted = jest.fn()
        const waiting = gate.acquire('import', signal()).then(admitted)
        await jest.advanceTimersByTimeAsync(601_999)
        expect(admitted).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        await waiting
        expect(admitted).toHaveBeenCalledTimes(1)
    })

    it('rechecks cooldown when background work was already waiting for its pacing slot', async () => {
        const first = await gate.acquire('import', signal())
        first?.()
        const admitted = jest.fn()
        const waiting = gate.acquire('import', signal()).then(admitted)
        await jest.advanceTimersByTimeAsync(100)
        gate.rateLimited(null, gate.state.epoch)
        await jest.advanceTimersByTimeAsync(31_999)
        expect(admitted).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        await waiting
        expect(admitted).toHaveBeenCalledTimes(1)
    })

    it('treats simultaneous 429s as one attempt and slows background work before recovering gradually', () => {
        const epoch = gate.state.epoch
        const retryAt = Date.now() + 30_000
        for (let index = 0; index < 5; index++) expect(gate.rateLimited(null, epoch)).toBe(retryAt)
        expect(gate.state).toMatchObject({ epoch: 1, backgroundIntervalMs: 3000, backgroundLimit: 1 })
        gate.succeeded('feed', epoch)
        expect(gate.rateLimited(null, gate.state.epoch)).toBe(Date.now() + 60_000)
        expect(gate.state.backgroundIntervalMs).toBe(6000)
        for (let index = 0; index < 20; index++) gate.succeeded('import', gate.state.epoch)
        expect(gate.state.backgroundIntervalMs).toBe(3000)
    })

    it('restores start spacing before increasing concurrency after clean background responses', () => {
        gate.rateLimited(null, gate.state.epoch)
        const succeed = (count: number) => {
            for (let index = 0; index < count; index++) gate.succeeded('import', gate.state.epoch)
        }
        succeed(19)
        expect(gate.state).toMatchObject({ backgroundIntervalMs: 3000, backgroundLimit: 1 })
        succeed(1)
        expect(gate.state).toMatchObject({ backgroundIntervalMs: 1500, backgroundLimit: 1 })
        succeed(60)
        expect(gate.state).toMatchObject({ backgroundIntervalMs: 200, backgroundLimit: 1 })
        succeed(20)
        expect(gate.state).toMatchObject({ backgroundIntervalMs: 200, backgroundLimit: 2 })
        succeed(40)
        expect(gate.state).toMatchObject({ backgroundIntervalMs: 200, backgroundLimit: 4 })
    })

    it('admits only one background retry after a full pool receives a rate-limit burst', async () => {
        const epoch = gate.state.epoch
        const first = Promise.all(Array.from({ length: 4 }, () => gate.acquire('import', signal())))
        await jest.advanceTimersByTimeAsync(600)
        for (const permit of await first) {
            gate.rateLimited(null, epoch)
            permit?.()
        }
        expect(gate.state).toMatchObject({ epoch: 1, backgroundLimit: 1, backgroundIntervalMs: 3000 })
        const retries: (() => void)[] = []
        const waiting = Array.from({ length: 2 }, () =>
            gate.acquire('import', signal()).then(permit => {
                if (permit) retries.push(permit)
            }),
        )
        await jest.advanceTimersByTimeAsync(31_999)
        expect(retries).toHaveLength(0)
        await jest.advanceTimersByTimeAsync(1)
        expect(retries).toHaveLength(1)
        await jest.advanceTimersByTimeAsync(5000)
        expect(retries).toHaveLength(1)
        retries[0]?.()
        await Promise.all(waiting)
        expect(retries).toHaveLength(2)
        retries[1]?.()
    })

    it('cancels a waiting request without releasing an occupied pool slot', async () => {
        const first = Promise.all(Array.from({ length: 4 }, () => gate.acquire('import', signal())))
        await jest.advanceTimersByTimeAsync(800)
        const permits = await first
        const controller = new AbortController()
        const cancelled = gate.acquire('import', controller.signal).catch(error => error)
        const admitted = jest.fn()
        const next = gate.acquire('import', signal()).then(admitted)
        controller.abort()
        await expect(cancelled).resolves.toBe(controller.signal.reason)
        expect(gate.state.activeBackground).toBe(4)
        expect(admitted).not.toHaveBeenCalled()
        permits[0]?.()
        await next
        expect(admitted).toHaveBeenCalledTimes(1)
        for (const permit of permits) permit?.()
        admitted.mock.calls[0][0]?.()
        expect(gate.state.activeBackground).toBe(0)
    })

    it('keeps the recovery backoff when Retry-After is already expired', () => {
        expect(gate.rateLimited(0, gate.state.epoch)).toBe(Date.now() + 30_000)
    })

    it('bounds sustained background traffic while allowing a short initial burst', async () => {
        const starts: number[] = []
        const requests = Array.from({ length: 150 }, () =>
            gate.acquire('import', signal()).then(permit => {
                starts.push(Date.now() - 1_000_000)
                permit?.()
            }),
        )

        await jest.advanceTimersByTimeAsync(9599)
        expect(starts).toHaveLength(48)
        await jest.advanceTimersByTimeAsync(1)
        expect(starts.at(-1)).toBe(9600)
        await jest.advanceTimersByTimeAsync(399)
        expect(starts).toHaveLength(49)
        await jest.advanceTimersByTimeAsync(1)
        expect(starts.at(-1)).toBe(10_000)
        await jest.advanceTimersByTimeAsync(49_999)
        expect(starts).toHaveLength(149)
        await jest.advanceTimersByTimeAsync(1)
        await Promise.all(requests)
        expect(starts.at(-1)).toBe(60_000)
    })

    it.each([
        [5, 3000],
        [100, 15_000],
    ])('admits %i feed requests without waiting and delays background by %ims', async (count, delay) => {
        const initial = Array.from({ length: 50 }, () =>
            gate.acquire('import', signal()).then(permit => permit?.()),
        )
        await jest.advanceTimersByTimeAsync(10_000)
        await Promise.all(initial)
        const releaseLease = gate.holdForeground()
        for (let index = 0; index < count; index++) {
            const permit = await gate.acquire('feed', signal())
            expect(permit).not.toBeNull()
            permit?.()
        }
        const admitted = jest.fn()
        const waiting = gate.acquire('import', signal()).then(admitted)
        releaseLease()
        await jest.advanceTimersByTimeAsync(delay - 1)
        expect(admitted).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        await waiting
        expect(admitted).toHaveBeenCalledTimes(1)
        admitted.mock.calls[0][0]?.()
    })

    it('does not charge a cancelled caller waiting for the sustained budget', async () => {
        const initial = Array.from({ length: 50 }, () =>
            gate.acquire('import', signal()).then(permit => permit?.()),
        )
        await jest.advanceTimersByTimeAsync(10_000)
        await Promise.all(initial)
        const controller = new AbortController()
        const cancelled = gate.acquire('import', controller.signal).catch(error => error)
        controller.abort()
        await expect(cancelled).resolves.toBe(controller.signal.reason)
        const admitted = jest.fn()
        const next = gate.acquire('import', signal()).then(admitted)
        await jest.advanceTimersByTimeAsync(499)
        expect(admitted).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        await next
        expect(admitted).toHaveBeenCalledTimes(1)
        admitted.mock.calls[0][0]?.()
    })

    it('keeps one deadline for late responses from a rejected burst unless the server asks for longer', async () => {
        const epoch = gate.state.epoch
        expect(gate.rateLimited(3000, epoch)).toBe(1_030_000)
        await jest.advanceTimersByTimeAsync(5000)
        expect(gate.rateLimited(3000, epoch)).toBe(1_030_000)
        expect(gate.rateLimited(600_000, epoch)).toBe(1_605_000)
        expect(gate.state.epoch).toBe(1)
    })

    it('does not let repeated short Retry-After headers suppress the recovery backoff', () => {
        expect(gate.rateLimited(3000, gate.state.epoch)).toBe(Date.now() + 30_000)
        expect(gate.rateLimited(3000, gate.state.epoch)).toBe(Date.now() + 60_000)
        expect(gate.rateLimited(3000, gate.state.epoch)).toBe(Date.now() + 120_000)
    })
})

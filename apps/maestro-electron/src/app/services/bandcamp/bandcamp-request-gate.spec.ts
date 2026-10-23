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
        const background = await gate.acquire('import', signal())
        const foreground = gate.holdForeground()
        const permits = await Promise.all(Array.from({ length: 5 }, () => gate.acquire('feed', signal())))
        expect(gate.state).toMatchObject({ activeBackground: true, activeForeground: 5 })
        for (const permit of permits) permit?.()
        foreground()
        background?.()
    })

    it('paces background requests three seconds apart and prioritizes queued previews', async () => {
        const first = await gate.acquire('import', signal())
        const imported = jest.fn()
        const previewed = jest.fn()
        const importRequest = gate.acquire('import', signal()).then(imported)
        const previewRequest = gate.acquire('preview', signal()).then(previewed)
        first?.()
        await jest.advanceTimersByTimeAsync(2999)
        expect(previewed).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(1)
        await previewRequest
        expect(imported).not.toHaveBeenCalled()
        previewed.mock.calls[0][0]?.()
        await jest.advanceTimersByTimeAsync(3000)
        await importRequest
        expect(imported).toHaveBeenCalledTimes(1)
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
        await jest.advanceTimersByTimeAsync(1000)
        gate.rateLimited(null, gate.state.epoch)
        await jest.advanceTimersByTimeAsync(2000)
        expect(admitted).not.toHaveBeenCalled()
        await jest.advanceTimersByTimeAsync(30_000)
        await waiting
        expect(admitted).toHaveBeenCalledTimes(1)
    })

    it('treats simultaneous 429s as one attempt and slows background work before recovering gradually', () => {
        const epoch = gate.state.epoch
        const retryAt = Date.now() + 30_000
        for (let index = 0; index < 5; index++) expect(gate.rateLimited(null, epoch)).toBe(retryAt)
        expect(gate.state).toMatchObject({ epoch: 1, backgroundIntervalMs: 6000 })
        gate.succeeded('feed', epoch)
        expect(gate.rateLimited(null, gate.state.epoch)).toBe(Date.now() + 60_000)
        expect(gate.state.backgroundIntervalMs).toBe(12_000)
        for (let index = 0; index < 20; index++) gate.succeeded('import', gate.state.epoch)
        expect(gate.state.backgroundIntervalMs).toBe(6000)
    })

    it('gives expired Retry-After values a positive delay for automatic foreground retries', () => {
        expect(gate.rateLimited(0, gate.state.epoch)).toBe(Date.now() + 1000)
    })
})

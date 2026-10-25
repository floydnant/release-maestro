import { FetchFailedException } from '@release-maestro/core'
import { BandcampApiRateLimitedException } from './bandcamp-api.exceptions'
import { BandcampHttpClient } from './bandcamp-http.client'

describe('BandcampHttpClient', () => {
    const firstUrl = 'https://one.bandcamp.com/album/first'
    const secondUrl = 'https://two.bandcamp.com/album/second'
    let client: BandcampHttpClient
    let fetchMock: jest.SpiedFunction<typeof fetch>

    const mockSignalTimeouts = () =>
        jest.spyOn(AbortSignal, 'timeout').mockImplementation(delay => {
            const controller = new AbortController()
            setTimeout(() => controller.abort(new DOMException('Timed out', 'TimeoutError')), delay)
            return controller.signal
        })

    beforeEach(() => {
        jest.useFakeTimers({ now: new Date('2026-10-22T10:00:00Z') })
        client = new BandcampHttpClient()
        fetchMock = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('OK'))
    })

    afterEach(() => {
        jest.restoreAllMocks()
        jest.useRealTimers()
    })

    it('spaces background starts across artist subdomains by 200ms', async () => {
        const requests = [firstUrl, secondUrl, firstUrl + '-third'].map(url =>
            client.get(url, { purpose: 'import' }),
        )
        await jest.advanceTimersByTimeAsync(0)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(199)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(1)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await jest.advanceTimersByTimeAsync(200)
        await Promise.all(requests)
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('stops a repeated custom-domain redirect before requesting the same page again', async () => {
        const customUrl = 'https://music.artist.example/album/first'
        fetchMock.mockImplementation(
            async url =>
                new Response(null, {
                    status: 302,
                    headers: { Location: url === firstUrl ? customUrl : firstUrl },
                }),
        )
        await expect(client.get(firstUrl)).rejects.toThrow()
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it.each([
        ['seconds', '4', 32_000],
        ['HTTP date', 'Thu, 22 Oct 2026 10:00:04 GMT', 32_000],
        ['longer server pause', '90', 92_000],
        ['absent header', null, 32_000],
        ['malformed header', 'later', 32_000],
        ['negative seconds', '-1', 32_000],
        ['fractional seconds', '1.5', 32_000],
        ['zero seconds', '0', 32_000],
        ['past HTTP date', 'Thu, 22 Oct 2026 09:59:00 GMT', 32_000],
    ])('retries using %s', async (_label, header, delay) => {
        fetchMock.mockResolvedValueOnce(
            new Response(null, { status: 429, headers: header === null ? {} : { 'Retry-After': header } }),
        )
        const result = client.get(firstUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(delay - 1)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(1)
        await expect(result).resolves.toMatchObject({ html: expect.any(String) })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('keeps imports waiting through increasing cooldowns until cancellation', async () => {
        fetchMock.mockImplementation(async () => new Response(null, { status: 429 }))
        const controller = new AbortController()
        const result = client
            .get(firstUrl, { purpose: 'import', signal: controller.signal })
            .catch(error => error)
        await jest.advanceTimersByTimeAsync(32_000)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await jest.advanceTimersByTimeAsync(62_000)
        expect(fetchMock).toHaveBeenCalledTimes(3)
        await expect(client.get(secondUrl)).rejects.toBeInstanceOf(BandcampApiRateLimitedException)
        expect(fetchMock).toHaveBeenCalledTimes(3)
        controller.abort()
        await expect(result).resolves.toBe(controller.signal.reason)
        fetchMock.mockImplementation(async () => new Response('Recovered'))
        await jest.advanceTimersByTimeAsync(120_000)
        await expect(client.get(secondUrl)).resolves.toMatchObject({ html: 'Recovered' })
    })

    it('honors a long Retry-After without waiting indefinitely or retrying early', async () => {
        fetchMock.mockResolvedValueOnce(
            new Response(null, { status: 429, headers: { 'Retry-After': '3600' } }),
        )
        await expect(client.get(firstUrl)).rejects.toMatchObject({
            retryAt: new Date('2026-10-22T11:00:00Z'),
            userFacingMessage: expect.stringContaining('Bandcamp is limiting requests'),
        })
        await jest.advanceTimersByTimeAsync(3_599_999)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(1)
        await expect(client.get(secondUrl)).resolves.toMatchObject({ html: expect.any(String) })
    })

    it('cancels a queued caller immediately while another request is still in flight', async () => {
        const controller = new AbortController()
        let releaseFirst: (response: Response) => void = () => {}
        fetchMock.mockImplementationOnce(() => new Promise(resolve => (releaseFirst = resolve)))
        const first = client.get(firstUrl, { purpose: 'import' })
        const cancelled = client
            .get(secondUrl, { signal: controller.signal, purpose: 'import' })
            .catch(error => error)
        await jest.advanceTimersByTimeAsync(0)
        controller.abort()
        await expect(cancelled).resolves.toBe(controller.signal.reason)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        const third = client.get(firstUrl + '-third', { purpose: 'import' })
        releaseFirst(new Response('OK'))
        await jest.advanceTimersByTimeAsync(3000)
        await Promise.all([first, third])
        expect(fetchMock).toHaveBeenCalledTimes(2)
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([firstUrl, firstUrl + '-third'])
    })

    it('cancels a cooldown wait promptly and keeps that cooldown for other callers', async () => {
        const controller = new AbortController()
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
        const cancelled = client
            .get(firstUrl, { signal: controller.signal, purpose: 'import' })
            .catch(error => error)
        await jest.advanceTimersByTimeAsync(0)
        controller.abort()
        await expect(cancelled).resolves.toBe(controller.signal.reason)
        const next = client.get(secondUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(31_999)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(1)
        await expect(next).resolves.toMatchObject({ html: expect.any(String) })
    })

    it('aborts an in-flight fetch without turning cancellation into a network failure', async () => {
        const controller = new AbortController()
        fetchMock.mockImplementationOnce(async (_url, init) => {
            const signal = init?.signal
            return new Promise((_resolve, reject) =>
                signal?.addEventListener('abort', () => reject(signal.reason), { once: true }),
            )
        })
        const cancelled = client.get(firstUrl, { signal: controller.signal }).catch(error => error)
        await jest.advanceTimersByTimeAsync(0)
        controller.abort()
        await expect(cancelled).resolves.toBe(controller.signal.reason)
        const next = client.get(secondUrl)
        await jest.advanceTimersByTimeAsync(1000)
        await expect(next).resolves.toMatchObject({ html: expect.any(String) })
    })

    it('does not request an already cancelled URL or let a network failure block later requests', async () => {
        const controller = new AbortController()
        controller.abort()
        await expect(client.get(firstUrl, { signal: controller.signal })).rejects.toBe(
            controller.signal.reason,
        )
        expect(fetchMock).not.toHaveBeenCalled()
        fetchMock.mockRejectedValueOnce(new TypeError('Network unavailable'))
        await expect(client.get(firstUrl)).rejects.toBeInstanceOf(FetchFailedException)
        const next = client.get(secondUrl)
        await jest.advanceTimersByTimeAsync(1000)
        await expect(next).resolves.toMatchObject({ html: expect.any(String) })
    })

    it('returns feed requests promptly during a cooldown while imports may wait', async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
        await expect(client.get(firstUrl)).rejects.toBeInstanceOf(BandcampApiRateLimitedException)
        await expect(client.get(secondUrl)).rejects.toBeInstanceOf(BandcampApiRateLimitedException)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('holds background work while foreground release hydration is active', async () => {
        let finishBody: () => void = () => {}
        fetchMock.mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    start(controller) {
                        finishBody = () => controller.close()
                    },
                }),
            ),
        )
        const feed = client.get(firstUrl)
        await jest.advanceTimersByTimeAsync(0)
        const imported = client.get(secondUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(1000)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        finishBody()
        await jest.advanceTimersByTimeAsync(30_000)
        await Promise.all([feed, imported])
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('loads the feed while an import is still reading a response body', async () => {
        let finishBody: () => void = () => {}
        fetchMock.mockResolvedValueOnce(
            new Response(
                new ReadableStream({
                    start(controller) {
                        finishBody = () => controller.close()
                    },
                }),
            ),
        )
        const imported = client.get(firstUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(0)
        const loaded = jest.fn()
        const feed = client.get(secondUrl).then(loaded)
        await jest.advanceTimersByTimeAsync(0)
        expect(loaded).toHaveBeenCalledTimes(1)
        finishBody()
        await Promise.all([imported, feed])
    })

    it('rechecks the shared cooldown after waiting for background pacing', async () => {
        await client.get(firstUrl, { purpose: 'import' })
        const controller = new AbortController()
        const imported = client
            .get(secondUrl, { purpose: 'import', signal: controller.signal })
            .catch(error => error)
        await jest.advanceTimersByTimeAsync(0)
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
        const feed = client.get(firstUrl + '-feed').catch(error => error)
        await jest.advanceTimersByTimeAsync(1000)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await expect(feed).resolves.toBeInstanceOf(BandcampApiRateLimitedException)
        controller.abort()
        await expect(imported).resolves.toBe(controller.signal.reason)
    })

    it('keeps increasing backoff when an older successful body finishes after a 429', async () => {
        let finishBody: () => void = () => {}
        fetchMock
            .mockResolvedValueOnce(
                new Response(
                    new ReadableStream({
                        start(controller) {
                            finishBody = () => controller.close()
                        },
                    }),
                ),
            )
            .mockResolvedValueOnce(new Response(null, { status: 429 }))
        const slow = client.get(firstUrl)
        await jest.advanceTimersByTimeAsync(0)
        const limited = client.get(secondUrl).catch(error => error)
        await jest.advanceTimersByTimeAsync(0)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await expect(limited).resolves.toBeInstanceOf(BandcampApiRateLimitedException)
        finishBody()
        await slow
        await jest.advanceTimersByTimeAsync(30_000)
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
        await expect(client.get(secondUrl)).rejects.toMatchObject({
            retryAt: new Date(Date.now() + 60_000),
        })
    })

    it('counts simultaneous feed 429 responses as one rate-limit attempt', async () => {
        fetchMock.mockImplementation(async () => new Response(null, { status: 429 }))
        const retryAt = new Date(Date.now() + 30_000)
        const requests = Array.from({ length: 5 }, (_, index) =>
            client.get(`${firstUrl}-${index}`).catch(error => error),
        )
        await jest.advanceTimersByTimeAsync(0)
        expect(fetchMock).toHaveBeenCalledTimes(5)
        for (const result of await Promise.all(requests)) {
            expect(result).toMatchObject({ retryAt })
        }
        await jest.advanceTimersByTimeAsync(30_000)
        await expect(client.get(secondUrl)).rejects.toMatchObject({
            retryAt: new Date(Date.now() + 60_000),
        })
    })

    it('honors a longer Retry-After from another request in the same feed burst', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(null, { status: 429 }))
            .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '90' } }))
        const requests = [firstUrl, secondUrl].map(url => client.get(url).catch(error => error))
        await jest.advanceTimersByTimeAsync(0)
        await Promise.all(requests)
        await expect(client.get(firstUrl + '-next')).rejects.toMatchObject({
            retryAt: new Date(Date.now() + 90_000),
        })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('keeps the same cooldown on a late 429 and still escalates the next attempt', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))
            .mockImplementationOnce(
                () =>
                    new Promise(resolve =>
                        setTimeout(() => resolve(new Response(null, { status: 429 })), 3000),
                    ),
            )
            .mockImplementationOnce(
                () =>
                    new Promise(resolve =>
                        setTimeout(() => resolve(new Response(null, { status: 429 })), 2000),
                    ),
            )
        const first = client.get(firstUrl).catch(error => error)
        const late = client.get(secondUrl).catch(error => error)
        await jest.advanceTimersByTimeAsync(3000)
        await first
        await expect(late).resolves.toMatchObject({ retryAt: new Date(Date.now() + 27_000) })
        await expect(client.get(firstUrl + '-blocked')).rejects.toBeInstanceOf(
            BandcampApiRateLimitedException,
        )
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await jest.advanceTimersByTimeAsync(27_000)
        const nextAttempt = client.get(firstUrl + '-next').catch(error => error)
        await jest.advanceTimersByTimeAsync(2000)
        expect(fetchMock).toHaveBeenCalledTimes(3)
        await expect(nextAttempt).resolves.toMatchObject({ retryAt: new Date(Date.now() + 60_000) })
    })

    it('reserves cooldown recovery for the feed before allowing an import retry', async () => {
        let releaseFirst: (response: Response) => void = () => {}
        fetchMock
            .mockImplementationOnce(() => new Promise(resolve => (releaseFirst = resolve)))
            .mockImplementationOnce(
                () =>
                    new Promise(resolve =>
                        setTimeout(() => resolve(new Response(null, { status: 429 })), 2000),
                    ),
            )
            .mockImplementationOnce(
                () =>
                    new Promise(resolve =>
                        setTimeout(() => resolve(new Response(null, { status: 429 })), 2000),
                    ),
            )
        const imported = client.get(firstUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(0)
        const feed = client.get(secondUrl).catch(error => error)
        releaseFirst(new Response(null, { status: 429, headers: { 'Retry-After': '1' } }))
        await jest.advanceTimersByTimeAsync(31_999)
        await expect(feed).resolves.toBeInstanceOf(BandcampApiRateLimitedException)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await jest.advanceTimersByTimeAsync(1)
        expect(fetchMock).toHaveBeenCalledTimes(3)
        await jest.advanceTimersByTimeAsync(2000)
        await jest.advanceTimersByTimeAsync(61_999)
        expect(fetchMock).toHaveBeenCalledTimes(3)
        await jest.advanceTimersByTimeAsync(1)
        await expect(imported).resolves.toMatchObject({ html: 'OK' })
        expect(fetchMock).toHaveBeenCalledTimes(4)
    })

    it('does not trap a feed request behind import cooldown waits', async () => {
        const controller = new AbortController()
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
        const first = client
            .get(firstUrl, { purpose: 'import', signal: controller.signal })
            .catch(error => error)
        await jest.advanceTimersByTimeAsync(0)
        const second = client
            .get(secondUrl, { purpose: 'import', signal: controller.signal })
            .catch(error => error)
        const feed = client.get(firstUrl + '-feed').catch(error => error)
        await jest.advanceTimersByTimeAsync(0)
        await expect(feed).resolves.toBeInstanceOf(BandcampApiRateLimitedException)
        controller.abort()
        await Promise.all([first, second])
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('reuses a release page for previews, including tracking URLs, until the cache expires', async () => {
        await client.get(firstUrl)
        await client.get(firstUrl + '?from=email', { purpose: 'preview' })
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(5 * 60_000)
        await client.get(firstUrl)
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('prioritizes previews over imports while the feed runs immediately', async () => {
        mockSignalTimeouts()
        let finish: (response: Response) => void = () => {}
        fetchMock.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)))
        const release = client.get(firstUrl, { purpose: 'import' })
        const previews = Array.from({ length: 4 }, (_, index) =>
            client.get(`https://preview.bandcamp.com/album/${index}`, { purpose: 'preview' }),
        )
        await jest.advanceTimersByTimeAsync(0)
        const feed = client.get(secondUrl)
        const imported = client.get(firstUrl + '-import', { purpose: 'import' })
        finish(new Response('OK'))
        await jest.advanceTimersByTimeAsync(20_000)
        await Promise.all([release, feed, imported, ...previews])
        expect(fetchMock.mock.calls.slice(0, 4).map(([url]) => url)).toEqual([
            firstUrl,
            secondUrl,
            'https://preview.bandcamp.com/album/0',
            'https://preview.bandcamp.com/album/1',
        ])
        expect(fetchMock).toHaveBeenCalledTimes(7)
    })

    it('does not let preview HTML evict cached release pages', async () => {
        await client.get(firstUrl)
        const preview = client.get(secondUrl, { purpose: 'preview' })
        await jest.advanceTimersByTimeAsync(3000)
        await preview
        const again = client.get(secondUrl, { purpose: 'preview' })
        await jest.advanceTimersByTimeAsync(3000)
        await again
        await client.get(firstUrl)
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([firstUrl, secondUrl, secondUrl])
    })

    it('protects cached feed pages from a background import scan', async () => {
        const urls = Array.from({ length: 20 }, (_, index) => `${firstUrl}-${index}`)
        await Promise.all(urls.map(url => client.get(url)))
        const imported = client.get(secondUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(3000)
        await imported
        await client.get(urls[0] ?? firstUrl)
        expect(fetchMock).toHaveBeenCalledTimes(21)
    })

    it('retains feed cache priority when an older import response finishes later', async () => {
        let finishImport: (response: Response) => void = () => {}
        fetchMock.mockImplementationOnce(() => new Promise(resolve => (finishImport = resolve)))
        const imported = client.get(firstUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(0)

        await client.get(firstUrl)
        await Promise.all(Array.from({ length: 19 }, (_, index) => client.get(`${firstUrl}-feed-${index}`)))
        finishImport(new Response('OK'))
        await imported

        const nextImport = client.get(secondUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(3000)
        await nextImport
        await client.get(firstUrl)
        expect(fetchMock).toHaveBeenCalledTimes(22)
    })

    it('does not make outside previews wait for a Bandcamp preview', async () => {
        let finish: (response: Response) => void = () => {}
        fetchMock.mockImplementationOnce(() => new Promise(resolve => (finish = resolve)))
        const bandcamp = client.get(firstUrl, { purpose: 'preview' })
        await jest.advanceTimersByTimeAsync(0)
        await expect(client.get('https://artist.example/', { purpose: 'preview' })).resolves.toMatchObject({
            html: 'OK',
        })
        finish(new Response('OK'))
        await bandcamp
    })

    it('lets later previews run after a failed Bandcamp preview', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Offline'))
        const failed = client.get(firstUrl, { purpose: 'preview' }).catch(error => error)
        const next = client.get(secondUrl, { purpose: 'preview' })
        await jest.advanceTimersByTimeAsync(3000)
        await expect(failed).resolves.toBeInstanceOf(FetchFailedException)
        await expect(next).resolves.toMatchObject({ html: 'OK' })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('caches Bandcamp HTML but does not retain outside pages', async () => {
        await client.get('https://artist.example/music', { purpose: 'preview' })
        await client.get('https://artist.example/music', { purpose: 'preview' })
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await client.get(firstUrl)
        await client.get(firstUrl)
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('evicts pages when retained HTML exceeds the byte budget', async () => {
        const html = 'x'.repeat(3 * 1024 * 1024)
        fetchMock.mockImplementation(async () => new Response(html))
        await client.get(firstUrl)
        const second = client.get(secondUrl)
        await jest.advanceTimersByTimeAsync(1000)
        await second
        const firstAgain = client.get(firstUrl)
        await jest.advanceTimersByTimeAsync(1000)
        await firstAgain
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('serves an oversized page without retaining it', async () => {
        const html = 'x'.repeat(5 * 1024 * 1024)
        fetchMock.mockImplementation(async () => new Response(html))
        await client.get(firstUrl)
        const again = client.get(firstUrl)
        await jest.advanceTimersByTimeAsync(1000)
        await expect(again).resolves.toMatchObject({ html })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('holds background slots until bodies finish while letting the feed load immediately', async () => {
        fetchMock.mockImplementation(async url =>
            url === secondUrl
                ? new Response('Feed page')
                : new Response(
                      new ReadableStream({
                          start(controller) {
                              setTimeout(() => {
                                  controller.enqueue(new TextEncoder().encode('Slow body'))
                                  controller.close()
                              }, 2500)
                          },
                      }),
                  ),
        )
        const background = Array.from({ length: 5 }, (_, index) =>
            client.get(`${firstUrl}-${index}`, { purpose: 'import' }),
        )
        await jest.advanceTimersByTimeAsync(800)
        expect(fetchMock).toHaveBeenCalledTimes(4)
        await expect(client.get(secondUrl)).resolves.toMatchObject({ html: 'Feed page' })
        await jest.advanceTimersByTimeAsync(1699)
        expect(fetchMock).toHaveBeenCalledTimes(5)
        await jest.advanceTimersByTimeAsync(1)
        // The first body is done, but foreground priority still keeps the two-second quiet tail.
        await jest.advanceTimersByTimeAsync(299)
        expect(fetchMock).toHaveBeenCalledTimes(5)
        await jest.advanceTimersByTimeAsync(1)
        expect(fetchMock).toHaveBeenCalledTimes(6)
        await jest.advanceTimersByTimeAsync(2500)
        await expect(Promise.all(background)).resolves.toHaveLength(5)
    })

    it('wraps body timeouts as retryable failures without blocking other feed requests', async () => {
        mockSignalTimeouts()
        fetchMock.mockImplementationOnce(
            async (_url, init) =>
                new Response(
                    new ReadableStream({
                        start(controller) {
                            init?.signal?.addEventListener(
                                'abort',
                                () => controller.error(init.signal?.reason),
                                { once: true },
                            )
                        },
                    }),
                ),
        )
        const result = client.get(firstUrl).catch(error => error)
        const next = client.get(secondUrl)
        await jest.advanceTimersByTimeAsync(15_000)
        await expect(result).resolves.toMatchObject({ originalError: { name: 'TimeoutError' } })
        await expect(result).resolves.toBeInstanceOf(FetchFailedException)
        await expect(next).resolves.toMatchObject({ html: 'OK' })
    })

    it.each([404, 500, 429])('releases the unread body of an HTTP %s response', async status => {
        const cancel = jest.fn()
        fetchMock.mockResolvedValueOnce(new Response(new ReadableStream({ cancel }), { status }))
        await expect(client.get(firstUrl)).rejects.toThrow()
        expect(cancel).toHaveBeenCalledTimes(1)
    })

    it('routes external redirects through the Bandcamp cooldown before following them', async () => {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
        await expect(client.get(firstUrl)).rejects.toBeInstanceOf(BandcampApiRateLimitedException)
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: secondUrl } }))
        await expect(
            client.get('https://artist.example/music', { purpose: 'preview' }),
        ).rejects.toBeInstanceOf(BandcampApiRateLimitedException)
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([firstUrl, 'https://artist.example/music'])
        expect(fetchMock.mock.calls.every(([_url, init]) => init?.redirect === 'manual')).toBe(true)
    })

    it('identifies the requested release and last redirect when the redirect limit is reached', async () => {
        let redirect = 0
        fetchMock.mockImplementation(
            async () =>
                new Response(null, { status: 302, headers: { Location: `/track/redirect-${++redirect}` } }),
        )
        const result = client.get(firstUrl, { purpose: 'import' }).catch(error => error)

        await jest.advanceTimersByTimeAsync(30_000)

        await expect(result).resolves.toEqual(
            new Error(
                `Too many page redirects for ${firstUrl} (last redirect: https://one.bandcamp.com/track/redirect-10 -> https://one.bandcamp.com/track/redirect-11)`,
            ),
        )
        expect(fetchMock).toHaveBeenCalledTimes(11)
    })

    it('updates the cooldown when a custom-domain release redirects to a rate-limited Bandcamp page', async () => {
        fetchMock
            .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: firstUrl } }))
            .mockResolvedValueOnce(new Response(null, { status: 429 }))
        const result = client.get('https://artist.example/music').catch(error => error)
        await jest.advanceTimersByTimeAsync(1000)
        await expect(result).resolves.toBeInstanceOf(BandcampApiRateLimitedException)
        await expect(client.get(secondUrl)).rejects.toBeInstanceOf(BandcampApiRateLimitedException)
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('paces a Bandcamp redirect to a custom domain and shares its Retry-After cooldown', async () => {
        const customUrl = 'https://music.artist.example/album/first'
        fetchMock
            .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: customUrl } }))
            .mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '4' } }))
        const result = client.get(firstUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(199)
        expect(fetchMock).toHaveBeenCalledTimes(1)
        await jest.advanceTimersByTimeAsync(1)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await expect(client.get(secondUrl)).rejects.toBeInstanceOf(BandcampApiRateLimitedException)
        await jest.advanceTimersByTimeAsync(31_999)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await jest.advanceTimersByTimeAsync(1)
        await expect(result).resolves.toMatchObject({ url: customUrl, html: 'OK' })
        await client.get(customUrl, { purpose: 'preview' })
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([firstUrl, customUrl, customUrl])
    })

    it('recognizes direct custom-domain release lookups and remembers their ownership after cache expiry', async () => {
        const customUrl = 'https://music.artist.example/album/first'
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 429, headers: { 'Retry-After': '2' } }))
        const result = client.get(customUrl, { purpose: 'import' })
        await jest.advanceTimersByTimeAsync(32_000)
        await expect(result).resolves.toMatchObject({ url: customUrl, html: 'OK' })
        await jest.advanceTimersByTimeAsync(5 * 60_000)
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 429 }))
        await expect(client.get(secondUrl)).rejects.toBeInstanceOf(BandcampApiRateLimitedException)
        await expect(client.get(customUrl, { purpose: 'preview' })).rejects.toBeInstanceOf(
            BandcampApiRateLimitedException,
        )
        expect(fetchMock).toHaveBeenCalledTimes(3)
    })

    it('uses one five-second budget across external preview redirects', async () => {
        mockSignalTimeouts()
        fetchMock.mockImplementation(async (_url, init) => {
            const signal = init?.signal
            return new Promise((resolve, reject) => {
                const onAbort = () => {
                    clearTimeout(timeout)
                    reject(signal?.reason)
                }
                const timeout = setTimeout(() => {
                    signal?.removeEventListener('abort', onAbort)
                    resolve(new Response(null, { status: 302, headers: { Location: '/next' } }))
                }, 4000)
                signal?.addEventListener('abort', onAbort, { once: true })
            })
        })
        const preview = client
            .get('https://artist.example/start', { purpose: 'preview' })
            .catch(error => error)
        await jest.advanceTimersByTimeAsync(4999)
        expect(fetchMock).toHaveBeenCalledTimes(2)
        await jest.advanceTimersByTimeAsync(1)
        await expect(preview).resolves.toMatchObject({ name: 'TimeoutError' })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })

    it('uses the Bandcamp budget after an outside preview redirects to Bandcamp', async () => {
        mockSignalTimeouts()
        fetchMock.mockImplementation(async (url, init) => {
            const bandcamp = url === firstUrl
            return new Promise((resolve, reject) => {
                const signal = init?.signal
                const onAbort = () => {
                    clearTimeout(timeout)
                    reject(signal?.reason)
                }
                const timeout = setTimeout(
                    () => {
                        signal?.removeEventListener('abort', onAbort)
                        resolve(
                            bandcamp
                                ? new Response('Bandcamp page')
                                : new Response(null, {
                                      status: 302,
                                      headers: { Location: firstUrl },
                                  }),
                        )
                    },
                    bandcamp ? 6000 : 4000,
                )
                signal?.addEventListener('abort', onAbort, { once: true })
            })
        })
        const preview = client
            .get('https://artist.example/music', { purpose: 'preview' })
            .catch(error => error)
        await jest.advanceTimersByTimeAsync(10_000)
        await expect(preview).resolves.toMatchObject({ html: 'Bandcamp page' })
        expect(fetchMock).toHaveBeenCalledTimes(2)
    })
})

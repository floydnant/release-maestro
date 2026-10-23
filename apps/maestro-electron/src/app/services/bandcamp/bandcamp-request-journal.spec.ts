import { BandcampRequestGate } from './bandcamp-request-gate'
import { BandcampRequestJournal } from './bandcamp-request-journal'

describe(BandcampRequestJournal.name, () => {
    beforeEach(() => jest.useFakeTimers({ now: 1_000_000 }))
    afterEach(() => jest.useRealTimers())

    it('measures windows by purpose even after detailed entries are evicted', async () => {
        const journal = new BandcampRequestJournal()
        const gate = new BandcampRequestGate()
        for (let index = 0; index < 1005; index++) {
            const entry = journal.start(
                {
                    url: 'https://test.bandcamp.com/track/first',
                    purpose: 'import',
                    queuedAt: Date.now(),
                    chainId: 1,
                    hop: 0,
                },
                gate.state,
            )
            journal.response(entry, new Response('OK'))
            journal.finish(entry)
        }
        await jest.advanceTimersByTimeAsync(61_000)
        const entry = journal.start(
            {
                url: 'https://test.bandcamp.com/album/second',
                purpose: 'feed',
                queuedAt: Date.now() - 200,
                chainId: 1,
                hop: 0,
            },
            gate.state,
        )
        journal.response(entry, new Response(null, { status: 429, headers: { 'Retry-After': '30' } }))
        journal.finish(entry)
        const snapshot = journal.snapshot()
        expect(snapshot.lastMinute.import.requests).toBe(0)
        expect(snapshot.lastFiveMinutes.import.requests).toBe(1005)
        expect(snapshot.lastMinute.feed).toEqual({ requests: 1, rateLimited: 1 })
        expect(snapshot.recent).toHaveLength(20)
        expect(snapshot.recent.at(-1)).toMatchObject({ queueWaitMs: 200, status: 429, retryAfter: '30' })
        await jest.advanceTimersByTimeAsync(300_000)
        expect(journal.snapshot().lastFiveMinutes.import.requests).toBe(0)
    })

    it('records redirect and cookie names without retaining credentials or tracking values', () => {
        const journal = new BandcampRequestJournal()
        const entry = journal.start(
            {
                url: 'https://test.bandcamp.com/track/first?token=secret#private',
                purpose: 'feed',
                queuedAt: Date.now(),
                chainId: 1,
                hop: 0,
            },
            new BandcampRequestGate().state,
        )
        journal.response(
            entry,
            new Response(null, {
                status: 302,
                headers: {
                    Location: 'https://artist.example/album/second?token=secret',
                    'Set-Cookie': 'session=private; Domain=.bandcamp.com; Secure',
                },
            }),
        )
        journal.finish(entry)
        expect(entry).toMatchObject({
            url: 'https://test.bandcamp.com/track/first',
            redirectTo: 'https://artist.example/album/second',
            cookies: [{ name: 'session', domain: '.bandcamp.com' }],
        })
        expect(JSON.stringify(journal.snapshot())).not.toMatch(/secret|private|token/)
    })
})

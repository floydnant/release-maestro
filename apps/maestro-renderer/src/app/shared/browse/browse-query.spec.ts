import { Injector, runInInjectionContext, signal } from '@angular/core'
import { TestBed } from '@angular/core/testing'
import type { BrowseWindow, BrowseWindowResult } from '@release-maestro/core'
import { Subject } from 'rxjs'
import { createBrowseQuery, type BrowseQuery, type BrowseResult } from './browse-query'

type Row = { id: string }

const windowOf = (offset: number, total: number, count: number): BrowseWindowResult<Row> => ({
    rows: Array.from({ length: count }, (_value, index) => ({ id: `row-${offset + index}` })),
    offset,
    total,
})

describe('createBrowseQuery', () => {
    let injector: Injector
    let query: ReturnType<typeof signal<{ sort: string }>>
    let viewport: ReturnType<typeof signal<BrowseWindow>>
    let refresh: Subject<void>
    /** Requests the pipeline made, each with the promise handle to settle by hand. */
    let requests: {
        query: { sort: string }
        window: BrowseWindow
        resolve: (result: BrowseWindowResult<Row>) => void
        reject: (error: unknown) => void
    }[]

    /** Let the microtask queue drain, then flush effects, so the signal reflects the pipeline. */
    const settle = async () => {
        await Promise.resolve()
        await Promise.resolve()
        TestBed.tick()
    }

    const create = (): BrowseQuery<Row> =>
        runInInjectionContext(injector, () =>
            createBrowseQuery<{ sort: string }, Row>({
                query,
                viewport,
                refresh,
                sameQuery: (left, right) => left.sort == right.sort,
                fetchWindow: (nextQuery, nextWindow) =>
                    new Promise((resolve, reject) => {
                        requests.push({ query: nextQuery, window: nextWindow, resolve, reject })
                    }),
            }),
        )

    beforeEach(() => {
        TestBed.configureTestingModule({})
        injector = TestBed.inject(Injector)
        query = signal({ sort: 'title' })
        viewport = signal<BrowseWindow>({ offset: 0, limit: 20 })
        refresh = new Subject<void>()
        requests = []
    })

    const latest = () => {
        const request = requests.at(-1)
        if (!request) throw new Error('The pipeline made no request')
        return request
    }

    it('fetches the first window and reports the total of the whole query', async () => {
        const browse = create()
        await settle()

        latest().resolve(windowOf(0, 1_204, 20))
        await settle()

        expect(browse.result()).toMatchObject({ status: 'ready', offset: 0, total: 1_204, loaded: true })
        expect(browse.result().rows).toHaveLength(20)
    })

    it('resolves a row by its absolute index within the window', async () => {
        const browse = create()
        await settle()
        latest().resolve(windowOf(100, 1_204, 20))
        await settle()

        expect(browse.rowAt(105)).toEqual({ id: 'row-105' })
        expect(browse.rowAt(5)).toBeUndefined()
    })

    it('keeps the rows on screen while the next window loads', async () => {
        const browse = create()
        await settle()
        latest().resolve(windowOf(0, 1_204, 20))
        await settle()

        viewport.set({ offset: 40, limit: 20 })
        await settle()

        expect(browse.result().status).toBe('loading')
        expect(browse.result().rows).toHaveLength(20)
        expect(browse.result().total).toBe(1_204)
    })

    it('drops a superseded window rather than letting it overwrite a newer one', async () => {
        const browse = create()
        await settle()
        latest().resolve(windowOf(0, 1_204, 20))
        await settle()

        viewport.set({ offset: 40, limit: 20 })
        await settle()
        const slow = latest()

        viewport.set({ offset: 80, limit: 20 })
        await settle()
        const fast = latest()

        fast.resolve(windowOf(80, 1_204, 20))
        await settle()
        // The abandoned window answers last; switchMap means nobody is listening.
        slow.resolve(windowOf(40, 1_204, 20))
        await settle()

        expect(browse.result().offset).toBe(80)
        expect(browse.rowAt(80)).toEqual({ id: 'row-80' })
    })

    it('keeps the rows on screen while a new query loads, rather than flashing empty', async () => {
        const browse = create()
        await settle()
        latest().resolve(windowOf(0, 1_204, 20))
        await settle()

        query.set({ sort: 'bpm' })
        await settle()

        // Blanking them would be more literally correct — they answer the previous
        // question — but it makes the table flash a loading state on every keystroke
        // of a search, which is far worse to use.
        expect(browse.result()).toMatchObject({ status: 'loading', loaded: true })
        expect(browse.result().rows).toHaveLength(20)

        latest().resolve(windowOf(0, 7, 7))
        await settle()

        expect(browse.result()).toMatchObject({ status: 'ready', total: 7 })
        expect(browse.result().rows).toHaveLength(7)
    })

    it('does not refetch when an equal query is rebuilt', async () => {
        create()
        await settle()
        const requestCount = requests.length

        query.set({ sort: 'title' })
        await settle()

        expect(requests).toHaveLength(requestCount)
    })

    it('refetches on a refresh trigger, keeping the current window', async () => {
        const browse = create()
        await settle()
        latest().resolve(windowOf(0, 1_204, 20))
        await settle()

        refresh.next()
        await settle()
        latest().resolve(windowOf(0, 1_210, 20))
        await settle()

        expect(latest().window).toEqual({ offset: 0, limit: 20 })
        expect(browse.result().total).toBe(1_210)
    })

    it('surfaces a failure without discarding what was already on screen', async () => {
        const browse = create()
        await settle()
        latest().resolve(windowOf(0, 1_204, 20))
        await settle()

        viewport.set({ offset: 40, limit: 20 })
        await settle()
        latest().reject(new Error('Backend unavailable'))
        await settle()

        expect(browse.result()).toMatchObject({ status: 'error', error: 'Backend unavailable' })
        expect(browse.result().rows).toHaveLength(20)
    })

    it('retries the current window after a failure', async () => {
        const browse = create()
        await settle()
        latest().reject(new Error('Backend unavailable'))
        await settle()

        browse.retry()
        await settle()
        latest().resolve(windowOf(0, 3, 3))
        await settle()

        expect(browse.result()).toMatchObject({ status: 'ready', total: 3, error: null })
    })

    it('clamps a window the main process would refuse to serve', async () => {
        create()
        viewport.set({ offset: -20, limit: 10_000 })
        await settle()

        expect(latest().window).toEqual({ offset: 0, limit: 500 })
    })

    it('reports an empty result set as ready rather than as perpetual loading', async () => {
        const browse: BrowseQuery<Row> = create()
        await settle()
        latest().resolve({ rows: [], offset: 0, total: 0 })
        await settle()

        const result: BrowseResult<Row> = browse.result()
        expect(result).toMatchObject({ status: 'ready', total: 0, loaded: true })
        expect(result.rows).toEqual([])
    })

    it('recovers an out-of-range window against a nonempty result set', async () => {
        const browse = create()
        viewport.set({ offset: 2_000, limit: 20 })
        await settle()

        latest().resolve({ rows: [], offset: 2_000, total: 1_204 })
        await settle()

        expect(latest().window).toEqual({ offset: 1_184, limit: 20 })
        latest().resolve(windowOf(1_184, 1_204, 20))
        await settle()

        expect(browse.result()).toMatchObject({ status: 'ready', offset: 1_184, total: 1_204 })
        expect(browse.result().rows).toHaveLength(20)
    })
})

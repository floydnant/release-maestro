import { firstValueFrom, toArray } from 'rxjs'
import { MetadataEvent, MetadataResponse, MetadataScanUpdate, ScanResult } from '@release-maestro/core'
import { MetadataBackendService, MetadataEngineException } from './metadata.backend.service'
import { SidecarProcessService } from './sidecar-process.service'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'

const CACHE_DIR = '/tmp/cover-art'

/**
 * Controllable stand-in for the real worker process. Subclassing avoids any
 * spawn side effects (the base constructor only stores the binary path) while
 * letting each test drive responses and streamed events deterministically.
 */
class FakeSidecar extends SidecarProcessService {
    sendCalls: { method: string; params: unknown }[] = []
    startRequestCalls: { method: string; params: unknown }[] = []

    /** Queued responses returned by successive `send` calls. */
    sendQueue: MetadataResponse[] = []

    /** Captured from the most recent `startRequest` so a test can stream events. */
    lastOnEvent?: (event: MetadataEvent) => void
    private resolveDone?: (response: MetadataResponse) => void

    constructor() {
        super('unused-binary-path')
    }

    override send<TResult>(method: string, params: unknown): Promise<MetadataResponse<TResult>> {
        this.sendCalls.push({ method, params })
        const response = this.sendQueue.shift() ?? { type: 'response', id: 'fake', ok: true }
        return Promise.resolve(response as MetadataResponse<TResult>)
    }

    override startRequest<TResult>(
        method: string,
        params: unknown,
        onEvent?: (event: MetadataEvent) => void,
    ): { id: string; done: Promise<MetadataResponse<TResult>> } {
        this.startRequestCalls.push({ method, params })
        this.lastOnEvent = onEvent
        const done = new Promise<MetadataResponse<TResult>>(resolve => {
            this.resolveDone = resolve as (response: MetadataResponse) => void
        })
        return { id: 'scan-1', done }
    }

    emit(event: MetadataEvent): void {
        if (!this.lastOnEvent) throw new Error('no active startRequest to emit to')
        this.lastOnEvent(event)
    }

    finishScan(response: MetadataResponse): void {
        if (!this.resolveDone) throw new Error('no active scan to finish')
        this.resolveDone(response)
    }
}

describe('MetadataBackendService', () => {
    let sidecar: FakeSidecar
    let service: MetadataBackendService

    beforeEach(() => {
        sidecar = new FakeSidecar()
        service = new MetadataBackendService(sidecar, CACHE_DIR)
    })

    describe('ping', () => {
        it('returns the engine result', async () => {
            sidecar.sendQueue.push({
                type: 'response',
                id: 'fake',
                ok: true,
                result: { protocolVersion: 1, engineVersion: '0.1.0' },
            })

            await expect(service.ping()).resolves.toEqual({
                protocolVersion: 1,
                engineVersion: '0.1.0',
            })
            expect(sidecar.sendCalls[0]).toEqual({ method: 'ping', params: {} })
        })
    })

    describe('readFile', () => {
        it('injects the cover-art cache dir and returns metadata', async () => {
            const metadata = newSongFixture({ title: 'Track' })
            sidecar.sendQueue.push({ type: 'response', id: 'fake', ok: true, result: metadata })

            await expect(service.readFile('/music/song.flac')).resolves.toEqual(metadata)
            expect(sidecar.sendCalls[0]).toEqual({
                method: 'read_file',
                params: { path: '/music/song.flac', coverArtCacheDir: CACHE_DIR },
            })
        })

        it('resolves null for an unreadable file', async () => {
            sidecar.sendQueue.push({ type: 'response', id: 'fake', ok: true, result: null })
            await expect(service.readFile('/music/missing.flac')).resolves.toBeNull()
        })

        it('throws a MetadataEngineException on an error response', async () => {
            sidecar.sendQueue.push({
                type: 'response',
                id: 'fake',
                ok: false,
                error: { code: 'PARSE_FAILED', message: 'broken file', details: { line: 3 } },
            })

            const error = await service.readFile('/music/broken.flac').catch(thrown => thrown)
            expect(error).toBeInstanceOf(MetadataEngineException)
            expect(error).toMatchObject({
                name: 'MetadataEngineException',
                code: 'PARSE_FAILED',
                message: 'broken file',
                details: { line: 3 },
            })
        })
    })

    describe('writeTags', () => {
        it('forwards the update plus cache dir and preserves tri-state fields', async () => {
            const result = newSongFixture({ artist: 'New' })
            sidecar.sendQueue.push({ type: 'response', id: 'fake', ok: true, result })

            // artist set, album cleared (null), title untouched (omitted).
            const update = { artist: 'New', albumTitle: null }
            await expect(service.writeTags('/music/song.flac', update)).resolves.toEqual(result)

            expect(sidecar.sendCalls[0]).toEqual({
                method: 'write_tags',
                params: { path: '/music/song.flac', update, coverArtCacheDir: CACHE_DIR },
            })
            // `null` must survive (clear), and must not be coerced from undefined.
            const params = sidecar.sendCalls.at(0)?.params as { update: Record<string, unknown> }
            expect(params.update).toHaveProperty('albumTitle', null)
            expect(params.update).not.toHaveProperty('title')
        })
    })

    describe('scan', () => {
        it('starts a scan request with paths and cache dir', () => {
            service.scan(['/music']).subscribe()
            expect(sidecar.startRequestCalls[0]).toEqual({
                method: 'scan',
                params: { paths: ['/music'], coverArtCacheDir: CACHE_DIR },
            })
        })

        it('translates worker events and a successful completion into updates', async () => {
            const updates$ = service.scan(['/music']).pipe(toArray())
            const collected = firstValueFrom(updates$)

            const metadata = newSongFixture({ title: 'A' })
            sidecar.emit({ type: 'event', requestId: 'scan-1', event: 'started', data: { total: 2 } })
            sidecar.emit({ type: 'event', requestId: 'scan-1', event: 'item', data: { metadata } })
            sidecar.emit({
                type: 'event',
                requestId: 'scan-1',
                event: 'progress',
                data: { done: 1, total: 2 },
            })
            sidecar.emit({
                type: 'event',
                requestId: 'scan-1',
                event: 'item_error',
                data: { path: '/music/bad.flac', error: 'unsupported' },
            })
            sidecar.emit({
                type: 'event',
                requestId: 'scan-1',
                event: 'progress',
                data: { done: 2, total: 2 },
            })
            sidecar.finishScan({
                type: 'response',
                id: 'scan-1',
                ok: true,
                result: { count: 1, total: 2 } satisfies ScanResult,
            })

            await expect(collected).resolves.toEqual<MetadataScanUpdate[]>([
                { phase: 'started', total: 2 },
                { phase: 'item', metadata },
                { phase: 'progress', done: 1, total: 2 },
                { phase: 'itemError', path: '/music/bad.flac', error: 'unsupported' },
                { phase: 'progress', done: 2, total: 2 },
                { phase: 'completed', count: 1, total: 2 },
            ])
        })

        it('emits an error update (and completes) on a failed terminal response', async () => {
            const collected = firstValueFrom(service.scan(['/music']).pipe(toArray()))

            sidecar.finishScan({
                type: 'response',
                id: 'scan-1',
                ok: false,
                error: { code: 'INTERNAL_ERROR', message: 'boom' },
            })

            await expect(collected).resolves.toEqual<MetadataScanUpdate[]>([
                { phase: 'error', error: { code: 'INTERNAL_ERROR', message: 'boom' } },
            ])
        })

        it('sends a cancel for the scan id when the abort signal fires', () => {
            const controller = new AbortController()
            service.scan(['/music'], controller.signal).subscribe()

            controller.abort()

            expect(sidecar.sendCalls).toContainEqual({
                method: 'cancel',
                params: { requestId: 'scan-1' },
            })
        })
    })
})

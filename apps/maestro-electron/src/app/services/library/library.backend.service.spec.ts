import { firstValueFrom, from, Observable, Subject, toArray } from 'rxjs'
import { fromPartial } from '@total-typescript/shoehorn'
import { MetadataPrescanUpdate, MetadataScanUpdate, PrescanFileFact } from '@release-maestro/core'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import {
    LibraryBackendRepository,
    PrescanBatchComparison,
    ScanReconciliationResult,
} from './library.backend.repository'
import { MetadataBackendService } from '../metadata/metadata.backend.service'
import { LibraryBackendService } from './library.backend.service'

const EXTRACTOR_VERSION = '1111111111111111'

const fact: PrescanFileFact = {
    path: '/music/song.flac',
    fileName: 'song.flac',
    size: 100,
    modifiedAt: 1_000,
}

const newRepositoryMock = () => ({
    nextScanSeenAt: jest.fn(() => new Date('2026-06-15T10:00:00Z')),
    processPrescanBatch: jest.fn((): PrescanBatchComparison => ({
        unchanged: 0,
        changed: 0,
        new: 1,
        changedPaths: [],
    })),
    reconcileScan: jest.fn(async (): Promise<ScanReconciliationResult> => ({
        adjustments: { new: 0, changed: 0, unchanged: 0 },
        missing: 2,
        normalizationIssues: null,
    })),
    listSeenSongCovers: jest.fn(() => []),
    queueSongsWithMissingCovers: jest.fn(),
    countSongsNeedingMetadata: jest.fn(() => 1),
    countSongsNeedingVersionRefresh: jest.fn(() => 0),
    listSongsNeedingMetadata: jest.fn().mockReturnValueOnce([fact]).mockReturnValueOnce([]),
    ingestMetadata: jest.fn(() => 0),
    removeUnusedCatalogEntities: jest.fn(),
})

describe('LibraryBackendService', () => {
    it('runs prescan comparison before bounded deep metadata ingestion', async () => {
        const metadata = newSongFixture({ path: fact.path, fileName: fact.fileName })
        const repository = newRepositoryMock()
        const scanSeenAt = repository.nextScanSeenAt()
        const metadataService = {
            ping: jest.fn(async () => ({
                protocolVersion: 1,
                engineVersion: '0.1.0',
                extractorVersion: EXTRACTOR_VERSION,
            })),
            prescan: jest.fn((): Observable<MetadataPrescanUpdate> =>
                from<MetadataPrescanUpdate[]>([
                    { phase: 'started' },
                    { phase: 'batch', items: [fact] },
                    { phase: 'completed', count: 1, errors: 0 },
                ]),
            ),
            readFiles: jest.fn((): Observable<MetadataScanUpdate> =>
                from<MetadataScanUpdate[]>([
                    { phase: 'started', total: 1 },
                    { phase: 'item', metadata },
                    { phase: 'completed', count: 1, total: 1 },
                ]),
            ),
        }
        const service = new LibraryBackendService(fromPartial(repository), fromPartial(metadataService))

        const updates = await firstValueFrom(service.scan(['/music']).pipe(toArray()))

        expect(repository.processPrescanBatch).toHaveBeenCalledWith([fact], scanSeenAt, false)
        expect(repository.reconcileScan).toHaveBeenCalledWith({
            seenAt: scanSeenAt,
            complete: true,
            changedPaths: new Set(),
            failedReadPaths: new Set(),
            unavailableFolders: [],
            abortSignal: undefined,
        })
        expect(repository.countSongsNeedingMetadata).toHaveBeenCalledWith(scanSeenAt, EXTRACTOR_VERSION)
        expect(repository.countSongsNeedingVersionRefresh).toHaveBeenCalledWith(scanSeenAt, EXTRACTOR_VERSION)
        expect(repository.listSongsNeedingMetadata).toHaveBeenCalledWith(
            scanSeenAt,
            null,
            100,
            EXTRACTOR_VERSION,
        )
        expect(metadataService.readFiles).toHaveBeenCalledWith([fact.path], undefined)
        expect(repository.ingestMetadata).toHaveBeenCalledWith(
            metadata,
            fact,
            expect.any(Date),
            EXTRACTOR_VERSION,
        )
        expect(repository.removeUnusedCatalogEntities).toHaveBeenCalledTimes(1)
        expect(updates).toEqual([
            { phase: 'discovery', discovered: 1, new: 1, changed: 0, unchanged: 0 },
            { phase: 'started', total: 1, refreshTotal: 0 },
            { phase: 'item', metadata },
            { phase: 'progress', done: 1, total: 1 },
            {
                phase: 'completed',
                count: 1,
                total: 1,
                unchanged: 0,
                changed: 0,
                new: 1,
                missing: 2,
                errors: 0,
            },
        ])
    })

    it('skips absent-file reconciliation when discovery reported errors', async () => {
        const repository = newRepositoryMock()
        repository.countSongsNeedingMetadata.mockReturnValue(0)
        repository.listSongsNeedingMetadata.mockReset().mockReturnValue([])
        const metadataService = {
            ping: jest.fn(async () => ({
                protocolVersion: 1,
                engineVersion: '0.1.0',
                extractorVersion: EXTRACTOR_VERSION,
            })),
            prescan: jest.fn((): Observable<MetadataPrescanUpdate> =>
                from<MetadataPrescanUpdate[]>([
                    { phase: 'started' },
                    { phase: 'batch', items: [fact] },
                    { phase: 'itemError', path: '/music/locked', error: 'EACCES' },
                    { phase: 'completed', count: 1, errors: 1 },
                ]),
            ),
            readFiles: jest.fn(),
        }
        const service = new LibraryBackendService(fromPartial(repository), fromPartial(metadataService))

        const updates = await firstValueFrom(service.scan(['/music']).pipe(toArray()))

        expect(repository.reconcileScan).toHaveBeenCalledWith(expect.objectContaining({ complete: false }))
        expect(repository.removeUnusedCatalogEntities).toHaveBeenCalledTimes(1)
        const completed = updates.find(update => update.phase === 'completed')
        expect(completed).toMatchObject({ errors: 1 })
    })

    it('skips absent-file reconciliation when cancelled during discovery', async () => {
        const repository = newRepositoryMock()
        const abortController = new AbortController()
        const prescan$ = new Subject<MetadataPrescanUpdate>()
        const metadataService = {
            ping: jest.fn(async () => ({
                protocolVersion: 1,
                engineVersion: '0.1.0',
                extractorVersion: EXTRACTOR_VERSION,
            })),
            prescan: jest.fn(() => prescan$.asObservable()),
            readFiles: jest.fn(),
        }
        const service = new LibraryBackendService(fromPartial(repository), fromPartial(metadataService))

        const updatesPromise = firstValueFrom(
            service.scan(['/music'], abortController.signal).pipe(toArray()),
        )
        prescan$.next({ phase: 'started' })
        prescan$.next({ phase: 'batch', items: [fact] })
        // Cancel while discovery is still in flight, then let the engine wind down.
        abortController.abort()
        prescan$.next({ phase: 'completed', count: 1, errors: 0 })
        prescan$.complete()

        const updates = await updatesPromise

        expect(repository.reconcileScan).toHaveBeenCalledWith(
            expect.objectContaining({ complete: false, abortSignal: abortController.signal }),
        )
        expect(metadataService.readFiles).not.toHaveBeenCalled()
        // A cancelled scan produces no `completed` update — the caller derives
        // the cancelled outcome from the abort signal.
        expect(updates.some(update => update.phase === 'completed')).toBe(false)
    })

    it.each(['completed', 'failed', 'cancelled'] as const)(
        'waits for deep reads before reconciling: %s',
        outcome => {
            const repository = newRepositoryMock()
            const read$ = new Subject<MetadataScanUpdate>()
            let started = () => {
                /* assigned by the promise below */
            }
            const reading = new Promise<void>(resolve => {
                started = resolve
            })
            const abort = new AbortController()
            const metadataService = fromPartial<MetadataBackendService>({
                ping: async () => ({
                    protocolVersion: 1,
                    engineVersion: '0.1.0',
                    extractorVersion: 'test-extractor',
                }),
                prescan: () =>
                    from<MetadataPrescanUpdate[]>([
                        { phase: 'batch', items: [fact] },
                        { phase: 'completed', count: 1, errors: 0 },
                    ]),
                readFiles: () => {
                    started()
                    return read$
                },
            })
            const service = new LibraryBackendService(
                fromPartial<LibraryBackendRepository>(repository),
                metadataService,
            )
            const result = firstValueFrom(service.scan(['/music'], abort.signal).pipe(toArray()))
            return reading.then(async () => {
                expect(repository.reconcileScan).not.toHaveBeenCalled()
                if (outcome === 'failed')
                    read$.next({ phase: 'itemError', path: fact.path, error: 'read failed' })
                if (outcome === 'cancelled') abort.abort()
                read$.complete()
                await result
                expect(repository.reconcileScan).toHaveBeenCalledTimes(1)
                expect(repository.reconcileScan).toHaveBeenCalledWith(
                    expect.objectContaining({
                        complete: true,
                        failedReadPaths: new Set(outcome === 'failed' ? [fact.path] : []),
                        abortSignal: abort.signal,
                    }),
                )
            })
        },
    )

    it('reports the classification adjustments returned by reconciliation', async () => {
        const repository = newRepositoryMock()
        repository.reconcileScan.mockResolvedValue({
            adjustments: { new: -1, changed: 1, unchanged: 0 },
            missing: 0,
            normalizationIssues: 1,
        })
        repository.listSongsNeedingMetadata.mockReset().mockReturnValue([])
        const metadataService = fromPartial<MetadataBackendService>({
            ping: async () => ({
                protocolVersion: 1,
                engineVersion: '0.1.0',
                extractorVersion: EXTRACTOR_VERSION,
            }),
            prescan: () =>
                from<MetadataPrescanUpdate[]>([
                    { phase: 'batch', items: [fact] },
                    { phase: 'completed', count: 1, errors: 0 },
                ]),
        })
        const updates = await firstValueFrom(
            new LibraryBackendService(fromPartial(repository), metadataService)
                .scan(['/music'])
                .pipe(toArray()),
        )
        expect(updates).toContainEqual({ phase: 'normalization', normalizationIssues: 1 })
        expect(updates.at(-1)).toMatchObject({ new: 0, changed: 1, unchanged: 0, missing: 0 })
    })
})

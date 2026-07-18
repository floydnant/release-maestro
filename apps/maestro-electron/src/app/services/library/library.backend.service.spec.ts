import { firstValueFrom, from, Observable, Subject, toArray } from 'rxjs'
import { MetadataPrescanUpdate, MetadataScanUpdate, PrescanFileFact } from '@release-maestro/core'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { MetadataBackendService } from '../metadata/metadata.backend.service'
import { LibraryBackendRepository } from './library.backend.repository'
import { LibraryBackendService } from './library.backend.service'

const fact: PrescanFileFact = {
    path: '/music/song.flac',
    fileName: 'song.flac',
    size: 100,
    modifiedAt: 1_000,
}

const newRepositoryMock = () => ({
    nextScanSeenAt: jest.fn(() => new Date('2026-06-15T10:00:00Z')),
    processPrescanBatch: jest.fn(() => ({ unchanged: 0, changed: 0, new: 1 })),
    markNotSeenPresent: jest.fn(() => 2),
    countSongsNeedingMetadata: jest.fn(() => 1),
    listSongsNeedingMetadata: jest.fn().mockReturnValueOnce([fact]).mockReturnValueOnce([]),
    ingestMetadata: jest.fn(() => 0),
})

describe('LibraryBackendService', () => {
    it('runs prescan comparison before bounded deep metadata ingestion', async () => {
        const metadata = newSongFixture({ path: fact.path, fileName: fact.fileName })
        const repository = newRepositoryMock()
        const scanSeenAt = repository.nextScanSeenAt()
        const metadataService = {
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
        const service = new LibraryBackendService(
            repository as unknown as LibraryBackendRepository,
            metadataService as unknown as MetadataBackendService,
        )

        const updates = await firstValueFrom(service.scan(['/music']).pipe(toArray()))

        expect(repository.processPrescanBatch).toHaveBeenCalledWith([fact], scanSeenAt)
        expect(repository.markNotSeenPresent).toHaveBeenCalledWith(scanSeenAt)
        expect(metadataService.readFiles).toHaveBeenCalledWith([fact.path], undefined)
        expect(repository.ingestMetadata).toHaveBeenCalledWith(metadata, fact, expect.any(Date))
        expect(updates).toEqual([
            { phase: 'discovery', discovered: 1, new: 1, changed: 0, unchanged: 0 },
            { phase: 'started', total: 1 },
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
        const service = new LibraryBackendService(
            repository as unknown as LibraryBackendRepository,
            metadataService as unknown as MetadataBackendService,
        )

        const updates = await firstValueFrom(service.scan(['/music']).pipe(toArray()))

        // Discovery was incomplete — nothing may be flagged missing.
        expect(repository.markNotSeenPresent).not.toHaveBeenCalled()
        const completed = updates.find(update => update.phase === 'completed')
        expect(completed).toMatchObject({ missing: 0, errors: 1 })
    })

    it('skips absent-file reconciliation when cancelled during discovery', async () => {
        const repository = newRepositoryMock()
        const abortController = new AbortController()
        const prescan$ = new Subject<MetadataPrescanUpdate>()
        const metadataService = {
            prescan: jest.fn(() => prescan$.asObservable()),
            readFiles: jest.fn(),
        }
        const service = new LibraryBackendService(
            repository as unknown as LibraryBackendRepository,
            metadataService as unknown as MetadataBackendService,
        )

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

        expect(repository.markNotSeenPresent).not.toHaveBeenCalled()
        expect(metadataService.readFiles).not.toHaveBeenCalled()
        // A cancelled scan produces no `completed` update — the caller derives
        // the cancelled outcome from the abort signal.
        expect(updates.some(update => update.phase === 'completed')).toBe(false)
    })
})

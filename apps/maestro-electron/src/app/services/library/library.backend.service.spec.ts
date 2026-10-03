import { firstValueFrom, from, Observable, Subject, toArray } from 'rxjs'
import { fromPartial } from '@total-typescript/shoehorn'
import { link, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MetadataPrescanUpdate, MetadataScanUpdate, PrescanFileFact } from '@release-maestro/core'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { MovedSongCandidate } from './library.backend.repository'
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
    processPrescanBatch: jest.fn(() => ({ unchanged: 0, changed: 0, new: 1 })),
    findMovedSongCandidates: jest.fn((): MovedSongCandidate[] => []),
    reconcileMovedSong: jest.fn(),
    recordSongAvailable: jest.fn(),
    countOpenIssuesForReadSongs: jest.fn(() => 0),
    markNotSeenPresent: jest.fn(() => 2),
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
        expect(repository.markNotSeenPresent).toHaveBeenCalledWith(scanSeenAt)
        expect(repository.countSongsNeedingMetadata).toHaveBeenCalledWith(scanSeenAt, EXTRACTOR_VERSION)
        expect(repository.countSongsNeedingVersionRefresh).toHaveBeenCalledWith(scanSeenAt, EXTRACTOR_VERSION)
        expect(repository.listSongsNeedingMetadata).toHaveBeenCalledWith(scanSeenAt, null, 100, EXTRACTOR_VERSION)
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

        // Discovery was incomplete — nothing may be flagged missing.
        expect(repository.markNotSeenPresent).not.toHaveBeenCalled()
        expect(repository.removeUnusedCatalogEntities).toHaveBeenCalledTimes(1)
        expect(repository.findMovedSongCandidates).not.toHaveBeenCalled()
        const completed = updates.find(update => update.phase === 'completed')
        expect(completed).toMatchObject({ missing: 0, errors: 1 })
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

        expect(repository.markNotSeenPresent).not.toHaveBeenCalled()
        expect(repository.findMovedSongCandidates).not.toHaveBeenCalled()
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
            const abort = new AbortController()
            const metadataService = fromPartial<MetadataBackendService>({
                prescan: () =>
                    from<MetadataPrescanUpdate[]>([
                        { phase: 'batch', items: [fact] },
                        { phase: 'completed', count: 1, errors: 0 },
                    ]),
                readFiles: () => read$,
            })
            const service = new LibraryBackendService(
                fromPartial<LibraryBackendRepository>(repository),
                metadataService,
            )
            const result = firstValueFrom(service.scan(['/music'], abort.signal).pipe(toArray()))
            return Promise.resolve().then(async () => {
                expect(repository.findMovedSongCandidates).not.toHaveBeenCalled()
                expect(repository.markNotSeenPresent).not.toHaveBeenCalled()
                if (outcome === 'failed')
                    read$.next({ phase: 'itemError', path: fact.path, error: 'read failed' })
                if (outcome === 'cancelled') abort.abort()
                read$.complete()
                await result
                expect(repository.findMovedSongCandidates).toHaveBeenCalledTimes(
                    outcome === 'completed' ? 1 : 0,
                )
                expect(repository.markNotSeenPresent).toHaveBeenCalledTimes(outcome === 'cancelled' ? 0 : 1)
            })
        },
    )

    it.each([true, false])(
        'only merges when the original path no longer exists: original exists %s',
        async exists => {
            const directory = await mkdtemp(join(tmpdir(), 'maestro-move-'))
            try {
                const oldPath = join(directory, 'old.mp3')
                if (exists) await writeFile(oldPath, 'original')
                const foundPath = join(directory, 'found.mp3')
                await writeFile(foundPath, 'original')
                const repository = newRepositoryMock()
                repository.countSongsNeedingMetadata.mockReturnValue(0)
                repository.listSongsNeedingMetadata.mockReset().mockReturnValue([])
                const candidate = fromPartial<MovedSongCandidate>({
                    missing: { id: 'original', path: oldPath },
                    found: { path: foundPath, firstSeenAt: repository.nextScanSeenAt() },
                })
                repository.findMovedSongCandidates.mockReturnValue([candidate])
                const metadataService = fromPartial<MetadataBackendService>({
                    prescan: () =>
                        from<MetadataPrescanUpdate[]>([
                            { phase: 'batch', items: [fact] },
                            { phase: 'completed', count: 1, errors: 0 },
                        ]),
                })
                const service = new LibraryBackendService(
                    fromPartial<LibraryBackendRepository>(repository),
                    metadataService,
                )
                const updates = await firstValueFrom(service.scan([directory]).pipe(toArray()))
                expect(repository.reconcileMovedSong).toHaveBeenCalledTimes(exists ? 0 : 1)
                expect(updates.at(-1)).toMatchObject({ new: exists ? 1 : 0, changed: exists ? 0 : 1 })
                expect(repository.recordSongAvailable).toHaveBeenCalledTimes(exists ? 1 : 0)
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        },
    )
    it.each(['file case', 'folder case', 'hardlink', 'symlink'])(
        'distinguishes a case rename from independent directory entries: %s',
        async kind => {
            const directory = await mkdtemp(join(tmpdir(), 'maestro-move-'))
            try {
                const oldFolder = join(directory, 'Album')
                await mkdir(oldFolder)
                const oldPath = join(oldFolder, 'Song.mp3')
                await writeFile(oldPath, 'original')
                let foundPath = join(oldFolder, 'song.mp3')
                if (kind === 'file case') await rename(oldPath, foundPath)
                else if (kind === 'folder case') {
                    await rename(oldFolder, join(directory, 'album'))
                    foundPath = join(directory, 'album', 'Song.mp3')
                } else {
                    foundPath = join(oldFolder, 'copy.mp3')
                    if (kind === 'hardlink') await link(oldPath, foundPath)
                    else await symlink(oldPath, foundPath)
                }
                const repository = newRepositoryMock()
                repository.countSongsNeedingMetadata.mockReturnValue(0)
                repository.listSongsNeedingMetadata.mockReset().mockReturnValue([])
                repository.findMovedSongCandidates.mockReturnValue([
                    fromPartial<MovedSongCandidate>({
                        missing: { id: 'original', path: oldPath },
                        found: { path: foundPath, firstSeenAt: repository.nextScanSeenAt() },
                    }),
                ])
                const metadataService = fromPartial<MetadataBackendService>({
                    prescan: () =>
                        from<MetadataPrescanUpdate[]>([
                            { phase: 'batch', items: [fact] },
                            { phase: 'completed', count: 1, errors: 0 },
                        ]),
                })
                await firstValueFrom(
                    new LibraryBackendService(
                        fromPartial<LibraryBackendRepository>(repository),
                        metadataService,
                    )
                        .scan([directory])
                        .pipe(toArray()),
                )
                const isMove = kind === 'file case' || kind === 'folder case'
                expect(repository.reconcileMovedSong).toHaveBeenCalledTimes(isMove ? 1 : 0)
                expect(repository.recordSongAvailable).toHaveBeenCalledTimes(isMove ? 0 : 1)
            } finally {
                await rm(directory, { recursive: true, force: true })
            }
        },
    )
})

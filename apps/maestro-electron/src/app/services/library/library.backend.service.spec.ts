import { firstValueFrom, from, Observable, toArray } from 'rxjs'
import { MetadataPrescanUpdate, MetadataScanUpdate, PrescanFileFact } from '@release-maestro/core'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { MetadataBackendService } from '../metadata/metadata.backend.service'
import { LibraryBackendRepository } from './library.backend.repository'
import { LibraryBackendService } from './library.backend.service'

describe('LibraryBackendService', () => {
    it('runs prescan comparison before bounded deep metadata ingestion', async () => {
        const fact: PrescanFileFact = {
            path: '/music/song.flac',
            fileName: 'song.flac',
            size: 100,
            modifiedAt: 1_000,
        }
        const metadata = newSongFixture({ path: fact.path, fileName: fact.fileName })
        const scanSeenAt = new Date('2026-06-15T10:00:00Z')
        const repository = {
            nextScanSeenAt: jest.fn(() => scanSeenAt),
            processPrescanBatch: jest.fn(() => ({
                unchanged: 0,
                changed: 0,
                new: 1,
                needsMetadata: [fact],
            })),
            markNotSeenPresent: jest.fn(() => 2),
            countSongsNeedingMetadata: jest.fn(() => 1),
            listSongsNeedingMetadata: jest.fn().mockReturnValueOnce([fact]).mockReturnValueOnce([]),
            ingestMetadata: jest.fn(),
        }
        const metadataService = {
            prescan: jest.fn(
                (): Observable<MetadataPrescanUpdate> =>
                    from<MetadataPrescanUpdate[]>([
                        { phase: 'started' },
                        { phase: 'batch', items: [fact] },
                        { phase: 'completed', count: 1, errors: 0 },
                    ]),
            ),
            readFiles: jest.fn(
                (): Observable<MetadataScanUpdate> =>
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
})

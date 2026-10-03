import { fromPartial } from '@total-typescript/shoehorn'
import { existsSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from 'fs'
import { stat } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { firstValueFrom, from, toArray } from 'rxjs'
import {
    MetadataPrescanUpdate,
    MetadataScanUpdate,
    PrescanFileFact,
    SongMetadata,
} from '@release-maestro/core'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { MetadataBackendService } from '../metadata/metadata.backend.service'
import { LibraryBackendRepository } from './library.backend.repository'
import { LibraryBackendService } from './library.backend.service'
import { songsTable } from '../../database/drizzle.schema'

jest.mock('fs/promises', () => ({
    ...jest.requireActual('fs/promises'),
    stat: jest.fn(jest.requireActual('fs/promises').stat),
}))

describe('library cover cache recovery', () => {
    let database: ReturnType<typeof createMigratedTestDatabase>
    let cacheDir: string
    let repository: LibraryBackendRepository
    let extractorVersion: string
    const pendingCount = () =>
        repository.countSongsNeedingMetadata(
            database.db.select().from(songsTable).get()?.lastSeenAt ?? new Date(0),
            extractorVersion,
        )

    beforeEach(() => {
        extractorVersion = 'test-extractor'
        database = createMigratedTestDatabase()
        cacheDir = mkdtempSync(join(tmpdir(), 'maestro-cover-cache-'))
        repository = new LibraryBackendRepository(database.client)
    })

    afterEach(() => {
        jest.clearAllMocks()
        database.sqlite.close()
        rmSync(cacheDir, { recursive: true, force: true })
    })

    const seedSong = (path: string, coverPath: string | null, ingested = true) => {
        const fact: PrescanFileFact = {
            path,
            fileName: path.split('/').at(-1)!,
            size: 100,
            modifiedAt: 1_000,
        }
        const metadata = newSongFixture({ path, fileName: fact.fileName, coverPath, albumTitle: path })
        const seenAt = repository.nextScanSeenAt()
        repository.processPrescanBatch([fact], seenAt)
        if (ingested) repository.ingestMetadata(metadata, fact, seenAt, extractorVersion)
        return { fact, metadata }
    }

    const scanService = (songs: { fact: PrescanFileFact; metadata: SongMetadata }[], discovered = songs) => {
        const byPath = new Map(songs.map(song => [song.fact.path, song.metadata]))
        const readFiles = jest.fn((paths: string[]) => {
            mkdirSync(cacheDir, { recursive: true })
            return from<MetadataScanUpdate[]>(
                paths.map(path => {
                    const metadata = byPath.get(path)!
                    if (metadata.coverPath) writeFileSync(metadata.coverPath, 'cover bytes')
                    return { phase: 'item', metadata }
                }),
            )
        })
        const service = new LibraryBackendService(
            repository,
            fromPartial<MetadataBackendService>({
                ping: async () => ({ protocolVersion: 1, engineVersion: '0.1.0', extractorVersion }),
                prescan: () =>
                    from<MetadataPrescanUpdate[]>([
                        { phase: 'batch', items: discovered.map(song => song.fact) },
                        { phase: 'completed', count: discovered.length, errors: 0 },
                    ]),
                readFiles,
            }),
        )
        return { service, readFiles }
    }

    it.each(['entry', 'directory'])('restores a deleted cache %s for an unchanged song', async deletion => {
        const coverPath = join(cacheDir, 'cover.png')
        writeFileSync(coverPath, 'cover bytes')
        const song = seedSong('/music/song.flac', coverPath)
        expect(pendingCount()).toBe(0)

        rmSync(deletion === 'directory' ? cacheDir : coverPath, { recursive: true })
        const { service, readFiles } = scanService([song])

        const updates = await firstValueFrom(service.scan(['/music']).pipe(toArray()))

        expect(existsSync(coverPath)).toBe(true)
        expect(readFiles).toHaveBeenCalledWith([song.fact.path], undefined)
        expect(updates).toContainEqual({ phase: 'started', total: 1, refreshTotal: 0 })
        expect(updates.at(-1)).toMatchObject({ phase: 'completed', unchanged: 1, changed: 0, count: 1 })
        expect(pendingCount()).toBe(0)

        await firstValueFrom(service.scan(['/music']).pipe(toArray()))
        expect(readFiles).toHaveBeenCalledTimes(1)
    })

    it('repairs shared missing covers without re-reading intact covers or songs with no cover', async () => {
        const missingCover = join(cacheDir, 'missing.png')
        const intactCover = join(cacheDir, 'intact.png')
        writeFileSync(intactCover, 'intact bytes')
        const songs = [
            seedSong('/music/1.flac', missingCover),
            seedSong('/music/2.flac', missingCover),
            seedSong('/music/3.flac', intactCover),
            seedSong('/music/4.flac', null),
        ]
        const { service, readFiles } = scanService(songs)

        const updates = await firstValueFrom(service.scan(['/music']).pipe(toArray()))

        expect(readFiles).toHaveBeenCalledWith(['/music/1.flac', '/music/2.flac'], undefined)
        expect(existsSync(missingCover)).toBe(true)
        expect(updates.at(-1)).toMatchObject({ unchanged: 4, count: 2 })
    })

    it('leaves songs in an unreachable folder out of cover recovery', async () => {
        const song = seedSong('/unplugged/song.flac', join(cacheDir, 'missing.png'))
        const { service, readFiles } = scanService([song], [])

        const updates = await firstValueFrom(service.scan([]).pipe(toArray()))

        expect(readFiles).not.toHaveBeenCalled()
        expect(updates.at(-1)).toMatchObject({ missing: 1, count: 0 })
    })

    it('retries failed cover recovery on the next scan', async () => {
        const coverPath = join(cacheDir, 'missing.png')
        const song = seedSong('/music/song.flac', coverPath)
        const { service, readFiles } = scanService([song])
        readFiles.mockImplementationOnce(() =>
            from<MetadataScanUpdate[]>([{ phase: 'itemError', path: song.fact.path, error: 'read failed' }]),
        )

        const failed = await firstValueFrom(service.scan(['/music']).pipe(toArray()))
        expect(failed.at(-1)).toMatchObject({ errors: 1, count: 0 })
        expect(pendingCount()).toBe(1)

        await firstValueFrom(service.scan(['/music']).pipe(toArray()))
        expect(existsSync(coverPath)).toBe(true)
        expect(pendingCount()).toBe(0)
    })

    it('recovers covers across bounded windows', async () => {
        const songs = Array.from({ length: 101 }, (_, index) =>
            seedSong(`/music/${String(index).padStart(3, '0')}.flac`, join(cacheDir, `${index}.png`)),
        )
        const { service, readFiles } = scanService(songs)

        const updates = await firstValueFrom(service.scan(['/music']).pipe(toArray()))

        expect(readFiles.mock.calls.map(([paths]) => paths.length)).toEqual([100, 1])
        expect(updates).toContainEqual({ phase: 'started', total: 101, refreshTotal: 0 })
        expect(updates.at(-1)).toMatchObject({ count: 101, unchanged: 101 })
        expect(songs.every(song => existsSync(song.metadata.coverPath!))).toBe(true)
        expect(pendingCount()).toBe(0)
    })

    it('reports cover inspection errors and still imports unrelated songs', async () => {
        const songs = [
            seedSong('/music/covered.flac', join(cacheDir, 'locked.png')),
            seedSong('/music/new.flac', null, false),
        ]
        jest.mocked(stat).mockRejectedValueOnce(Object.assign(new Error('locked'), { code: 'EACCES' }))
        const { service, readFiles } = scanService(songs)

        const updates = await firstValueFrom(service.scan(['/music']).pipe(toArray()))

        expect(readFiles).toHaveBeenCalledWith(['/music/new.flac'], undefined)
        expect(updates).toContainEqual({ phase: 'itemError', path: '/music/covered.flac', error: 'locked' })
        expect(updates.at(-1)).toMatchObject({ phase: 'completed', count: 1, errors: 1 })
    })

    it('preserves identity through a rename, extractor upgrade and deleted cover', async () => {
        const oldPath = join(cacheDir, 'original.flac')
        const newPath = join(cacheDir, 'renamed.flac')
        const coverPath = join(cacheDir, 'cover.png')
        writeFileSync(oldPath, 'audio bytes')
        writeFileSync(coverPath, 'cover bytes')
        const song = seedSong(oldPath, coverPath)
        const original = database.db.select().from(songsTable).get()
        renameSync(oldPath, newPath)
        rmSync(coverPath)
        extractorVersion = 'next-extractor'
        const moved = {
            fact: { ...song.fact, path: newPath, fileName: 'renamed.flac' },
            metadata: { ...song.metadata, path: newPath, fileName: 'renamed.flac' },
        }
        const { service, readFiles } = scanService([moved])
        await firstValueFrom(service.scan([cacheDir]).pipe(toArray()))
        expect(database.db.select().from(songsTable).all()).toEqual([
            expect.objectContaining({
                id: original?.id,
                addedAt: original?.addedAt,
                path: newPath,
                extractorVersion,
            }),
        ])
        expect(existsSync(coverPath)).toBe(true)
        await firstValueFrom(service.scan([cacheDir]).pipe(toArray()))
        expect(readFiles).toHaveBeenCalledTimes(1)
    })

    it('reads an unchanged song once when both the extractor and cover need refresh', async () => {
        const song = seedSong('/music/song.flac', join(cacheDir, 'missing.png'))
        extractorVersion = 'next-extractor'
        const { service, readFiles } = scanService([song])
        await firstValueFrom(service.scan(['/music']).pipe(toArray()))
        await firstValueFrom(service.scan(['/music']).pipe(toArray()))
        expect(readFiles).toHaveBeenCalledTimes(1)
        expect(database.db.select().from(songsTable).get()?.extractorVersion).toBe(extractorVersion)
    })
})

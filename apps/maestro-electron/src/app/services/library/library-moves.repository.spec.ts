import { newPrescanFactFixture } from '../../../test/fixtures/prescan-fact.fixture'
import { LibraryBrowseRepository } from './library-browse.repository'
import { PrescanFileFact, SongMetadata } from '@release-maestro/core'
import { basename } from 'node:path'
import { eq } from 'drizzle-orm'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { seedPendingMoves } from '../../../test/fixtures/pending-moves.fixture'
import { albumsTable, normalizationIssuesTable, songsTable } from '../../database/drizzle.schema'
import { LibraryBackendRepository, ScanReconciliation } from './library.backend.repository'
import { compareSongLocations } from './library-move-location'

describe('moved songs', () => {
    let database: ReturnType<typeof createMigratedTestDatabase>
    let repository: LibraryBackendRepository
    const first = new Date(10_000)
    const next = new Date(20_000)
    const metadata = (path: string, overrides: Partial<SongMetadata> = {}) =>
        newSongFixture({ path, fileName: basename(path), artist: 'Artist', duration: 120, ...overrides })
    const fact = (song: SongMetadata): PrescanFileFact => newPrescanFactFixture(song.path, { size: 1024 })
    const discover = (songs: SongMetadata[], seenAt: Date) => {
        repository.processPrescanBatch(songs.map(fact), seenAt)
        for (const song of songs) repository.ingestMetadata(song, fact(song), seenAt, 'test-extractor')
    }
    const compareLocations = jest.fn<
        ReturnType<typeof compareSongLocations>,
        Parameters<typeof compareSongLocations>
    >()
    const finish = (seenAt: Date, overrides: Partial<ScanReconciliation> = {}) =>
        repository.reconcileScan({
            seenAt,
            complete: true,
            changedPaths: new Set(),
            failedReadPaths: new Set(),
            unavailableFolders: [],
            ...overrides,
        })
    const rows = () => database.db.select().from(songsTable).all()

    beforeEach(() => {
        database = createMigratedTestDatabase()
        compareLocations.mockReset().mockResolvedValue('moved')
        repository = new LibraryBackendRepository(database.client, compareLocations)
    })
    afterEach(() => database.sqlite.close())

    it.each([false, true])(
        'preserves identity when moved, previously missing: %s',
        async previouslyMissing => {
            discover([metadata('/music/original.mp3')], first)
            const original = rows().at(0)
            if (!original) throw new Error('Expected an imported song')
            if (previouslyMissing) repository.markNotSeenPresent(new Date(15_000))
            discover([metadata('/external/renamed.mp3')], next)
            expect((await finish(next)).missing).toBe(0)
            expect(rows()).toEqual([
                expect.objectContaining({
                    id: original.id,
                    addedAt: original.addedAt,
                    path: '/external/renamed.mp3',
                    present: true,
                }),
            ])
            discover([metadata('/external/renamed.mp3')], new Date(30_000))
            expect((await finish(new Date(30_000))).missing).toBe(0)
            expect(rows()).toHaveLength(1)
            expect(rows()[0]?.id).toBe(original.id)
        },
    )

    it('recognizes an untagged rename using bytes even when the filename-derived title changes', async () => {
        discover([metadata('/music/one.wav', { title: 'one.wav', artist: null })], first)
        const original = rows().at(0)
        if (!original) throw new Error('Expected an imported song')
        discover([metadata('/music/two.wav', { title: 'two.wav', artist: null })], next)
        await finish(next)
        expect(rows()).toEqual([expect.objectContaining({ id: original.id, title: 'two.wav' })])
    })

    it('matches a missing pre-upgrade song using unique stored metadata and size', async () => {
        discover([metadata('/music/original.mp3')], first)
        const original = rows().at(0)
        if (!original) throw new Error('Expected an imported song')
        database.db.update(songsTable).set({ contentHash: null, firstSeenAt: null }).run()
        repository.markNotSeenPresent(new Date(15_000))
        discover([metadata('/external/original.mp3')], next)
        await finish(next)
        expect(rows()).toEqual([expect.objectContaining({ id: original.id, contentHash: 'a'.repeat(64) })])
    })

    it.each([0, null, 1])(
        'compares historical track number %s with an unknown extracted track',
        async trackNumber => {
            discover([metadata('/old/song.mp3')], first)
            const original = rows()[0]!
            database.db.update(songsTable).set({ contentHash: null, firstSeenAt: null, trackNumber }).run()
            discover([metadata('/new/song.mp3', { track: null })], next)
            const result = await finish(next)
            if (trackNumber == 1) {
                expect(rows()).toHaveLength(2)
                expect(result.adjustments).toEqual({ new: 0, changed: 0, unchanged: 0 })
            } else {
                expect(rows()).toEqual([
                    expect.objectContaining({ id: original.id, path: '/new/song.mp3', trackNumber: null }),
                ])
                expect(result.adjustments).toEqual({ new: -1, changed: 1, unchanged: 0 })
            }
        },
    )

    it('leaves unproven locations separate through the public reconciliation operation', async () => {
        discover([metadata('/old/song.mp3')], first)
        discover([metadata('/new/song.mp3')], next)
        compareLocations.mockResolvedValue('unknown')
        const result = await finish(next)
        expect(rows()).toHaveLength(2)
        expect(rows().every(song => song.moveOriginId == null)).toBe(true)
        expect(result.adjustments).toEqual({ new: 0, changed: 0, unchanged: 0 })
    })

    it('defers merges when a read failure has no matching discovery facts', async () => {
        discover([metadata('/old/song.mp3')], first)
        discover([metadata('/new/song.mp3')], next)
        const result = await finish(next, { failedReadPaths: new Set([null]) })
        expect(rows()).toHaveLength(2)
        expect(result.adjustments).toEqual({ new: 0, changed: 0, unchanged: 0 })
        expect(rows().find(song => song.path == '/new/song.mp3')?.moveOriginId).toBe(
            rows().find(song => song.path == '/old/song.mp3')?.id,
        )
    })

    it('retains proven moves without merging when discovery or reads did not finish', async () => {
        discover([metadata('/old/song.mp3')], first)
        const identity = rows()[0]!.id
        discover([metadata('/new/song.mp3')], next)
        const result = await finish(next, { complete: false })
        expect(result).toEqual({
            adjustments: { new: 0, changed: 0, unchanged: 0 },
            missing: 0,
            normalizationIssues: null,
        })
        expect(rows()).toHaveLength(2)
        expect(rows().find(song => song.path == '/new/song.mp3')?.moveOriginId).toBe(identity)
        expect(rows().every(song => song.present)).toBe(true)
        repository.processPrescanBatch([fact(metadata('/new/song.mp3'))], new Date(30_000))
        expect((await finish(new Date(30_000))).adjustments).toEqual({ new: 0, changed: 1, unchanged: -1 })
        expect(rows()).toEqual([expect.objectContaining({ id: identity, path: '/new/song.mp3' })])
    })

    it('defers every merge when cancelled during filesystem proof and repairs on retry', async () => {
        discover([metadata('/old/one.mp3'), metadata('/old/two.mp3', { contentHash: 'b'.repeat(64) })], first)
        const identities = rows()
            .map(song => song.id)
            .sort()
        discover([metadata('/new/one.mp3'), metadata('/new/two.mp3', { contentHash: 'b'.repeat(64) })], next)
        const abort = new AbortController()
        // Availability probes finish first; cancellation arrives while proving the last pair.
        compareLocations.mockImplementation(async (original, found) => {
            if (original == '/old/two.mp3' && found == '/new/two.mp3') abort.abort()
            return 'moved'
        })
        expect((await finish(next, { abortSignal: abort.signal })).adjustments.changed).toBe(0)
        expect(rows()).toHaveLength(4)
        expect(rows().filter(song => song.moveOriginId != null)).toHaveLength(2)
        compareLocations.mockResolvedValue('moved')
        repository.processPrescanBatch(
            [fact(metadata('/new/one.mp3')), fact(metadata('/new/two.mp3'))],
            new Date(30_000),
        )
        await finish(new Date(30_000))
        expect(
            rows()
                .map(song => song.id)
                .sort(),
        ).toEqual(identities)
        expect((await finish(new Date(30_000))).adjustments).toEqual({ new: 0, changed: 0, unchanged: 0 })
    })

    it('recovers with 33,000 pending origins without a parameter per origin', async () => {
        seedPendingMoves(database, 'pairs', 33_000)
        await finish(new Date(3000), { complete: false })
        expect(
            database.sqlite
                .prepare('SELECT COUNT(*) AS count FROM songs WHERE move_origin_id IS NOT NULL')
                .get(),
        ).toEqual({ count: 33_000 })

        // Retry reaches one destination while the other moves remain pending.
        database.db
            .update(songsTable)
            .set({ lastSeenAt: new Date(4000) })
            .where(eq(songsTable.id, 'd0'))
            .run()
        expect((await finish(new Date(4000))).adjustments).toEqual({ new: 0, changed: 1, unchanged: -1 })
        expect(
            database.db
                .select({ id: songsTable.id, path: songsTable.path })
                .from(songsTable)
                .where(eq(songsTable.id, 'o0'))
                .get(),
        ).toEqual({ id: 'o0', path: '/new/0.flac' })
        expect(
            database.sqlite
                .prepare('SELECT COUNT(*) AS count FROM songs WHERE move_origin_id IS NOT NULL')
                .get(),
        ).toEqual({ count: 32_999 })
    }, 30_000)

    it.each(['merge', 'coexist'] as const)(
        'recovers one 33,000-step pending chain: %s',
        async outcome => {
            seedPendingMoves(database, 'chain', 33_000)
            const seenAt = new Date(100_000)
            database.db
                .update(songsTable)
                .set({ lastSeenAt: seenAt })
                .where(eq(songsTable.id, 'd32999'))
                .run()
            if (outcome == 'coexist')
                database.db
                    .update(songsTable)
                    .set({ lastSeenAt: seenAt })
                    .where(eq(songsTable.id, 'o0'))
                    .run()
            const result = await finish(seenAt)
            expect(
                database.sqlite
                    .prepare('SELECT COUNT(*) AS count FROM songs WHERE move_origin_id IS NOT NULL')
                    .get(),
            ).toEqual({ count: 0 })
            if (outcome == 'merge') {
                expect(rows()).toEqual([expect.objectContaining({ id: 'o0', path: '/new/32999.flac' })])
                expect(result.adjustments).toEqual({ new: 0, changed: 1, unchanged: -1 })
            } else {
                expect(database.sqlite.prepare('SELECT COUNT(*) AS count FROM songs').get()).toEqual({
                    count: 33_001,
                })
                expect(result.adjustments).toEqual({ new: 0, changed: 0, unchanged: 0 })
            }
        },
        30_000,
    )

    it.each([true, false])(
        'only omits new disc fields when the original has pre-upgrade evidence: %s',
        async legacy => {
            discover([metadata('/music/original.mp3')], first)
            const original = rows()[0]
            if (!original) throw new Error('Expected original song')
            database.db
                .update(songsTable)
                .set({ contentHash: null, firstSeenAt: legacy ? null : first })
                .run()
            repository.markNotSeenPresent(new Date(15_000))
            discover(
                [metadata('/external/original.mp3', { discNumber: 1, discTotal: 2, trackTotal: 12 })],
                next,
            )
            await finish(next)
            if (legacy)
                expect(rows()).toEqual([
                    expect.objectContaining({
                        id: original.id,
                        addedAt: original.addedAt,
                        path: '/external/original.mp3',
                        discNumber: 1,
                        trackTotal: 12,
                    }),
                ])
            else expect(rows()).toHaveLength(2)
        },
    )

    it('repairs a unique missing/present pair left by an interrupted scan without another deep read', async () => {
        discover([metadata('/music/original.mp3')], first)
        const original = rows().at(0)
        if (!original) throw new Error('Expected an imported song')
        repository.markNotSeenPresent(new Date(15_000))
        discover([metadata('/external/original.mp3')], next)
        database.db.update(songsTable).set({ contentHash: null }).where(eq(songsTable.id, original.id)).run()
        const resumedAt = new Date(30_000)
        repository.processPrescanBatch([fact(metadata('/external/original.mp3'))], resumedAt)
        await finish(resumedAt)
        expect(rows()).toEqual([expect.objectContaining({ id: original.id, present: true })])
    })

    it('keeps discovery chronology separate from Added after an interrupted initial import', async () => {
        const oldSong = metadata('/music/original.mp3')
        repository.processPrescanBatch([fact(oldSong)], first, true)
        repository.ingestMetadata(oldSong, fact(oldSong), first, 'test-extractor')
        const original = rows()[0]
        if (!original) throw new Error('Expected an imported song')
        const moved = metadata('/music/renamed.mp3')
        repository.processPrescanBatch([fact(moved)], next, true)
        repository.ingestMetadata(moved, fact(moved), next, 'test-extractor')
        await finish(next)
        expect(rows()).toEqual([
            expect.objectContaining({
                id: original.id,
                addedAt: new Date(500),
                path: moved.path,
            }),
        ])
    })

    it('retains a copy observed while its original was excluded, even after the original is deleted', async () => {
        discover([metadata('/excluded/original.mp3')], first)
        const original = rows()[0]
        if (!original) throw new Error('Expected an imported song')
        discover([metadata('/included/copy.mp3')], next)
        compareLocations.mockResolvedValue('copy')
        await finish(next)
        compareLocations.mockResolvedValue('moved')
        const copies = rows()
        discover([metadata('/included/copy.mp3')], new Date(30_000))
        await finish(new Date(30_000))
        expect(
            rows()
                .map(song => song.id)
                .sort(),
        ).toEqual(copies.map(song => song.id).sort())
        expect(rows()).toHaveLength(2)
    })

    it('matches pre-upgrade folder moves when external artwork changes location', async () => {
        discover([metadata('/old/original.mp3', { coverPath: '/old/cover.jpg' })], first)
        const original = rows()[0]
        if (!original) throw new Error('Expected an imported song')
        database.db.update(songsTable).set({ contentHash: null, firstSeenAt: null }).run()
        repository.markNotSeenPresent(new Date(15_000))
        discover([metadata('/new/original.mp3', { coverPath: '/new/cover.jpg' })], next)
        await finish(next)
        expect(rows()).toEqual([
            expect.objectContaining({
                id: original.id,
                path: '/new/original.mp3',
                coverPath: '/new/cover.jpg',
            }),
        ])
    })

    it('retains legacy duplicates whose discovery order is unknown, even after repeated scans', async () => {
        const oldSong = metadata('/old/original.mp3')
        const foundSong = metadata('/new/original.mp3')
        discover([oldSong], first)
        discover([foundSong], next)
        database.db
            .update(songsTable)
            .set({ firstSeenAt: null, contentHash: null, addedAt: new Date(500) })
            .run()
        const originals = rows()
            .map(song => song.id)
            .sort()
        for (const time of [30_000, 40_000]) {
            const seenAt = new Date(time)
            discover([foundSong], seenAt)
            await finish(seenAt)
            expect(
                rows()
                    .map(song => song.id)
                    .sort(),
            ).toEqual(originals)
            expect(rows().every(song => song.firstSeenAt === null)).toBe(true)
        }
    })

    it('does not merge different bytes that have identical metadata', async () => {
        discover([metadata('/music/original.mp3')], first)
        discover([metadata('/external/other.mp3', { contentHash: 'b'.repeat(64) })], next)
        await finish(next)
        expect(rows()).toHaveLength(2)
    })

    it('retains two real copies, including when one later becomes unavailable', async () => {
        const one = metadata('/music/one.mp3')
        const two = metadata('/music/two.mp3')
        const copies = [one, two]
        discover(copies, first)
        const originals = rows()
        await finish(first)
        discover([two], next)
        await finish(next)
        expect(rows()).toHaveLength(2)
        expect(
            rows()
                .map(song => song.id)
                .sort(),
        ).toEqual(originals.map(song => song.id).sort())
        expect(rows().find(song => song.path === one.path)?.present).toBe(false)
    })

    it.each(['source', 'destination'])(
        'leaves ambiguous %s matches separate across discovery batches',
        async side => {
            discover([metadata('/old/one.mp3')], first)
            if (side === 'source') discover([metadata('/old/two.mp3')], first)
            discover([metadata('/new/one.mp3')], next)
            if (side === 'destination') discover([metadata('/new/two.mp3')], next)
            await finish(next)
            expect(rows()).toHaveLength(3)
        },
    )

    it('does not use an old hash after discovery observed a file change that failed its deep read', async () => {
        discover([metadata('/music/original.mp3')], first)
        repository.processPrescanBatch(
            [{ ...fact(metadata('/music/original.mp3')), modifiedAt: 2_000 }],
            new Date(15_000),
        )
        discover([metadata('/external/original.mp3')], next)
        await finish(next)
        expect(rows()).toHaveLength(2)
    })

    it('preserves dismissed issues and user references on the original identity', async () => {
        const oldSong = metadata('/music/original.mp3', { artist: 'First; Second' })
        discover([oldSong], first)
        const original = rows().at(0)
        if (!original) throw new Error('Expected an imported song')
        const issues = database.db.select().from(normalizationIssuesTable).all()
        expect(issues.length).toBeGreaterThan(0)
        database.db.update(normalizationIssuesTable).set({ status: 'DISMISSED', closedAt: first }).run()
        database.db
            .update(songsTable)
            .set({ externalRefs: { MUSICBRAINZ_RECORDING_ID: ['user-reference'] } })
            .run()
        discover([{ ...oldSong, path: '/new/original.mp3' }], next)
        await finish(next)
        expect(rows()).toEqual([
            expect.objectContaining({
                id: original.id,
                externalRefs: { MUSICBRAINZ_RECORDING_ID: ['user-reference'] },
            }),
        ])
        expect(database.db.select().from(normalizationIssuesTable).all()).toEqual(
            issues.map(issue =>
                expect.objectContaining({ id: issue.id, entityId: original.id, status: 'DISMISSED' }),
            ),
        )
    })

    it('recomputes the album cover after removing the old path', async () => {
        discover([metadata('/old/song.mp3', { albumTitle: 'Album', coverPath: '/aaa.jpg' })], first)
        discover([metadata('/new/song.mp3', { albumTitle: 'Album', coverPath: '/zzz.jpg' })], next)
        expect(
            new LibraryBrowseRepository(database.client).getAlbumDetail(
                database.db.select().from(albumsTable).get()?.id ?? '',
            )?.coverPath,
        ).toBe('/aaa.jpg')
        await finish(next)
        expect(
            new LibraryBrowseRepository(database.client).getAlbumDetail(
                database.db.select().from(albumsTable).get()?.id ?? '',
            )?.coverPath,
        ).toBe('/zzz.jpg')
    })

    it('removes an empty old album when a moved file gets a new album from the extractor', async () => {
        discover([metadata('/old/song.mp3', { albumTitle: 'Old album' })], first)
        const identity = rows()[0]?.id
        discover([metadata('/new/song.mp3', { albumTitle: 'Corrected album' })], next)
        await finish(next)
        expect(rows()[0]?.id).toBe(identity)
        expect(database.db.select().from(albumsTable).all()).toEqual([
            expect.objectContaining({ title: 'Corrected album' }),
        ])
    })
})

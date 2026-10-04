import { newPrescanFactFixture } from '../../../test/fixtures/prescan-fact.fixture'
import { LibraryBrowseRepository } from './library-browse.repository'
import { PrescanFileFact, SongMetadata } from '@release-maestro/core'
import { basename } from 'node:path'
import { eq } from 'drizzle-orm'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { albumsTable, normalizationIssuesTable, songsTable } from '../../database/drizzle.schema'
import { LibraryBackendRepository } from './library.backend.repository'

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
    const finish = (seenAt: Date) => {
        for (const candidate of repository.findMovedSongCandidates(seenAt)) {
            repository.reconcileMovedSong(candidate)
        }
        return repository.markNotSeenPresent(seenAt)
    }
    const rows = () => database.db.select().from(songsTable).all()

    beforeEach(() => {
        database = createMigratedTestDatabase()
        repository = new LibraryBackendRepository(database.client)
    })
    afterEach(() => database.sqlite.close())

    it.each([false, true])('preserves identity when moved, previously missing: %s', previouslyMissing => {
        discover([metadata('/music/original.mp3')], first)
        const original = rows().at(0)
        if (!original) throw new Error('Expected an imported song')
        if (previouslyMissing) repository.markNotSeenPresent(new Date(15_000))
        discover([metadata('/external/renamed.mp3')], next)
        expect(finish(next)).toBe(0)
        expect(rows()).toEqual([
            expect.objectContaining({
                id: original.id,
                addedAt: original.addedAt,
                path: '/external/renamed.mp3',
                present: true,
            }),
        ])
        discover([metadata('/external/renamed.mp3')], new Date(30_000))
        expect(finish(new Date(30_000))).toBe(0)
        expect(rows()).toHaveLength(1)
        expect(rows()[0]?.id).toBe(original.id)
    })

    it('recognizes an untagged rename using bytes even when the filename-derived title changes', () => {
        discover([metadata('/music/one.wav', { title: 'one.wav', artist: null })], first)
        const original = rows().at(0)
        if (!original) throw new Error('Expected an imported song')
        discover([metadata('/music/two.wav', { title: 'two.wav', artist: null })], next)
        finish(next)
        expect(rows()).toEqual([expect.objectContaining({ id: original.id, title: 'two.wav' })])
    })

    it('matches a missing pre-upgrade song using unique stored metadata and size', () => {
        discover([metadata('/music/original.mp3')], first)
        const original = rows().at(0)
        if (!original) throw new Error('Expected an imported song')
        database.db.update(songsTable).set({ contentHash: null, firstSeenAt: null }).run()
        repository.markNotSeenPresent(new Date(15_000))
        discover([metadata('/external/original.mp3')], next)
        finish(next)
        expect(rows()).toEqual([expect.objectContaining({ id: original.id, contentHash: 'a'.repeat(64) })])
    })

    it.each([true, false])(
        'only omits new disc fields when the original has pre-upgrade evidence: %s',
        legacy => {
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
            finish(next)
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

    it('repairs a unique missing/present pair left by an interrupted scan without another deep read', () => {
        discover([metadata('/music/original.mp3')], first)
        const original = rows().at(0)
        if (!original) throw new Error('Expected an imported song')
        repository.markNotSeenPresent(new Date(15_000))
        discover([metadata('/external/original.mp3')], next)
        database.db.update(songsTable).set({ contentHash: null }).where(eq(songsTable.id, original.id)).run()
        const resumedAt = new Date(30_000)
        repository.processPrescanBatch([fact(metadata('/external/original.mp3'))], resumedAt)
        finish(resumedAt)
        expect(rows()).toEqual([expect.objectContaining({ id: original.id, present: true })])
    })

    it('keeps discovery chronology separate from Added after an interrupted initial import', () => {
        const oldSong = metadata('/music/original.mp3')
        repository.processPrescanBatch([fact(oldSong)], first, true)
        repository.ingestMetadata(oldSong, fact(oldSong), first, 'test-extractor')
        const original = rows()[0]
        if (!original) throw new Error('Expected an imported song')
        const moved = metadata('/music/renamed.mp3')
        repository.processPrescanBatch([fact(moved)], next, true)
        repository.ingestMetadata(moved, fact(moved), next, 'test-extractor')
        finish(next)
        expect(rows()).toEqual([
            expect.objectContaining({
                id: original.id,
                addedAt: new Date(500),
                path: moved.path,
            }),
        ])
    })

    it('retains a copy observed while its original was excluded, even after the original is deleted', () => {
        discover([metadata('/excluded/original.mp3')], first)
        const original = rows()[0]
        if (!original) throw new Error('Expected an imported song')
        discover([metadata('/included/copy.mp3')], next)
        repository.recordSongAvailable(original.id, next)
        finish(next)
        const copies = rows()
        discover([metadata('/included/copy.mp3')], new Date(30_000))
        finish(new Date(30_000))
        expect(
            rows()
                .map(song => song.id)
                .sort(),
        ).toEqual(copies.map(song => song.id).sort())
        expect(rows()).toHaveLength(2)
    })

    it('matches pre-upgrade folder moves when external artwork changes location', () => {
        discover([metadata('/old/original.mp3', { coverPath: '/old/cover.jpg' })], first)
        const original = rows()[0]
        if (!original) throw new Error('Expected an imported song')
        database.db.update(songsTable).set({ contentHash: null, firstSeenAt: null }).run()
        repository.markNotSeenPresent(new Date(15_000))
        discover([metadata('/new/original.mp3', { coverPath: '/new/cover.jpg' })], next)
        finish(next)
        expect(rows()).toEqual([
            expect.objectContaining({
                id: original.id,
                path: '/new/original.mp3',
                coverPath: '/new/cover.jpg',
            }),
        ])
    })

    it('retains legacy duplicates whose discovery order is unknown, even after repeated scans', () => {
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
            finish(seenAt)
            expect(
                rows()
                    .map(song => song.id)
                    .sort(),
            ).toEqual(originals)
            expect(rows().every(song => song.firstSeenAt === null)).toBe(true)
        }
    })

    it('does not merge different bytes that have identical metadata', () => {
        discover([metadata('/music/original.mp3')], first)
        discover([metadata('/external/other.mp3', { contentHash: 'b'.repeat(64) })], next)
        finish(next)
        expect(rows()).toHaveLength(2)
    })

    it('retains two real copies, including when one later becomes unavailable', () => {
        const one = metadata('/music/one.mp3')
        const two = metadata('/music/two.mp3')
        const copies = [one, two]
        discover(copies, first)
        const originals = rows()
        finish(first)
        discover([two], next)
        finish(next)
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
        side => {
            discover([metadata('/old/one.mp3')], first)
            if (side === 'source') discover([metadata('/old/two.mp3')], first)
            discover([metadata('/new/one.mp3')], next)
            if (side === 'destination') discover([metadata('/new/two.mp3')], next)
            finish(next)
            expect(rows()).toHaveLength(3)
        },
    )

    it('does not use an old hash after discovery observed a file change that failed its deep read', () => {
        discover([metadata('/music/original.mp3')], first)
        repository.processPrescanBatch(
            [{ ...fact(metadata('/music/original.mp3')), modifiedAt: 2_000 }],
            new Date(15_000),
        )
        discover([metadata('/external/original.mp3')], next)
        finish(next)
        expect(rows()).toHaveLength(2)
    })

    it('preserves dismissed issues and user references on the original identity', () => {
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
        finish(next)
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

    it('recomputes the album cover after removing the old path', () => {
        discover([metadata('/old/song.mp3', { albumTitle: 'Album', coverPath: '/aaa.jpg' })], first)
        discover([metadata('/new/song.mp3', { albumTitle: 'Album', coverPath: '/zzz.jpg' })], next)
        expect(
            new LibraryBrowseRepository(database.client).getAlbumDetail(
                database.db.select().from(albumsTable).get()?.id ?? '',
            )?.coverPath,
        ).toBe('/aaa.jpg')
        finish(next)
        expect(
            new LibraryBrowseRepository(database.client).getAlbumDetail(
                database.db.select().from(albumsTable).get()?.id ?? '',
            )?.coverPath,
        ).toBe('/zzz.jpg')
    })

    it('removes an empty old album when a moved file gets a new album from the extractor', () => {
        discover([metadata('/old/song.mp3', { albumTitle: 'Old album' })], first)
        const identity = rows()[0]?.id
        discover([metadata('/new/song.mp3', { albumTitle: 'Corrected album' })], next)
        finish(next)
        expect(rows()[0]?.id).toBe(identity)
        expect(database.db.select().from(albumsTable).all()).toEqual([
            expect.objectContaining({ title: 'Corrected album' }),
        ])
    })
})

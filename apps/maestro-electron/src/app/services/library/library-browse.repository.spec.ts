import {
    AlbumSortField,
    emptyAlbumQuery,
    emptySongQuery,
    ExternalRefKeys,
    SongPresence,
    SongSortField,
    type ExternalRefs,
    type AlbumQuery,
    type QueryAlbumsRequest,
    type SongQuery,
} from '@release-maestro/core'
import Database from 'better-sqlite3'
import { fromPartial } from '@total-typescript/shoehorn'
import { eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'fs'
import { join } from 'path'
import * as schema from '../../database/drizzle.schema'
import {
    albumArtistsTable,
    albumsTable,
    artistsTable,
    genresTable,
    recordLabelsTable,
    songArtistsTable,
    songGenresTable,
    songsTable,
} from '../../database/drizzle.schema'
import { LibraryBrowseRepository } from './library-browse.repository'

const migrationsFolderCandidates = [
    join(process.cwd(), 'drizzle'),
    join(__dirname, '../../../../../../drizzle'),
]
const migrationsFolder = migrationsFolderCandidates.find(candidate =>
    existsSync(join(candidate, 'meta', '_journal.json')),
)
if (!migrationsFolder) {
    throw new Error(`Could not locate drizzle migrations from ${migrationsFolderCandidates.join(', ')}`)
}

type SongSeed = {
    id: string
    title: string
    artistText?: string | null
    albumTitle?: string | null
    albumId?: string | null
    genreText?: string | null
    recordLabelText?: string | null
    externalRefs?: ExternalRefs
    year?: number | null
    bpm?: number | null
    musicalKey?: string | null
    duration?: number | null
    createdAt?: Date | null
    addedAt?: Date | null
    present?: boolean
    coverPath?: string | null
    trackNumber?: number | null
    discNumber?: number | null
    discTotal?: number | null
    trackTotal?: number | null
}

type AlbumSeed = {
    id: string
    title: string
    artistText?: string | null
    year?: number | null
    date?: string | null
    catalogNumber?: string | null
    coverPath?: string | null
    recordLabelId?: string | null
    recordLabelText?: string | null
    dateAdded?: Date | null
}

describe('LibraryBrowseRepository', () => {
    let sqlite: Database.Database
    let db: ReturnType<typeof drizzle<typeof schema>>
    let repository: LibraryBrowseRepository

    const seedSong = (seed: SongSeed) => {
        db.insert(songsTable)
            .values({
                id: seed.id,
                path: `/music/${seed.id}.flac`,
                fileName: `${seed.id}.flac`,
                size: 1_024,
                modifiedAt: new Date('2026-01-01T00:00:00Z'),
                createdAt: seed.createdAt === undefined ? new Date('2026-01-01T00:00:00Z') : seed.createdAt,
                addedAt: seed.addedAt === undefined ? new Date('2026-01-01T00:00:00Z') : seed.addedAt,
                fileFingerprint: `fingerprint-${seed.id}`,
                lastSeenAt: new Date('2026-01-01T00:00:00Z'),
                present: seed.present ?? true,
                title: seed.title,
                artistText: seed.artistText ?? null,
                albumTitle: seed.albumTitle ?? null,
                albumId: seed.albumId ?? null,
                genreText: seed.genreText ?? null,
                recordLabelText: seed.recordLabelText ?? null,
                externalRefs: seed.externalRefs ?? {},
                year: seed.year ?? null,
                bpm: seed.bpm ?? null,
                musicalKey: seed.musicalKey ?? null,
                duration: seed.duration ?? null,
                coverPath: seed.coverPath ?? null,
                trackNumber: seed.trackNumber ?? null,
                discNumber: seed.discNumber ?? null,
                discTotal: seed.discTotal ?? null,
                trackTotal: seed.trackTotal ?? null,
            })
            .run()
    }

    const seedAlbum = (seed: AlbumSeed) => {
        db.insert(albumsTable)
            .values({
                id: seed.id,
                identityKey: `identity-${seed.id}`,
                title: seed.title,
                artistText: seed.artistText ?? null,
                year: seed.year ?? null,
                date: seed.date ?? null,
                catalogNumber: seed.catalogNumber ?? null,
                coverPath: seed.coverPath ?? null,
                recordLabelId: seed.recordLabelId ?? null,
                recordLabelText: seed.recordLabelText ?? null,
                dateAdded: seed.dateAdded ?? null,
            })
            .run()
    }

    const query = (overrides: Partial<SongQuery> = {}): SongQuery => ({ ...emptySongQuery(), ...overrides })
    const albumQuery = (overrides: Partial<AlbumQuery> = {}): AlbumQuery => ({
        ...emptyAlbumQuery(),
        ...overrides,
    })
    const albumSearch = (search: string): QueryAlbumsRequest => ({
        query: albumQuery({ search }),
        window: { offset: 0, limit: 10 },
    })
    const titlesOf = (result: { rows: { title: string }[] }) => result.rows.map(row => row.title)

    beforeEach(() => {
        sqlite = new Database(':memory:')
        sqlite.pragma('foreign_keys = ON')
        db = drizzle(sqlite, { schema })
        migrate(db, { migrationsFolder })
        repository = new LibraryBrowseRepository({ db })
    })

    afterEach(() => sqlite.close())

    describe('artists', () => {
        beforeEach(() => {
            db.insert(artistsTable)
                .values([
                    { id: 'a1', name: 'Aurora Fields', externalRefs: { MUSICBRAINZ_ARTIST_ID: ['mb-1'] } },
                    { id: 'a2', name: 'Night Cartel' },
                    { id: 'a3', name: 'Night Cartel & Aurora Fields' },
                ])
                .run()
            db.insert(recordLabelsTable)
                .values([
                    { id: 'r1', name: 'Kosmische' },
                    { id: 'r2', name: 'Hardwire' },
                ])
                .run()
            seedAlbum({ id: 'own', title: 'Daybreak', recordLabelId: 'r1' })
            seedAlbum({ id: 'guest', title: 'Afterglow', recordLabelId: 'r2' })
            seedSong({ id: 's1', title: 'Dawn', albumId: 'own', year: 2019 })
            seedSong({ id: 's2', title: 'Noon', albumId: 'own', year: 2020 })
            seedSong({ id: 's3', title: 'Guest', albumId: 'guest', year: 2021 })
            seedSong({ id: 's4', title: 'Together', albumId: 'guest', year: 2022 })
            db.insert(albumArtistsTable)
                .values([
                    { albumId: 'own', artistId: 'a1', position: 0 },
                    { albumId: 'guest', artistId: 'a2', position: 0 },
                ])
                .run()
            db.insert(songArtistsTable)
                .values([
                    { songId: 's1', artistId: 'a1', position: 0 },
                    { songId: 's2', artistId: 'a1', position: 0 },
                    { songId: 's3', artistId: 'a1', position: 0 },
                    { songId: 's4', artistId: 'a3', position: 0 },
                ])
                .run()
        })

        it('windows, filters and sorts artists with distinct credit counts', () => {
            const query = { search: 'Aurora', sort: { field: 'name' as const, direction: 'asc' as const } }
            const result = repository.queryArtists({ query, window: { offset: 0, limit: 1 } })
            expect(result.total).toBe(2)
            expect(result.rows).toEqual([
                {
                    id: 'a1',
                    name: 'Aurora Fields',
                    songCount: 3,
                    albumCount: 1,
                    firstYear: 2019,
                    lastYear: 2021,
                },
            ])
            expect(
                repository.queryArtists({
                    query: { ...query, sort: { field: 'name', direction: 'desc' } },
                    window: { offset: 0, limit: 1 },
                }).rows[0]?.id,
            ).toBe('a3')
        })

        it('separates own albums from appearances and uses only own albums for record labels', () => {
            db.update(songsTable)
                .set({
                    artistText: 'Aurora Fields',
                    externalRefs: { MUSICBRAINZ_ARTIST_ID: ['mb-1'] },
                })
                .where(eq(songsTable.id, 's1'))
                .run()
            const detail = repository.getArtistDetail('a1')
            expect(detail).toMatchObject({
                albumCount: 1,
                appearanceCount: 1,
                recordLabelCount: 1,
                externalRefs: { MUSICBRAINZ_ARTIST_ID: ['mb-1'] },
            })
            expect(repository.getArtistDetail('missing')).toBeNull()
            const window = { offset: 0, limit: 10 }
            const own = repository.queryAlbums({
                query: albumQuery({ filter: { albumArtistIds: ['a1'] } }),
                window,
            })
            const appearances = repository.queryAlbums({
                query: albumQuery({ appearanceArtistId: 'a1' }),
                window,
            })
            expect(titlesOf(own)).toEqual(['Daybreak'])
            expect(titlesOf(appearances)).toEqual(['Afterglow'])
            expect(repository.queryArtistRecordLabels('a1', window)).toEqual({
                rows: [{ id: 'r1', name: 'Kosmische' }],
                offset: 0,
                total: 1,
            })
            seedSong({ id: 'albumless', title: 'Loose track' })
            db.insert(songArtistsTable).values({ songId: 'albumless', artistId: 'a1', position: 0 }).run()
            expect(repository.getArtistDetail('a1')?.appearanceCount).toBe(1)
        })

        it.each([ExternalRefKeys.MusicBrainzAlbumArtistId, ExternalRefKeys.MusicBrainzReleaseArtistId])(
            'does not expose stored track-artist refs on a different album artist with %s',
            albumArtistRefKey => {
                db.update(albumsTable)
                    .set({ artistText: 'Night Cartel' })
                    .where(eq(albumsTable.id, 'guest'))
                    .run()
                db.update(songsTable)
                    .set({
                        artistText: 'Aurora Fields',
                        externalRefs: {
                            MUSICBRAINZ_ARTIST_ID: ['track-id'],
                            [albumArtistRefKey]: ['album-id'],
                            DISCOGS_ARTIST_LINK: ['https://www.discogs.com/artist/123'],
                        },
                    })
                    .where(eq(songsTable.id, 's3'))
                    .run()
                db.update(artistsTable)
                    .set({ externalRefs: { MUSICBRAINZ_ARTIST_ID: ['stale-track-id'] } })
                    .where(eq(artistsTable.id, 'a2'))
                    .run()

                const detail = repository.getArtistDetail('a2')
                expect(detail).toMatchObject({
                    songCount: 0,
                    albumCount: 1,
                })
                expect(detail?.externalRefs).toEqual({
                    MUSICBRAINZ_ARTIST_ID: ['album-id'],
                })
            },
        )

        it('shows references for an artist resolved from a different raw credit', () => {
            db.update(songsTable)
                .set({
                    artistText: 'Aurora Fields alias',
                    externalRefs: {
                        MUSICBRAINZ_ARTIST_ID: ['alias-track-id', 'second-track-id'],
                        MUSICBRAINZ_RECORDING_ID: ['recording-id'],
                    },
                })
                .where(eq(songsTable.id, 's1'))
                .run()
            db.update(songsTable)
                .set({ externalRefs: { MUSICBRAINZ_ARTIST_ID: ['alias-track-id'] } })
                .where(eq(songsTable.id, 's2'))
                .run()
            db.update(albumsTable)
                .set({ artistText: 'Night Cartel alias' })
                .where(eq(albumsTable.id, 'guest'))
                .run()
            db.update(songsTable)
                .set({ externalRefs: { MUSICBRAINZ_ALBUM_ARTIST_ID: ['alias-album-id'] } })
                .where(eq(songsTable.id, 's3'))
                .run()

            expect(repository.getArtistDetail('a1')?.externalRefs).toEqual({
                MUSICBRAINZ_ARTIST_ID: ['alias-track-id', 'second-track-id'],
            })
            expect(repository.getArtistDetail('a2')?.externalRefs).toEqual({
                MUSICBRAINZ_ARTIST_ID: ['alias-album-id'],
            })
        })

        it('does not assign a shared raw credit reference to every resolved artist', () => {
            db.update(songsTable)
                .set({
                    artistText: 'Night Cartel & Aurora Fields',
                    externalRefs: { MUSICBRAINZ_ARTIST_ID: ['shared-id'] },
                })
                .where(eq(songsTable.id, 's4'))
                .run()
            db.insert(songArtistsTable).values({ songId: 's4', artistId: 'a1', position: 1 }).run()

            expect(repository.getArtistDetail('a3')?.externalRefs).toEqual({})
            expect(repository.getArtistDetail('a1')?.externalRefs).toEqual({})
        })

        it.each([ExternalRefKeys.MusicBrainzAlbumArtistId, ExternalRefKeys.MusicBrainzReleaseArtistId])(
            'does not assign a shared album-artist reference to every resolved artist with %s',
            albumArtistRefKey => {
                db.update(albumsTable)
                    .set({ artistText: 'Aurora Fields & Night Cartel' })
                    .where(eq(albumsTable.id, 'own'))
                    .run()
                db.update(songsTable)
                    .set({ externalRefs: { [albumArtistRefKey]: ['shared-album-id'] } })
                    .where(eq(songsTable.id, 's1'))
                    .run()
                db.insert(albumArtistsTable).values({ albumId: 'own', artistId: 'a2', position: 1 }).run()

                expect(repository.getArtistDetail('a1')?.externalRefs).toEqual({})
                expect(repository.getArtistDetail('a2')?.externalRefs).toEqual({})
            },
        )

        it("uses dated songs on own albums for an album-only artist's years", () => {
            const result = repository.queryArtists({
                query: { search: 'Night Cartel', sort: { field: 'name', direction: 'asc' } },
                window: { offset: 0, limit: 10 },
            })
            expect(result.rows[0]).toMatchObject({
                id: 'a2',
                songCount: 0,
                albumCount: 1,
                firstYear: 2021,
                lastYear: 2022,
            })
            expect(repository.getArtistDetail('a2')).toMatchObject({ firstYear: 2021, lastYear: 2022 })
        })
    })

    describe('record labels', () => {
        it('windows names and derives distinct stats from linked albums and songs', () => {
            db.insert(recordLabelsTable)
                .values([
                    { id: 'a', name: '100% Records', externalRefs: { MUSICBRAINZ_LABEL_ID: ['mb-1'] } },
                    { id: 'b', name: 'Other Records' },
                ])
                .run()
            db.insert(artistsTable)
                .values([
                    { id: 'artist', name: 'Artist' },
                    { id: 'album-artist', name: 'Album artist' },
                ])
                .run()
            seedAlbum({ id: 'album1', title: 'One', recordLabelId: 'a', year: 2018 })
            seedAlbum({ id: 'album2', title: 'Two', recordLabelId: 'a', year: 2024 })
            seedAlbum({ id: 'album3', title: 'Other', recordLabelId: 'b', year: 2020 })
            db.insert(albumArtistsTable)
                .values({ albumId: 'album2', artistId: 'album-artist', position: 0 })
                .run()
            seedSong({ id: 'song1', title: 'First', albumId: 'album1', recordLabelText: 'Wrong text' })
            seedSong({
                id: 'song2',
                title: 'Second',
                albumId: 'album2',
                recordLabelText: '100% Records',
                externalRefs: { MUSICBRAINZ_LABEL_ID: ['mb-1'] },
                present: false,
            })
            db.insert(songArtistsTable)
                .values([
                    { songId: 'song1', artistId: 'artist', position: 0 },
                    { songId: 'song2', artistId: 'artist', position: 0 },
                ])
                .run()
            const recordLabelQuery = { search: '', sort: { field: 'name', direction: 'asc' } } as const
            expect(
                repository.queryRecordLabels({ query: recordLabelQuery, window: { offset: 0, limit: 1 } }),
            ).toEqual({
                offset: 0,
                total: 2,
                rows: [
                    {
                        id: 'a',
                        name: '100% Records',
                        albumCount: 2,
                        songCount: 2,
                        artistCount: 2,
                        firstYear: 2018,
                        lastYear: 2024,
                    },
                ],
            })
            expect(
                repository.queryRecordLabels({
                    query: { ...recordLabelQuery, search: '%' },
                    window: { offset: 0, limit: 10 },
                }).total,
            ).toBe(1)
            expect(
                repository.queryRecordLabels({
                    query: { ...recordLabelQuery, sort: { field: 'name', direction: 'desc' } },
                    window: { offset: 0, limit: 1 },
                }).rows[0]?.id,
            ).toBe('b')
            expect(repository.getRecordLabelDetail('a')?.externalRefs).toEqual({
                MUSICBRAINZ_LABEL_ID: ['mb-1'],
            })
            expect(repository.getRecordLabelDetail('missing')).toBeNull()
            expect(
                repository.queryRecordLabelArtists({ recordLabelId: 'a', window: { offset: 0, limit: 2 } }),
            ).toEqual({
                offset: 0,
                total: 2,
                rows: [
                    {
                        id: 'album-artist',
                        name: 'Album artist',
                        hasSongCredits: false,
                        hasAlbumCredits: true,
                    },
                    { id: 'artist', name: 'Artist', hasSongCredits: true, hasAlbumCredits: false },
                ],
            })
            expect(
                repository
                    .querySongs({
                        query: query({ filter: { recordLabelIds: ['a'] } }),
                        window: { offset: 0, limit: 10 },
                    })
                    .rows.map(row => row.id)
                    .sort(),
            ).toEqual(['song1', 'song2'])
        })

        it('uses current song tags for record label links after references change or disappear', () => {
            db.insert(recordLabelsTable)
                .values({
                    id: 'label',
                    name: 'Kosmische',
                    externalRefs: { BANDCAMP_LABEL_URL: ['https://old.bandcamp.com'] },
                })
                .run()
            seedSong({
                id: 'song',
                title: 'Track',
                recordLabelText: 'Kosmische',
                externalRefs: { BANDCAMP_LABEL_URL: ['https://new.bandcamp.com'] },
            })
            expect(repository.getRecordLabelDetail('label')?.externalRefs).toEqual({
                BANDCAMP_LABEL_URL: ['https://new.bandcamp.com'],
            })

            db.update(songsTable)
                .set({ externalRefs: { BEATPORT_LABEL_URL: ['https://www.beatport.com/label/kosmische'] } })
                .where(eq(songsTable.id, 'song'))
                .run()
            expect(repository.getRecordLabelDetail('label')?.externalRefs).toEqual({
                BEATPORT_LABEL_URL: ['https://www.beatport.com/label/kosmische'],
            })

            db.update(songsTable).set({ externalRefs: {} }).where(eq(songsTable.id, 'song')).run()
            expect(repository.getRecordLabelDetail('label')?.externalRefs).toEqual({})
        })

        it('marks artists with both album and song credits on a record label', () => {
            db.insert(recordLabelsTable).values({ id: 'label', name: 'Kosmische' }).run()
            db.insert(artistsTable).values({ id: 'artist', name: 'Both credits' }).run()
            seedAlbum({ id: 'album1', title: 'Own album', recordLabelId: 'label' })
            seedAlbum({ id: 'album2', title: 'Appearance', recordLabelId: 'label' })
            db.insert(albumArtistsTable).values({ albumId: 'album1', artistId: 'artist', position: 0 }).run()
            seedSong({ id: 'song', title: 'Track', albumId: 'album2' })
            db.insert(songArtistsTable).values({ songId: 'song', artistId: 'artist', position: 0 }).run()

            expect(
                repository.queryRecordLabelArtists({
                    recordLabelId: 'label',
                    window: { offset: 0, limit: 10 },
                }).rows,
            ).toEqual([{ id: 'artist', name: 'Both credits', hasSongCredits: true, hasAlbumCredits: true }])
        })

        it('takes years from song tags when an album has no year of its own', () => {
            db.insert(recordLabelsTable).values({ id: 'a', name: 'Kosmische' }).run()
            seedAlbum({ id: 'undated', title: 'Undated', recordLabelId: 'a' })
            seedAlbum({ id: 'dated', title: 'Dated', recordLabelId: 'a', year: 2015 })
            seedSong({ id: 'song1', title: 'Early', albumId: 'undated', year: 2011 })
            seedSong({ id: 'song2', title: 'Late', albumId: 'undated', year: 2013 })
            seedSong({ id: 'song3', title: 'Untagged', albumId: 'dated' })
            expect(repository.getRecordLabelDetail('a')).toMatchObject({ firstYear: 2011, lastYear: 2015 })
        })
    })

    describe('genres', () => {
        beforeEach(() => {
            db.insert(genresTable)
                .values([
                    { id: 'ambient', name: 'Ambient' },
                    { id: 'techno', name: 'Techno' },
                    { id: 'compound', name: 'Techno; Ambient' },
                    { id: 'empty', name: '100% Quiet' },
                ])
                .run()
            db.insert(artistsTable)
                .values([
                    { id: 'a1', name: 'Artist one' },
                    { id: 'a2', name: 'Artist two' },
                ])
                .run()
            db.insert(recordLabelsTable)
                .values([{ id: 'r1', name: 'Record label' }])
                .run()
            seedAlbum({ id: 'album1', title: 'Album one', recordLabelId: 'r1' })
            seedAlbum({ id: 'album2', title: 'Album two' })
            seedSong({
                id: 's1',
                title: 'First',
                albumId: 'album1',
                genreText: 'Techno; Ambient',
                recordLabelText: 'Record label',
            })
            seedSong({
                id: 's2',
                title: 'Missing',
                albumId: 'album1',
                present: false,
                recordLabelText: 'Record label',
            })
            seedSong({ id: 's3', title: 'Unsplit', albumId: 'album2', genreText: 'Techno; Ambient' })
            db.insert(songGenresTable)
                .values([
                    { songId: 's1', genreId: 'ambient' },
                    { songId: 's1', genreId: 'techno' },
                    { songId: 's2', genreId: 'ambient' },
                    { songId: 's3', genreId: 'compound' },
                ])
                .run()
            db.insert(songArtistsTable)
                .values([
                    { songId: 's1', artistId: 'a1', position: 0 },
                    { songId: 's1', artistId: 'a2', position: 1 },
                    { songId: 's2', artistId: 'a1', position: 0 },
                ])
                .run()
        })

        it('counts distinct related entities without multiplying tracks by credits, including missing files', () => {
            expect(repository.getGenreDetail('ambient')).toEqual({
                id: 'ambient',
                name: 'Ambient',
                songCount: 2,
                artistCount: 2,
                albumCount: 1,
                recordLabelCount: 1,
            })
            expect(repository.getGenreDetail('empty')).toEqual({
                id: 'empty',
                name: '100% Quiet',
                songCount: 0,
                artistCount: 0,
                albumCount: 0,
                recordLabelCount: 0,
            })
            expect(repository.getGenreDetail('gone')).toBeNull()
        })

        it('lists and counts song record labels that lead to matching genre tracks despite album drift', () => {
            db.insert(recordLabelsTable)
                .values([
                    { id: 'song-label', name: 'Song record label' },
                    { id: 'albumless-label', name: 'Albumless record label' },
                ])
                .run()
            seedSong({ id: 'drift', title: 'Drift', albumId: 'album1', recordLabelText: 'Song record label' })
            seedSong({
                id: 'albumless',
                title: 'Albumless',
                recordLabelText: 'Albumless record label',
                present: false,
            })
            seedSong({ id: 'no-label', title: 'No record label', albumId: 'album1' })
            db.insert(songGenresTable)
                .values([
                    { songId: 'drift', genreId: 'compound' },
                    { songId: 'albumless', genreId: 'compound' },
                    { songId: 'no-label', genreId: 'compound' },
                ])
                .run()

            const related = repository.queryGenreRelated({
                query: { genreId: 'compound', kind: 'recordLabels' },
                window: { offset: 0, limit: 10 },
            })
            expect(related).toEqual({
                offset: 0,
                total: 2,
                rows: [
                    { id: 'albumless-label', name: 'Albumless record label' },
                    { id: 'song-label', name: 'Song record label' },
                ],
            })
            expect(repository.getGenreDetail('compound')).toMatchObject({
                songCount: 4,
                albumCount: 2,
                recordLabelCount: 2,
            })
            for (const recordLabel of related.rows) {
                const songs = repository.querySongs({
                    query: query({ filter: { genreIds: ['compound'], recordLabelIds: [recordLabel.id] } }),
                    window: { offset: 0, limit: 10 },
                })
                expect(songs.total).toBe(1)
                expect(songs.rows[0]).toMatchObject({
                    recordLabelId: recordLabel.id,
                    recordLabelText: recordLabel.name,
                })
            }
        })

        it('windows genres in both name directions and searches literal wildcards', () => {
            const query = { search: '', sort: { field: 'name', direction: 'asc' } } as const
            expect(repository.queryGenres({ query, window: { offset: 1, limit: 2 } })).toEqual({
                offset: 1,
                total: 4,
                rows: [
                    { id: 'ambient', name: 'Ambient', songCount: 2, artistCount: 2, albumCount: 1 },
                    { id: 'techno', name: 'Techno', songCount: 1, artistCount: 2, albumCount: 1 },
                ],
            })
            expect(
                repository.queryGenres({
                    query: { ...query, sort: { field: 'name', direction: 'desc' } },
                    window: { offset: 0, limit: 1 },
                }).rows[0]?.name,
            ).toBe('Techno; Ambient')
            expect(
                repository
                    .queryGenres({ query: { ...query, search: '%' }, window: { offset: 0, limit: 10 } })
                    .rows.map(row => row.name),
            ).toEqual(['100% Quiet'])
            expect(repository.queryGenres({ query, window: { offset: 10, limit: 5 } })).toEqual({
                offset: 10,
                total: 4,
                rows: [],
            })
        })

        it('derives related lists by entity and keeps the compound tag separate', () => {
            expect(
                repository.queryGenreRelated({
                    query: { genreId: 'ambient', kind: 'artists' },
                    window: { offset: 0, limit: 1 },
                }),
            ).toEqual({
                offset: 0,
                total: 2,
                rows: [{ id: 'a1', name: 'Artist one' }],
            })
            expect(
                repository
                    .queryAlbums({
                        query: albumQuery({ filter: { genreIds: ['ambient'] } }),
                        window: { offset: 0, limit: 10 },
                    })
                    .rows.map(row => row.id),
            ).toEqual(['album1'])

            expect(
                repository.queryGenreRelated({
                    query: { genreId: 'ambient', kind: 'recordLabels' },
                    window: { offset: 0, limit: 10 },
                }).rows,
            ).toEqual([{ id: 'r1', name: 'Record label' }])
            const songs = repository.querySongs({
                query: query({ filter: { genreIds: ['ambient'] } }),
                window: { offset: 0, limit: 10 },
            })
            expect(songs.rows.map(row => row.id).sort()).toEqual(['s1', 's2'])
            expect(songs.rows.find(row => row.id == 's1')?.genreText).toBe('Techno; Ambient')
        })
    })

    describe('windowing', () => {
        beforeEach(() => {
            for (let index = 0; index < 25; index++) {
                seedSong({ id: `song-${index.toString().padStart(2, '0')}`, title: `Track ${index}` })
            }
        })

        it('returns only the requested window, with the total of the whole query', () => {
            const result = repository.querySongs({
                query: query({ sort: { field: SongSortField.title, direction: 'asc' } }),
                window: { offset: 10, limit: 5 },
            })

            expect(result.total).toBe(25)
            expect(result.offset).toBe(10)
            expect(result.rows).toHaveLength(5)
        })

        it('slides the window without repeating or dropping a row when sort values tie', () => {
            // Every row here has a null BPM, so the sort column alone cannot order
            // them — only the id tiebreaker makes consecutive windows disjoint.
            const sort = { field: SongSortField.bpm, direction: 'asc' } as const
            const first = repository.querySongs({ query: query({ sort }), window: { offset: 0, limit: 10 } })
            const second = repository.querySongs({
                query: query({ sort }),
                window: { offset: 10, limit: 10 },
            })
            const third = repository.querySongs({ query: query({ sort }), window: { offset: 20, limit: 10 } })

            const windowed = [...first.rows, ...second.rows, ...third.rows].map(row => row.id)
            expect(new Set(windowed).size).toBe(25)
            expect(windowed).toHaveLength(25)
        })

        it('returns an empty window past the end rather than failing', () => {
            const result = repository.querySongs({ query: query(), window: { offset: 900, limit: 10 } })

            expect(result).toMatchObject({ rows: [], offset: 900, total: 25 })
        })

        it('clamps a window that asks for more rows than the ceiling allows', () => {
            const result = repository.querySongs({ query: query(), window: { offset: -5, limit: 10_000 } })

            expect(result.offset).toBe(0)
            expect(result.rows).toHaveLength(25)
        })
    })

    describe('sorting', () => {
        beforeEach(() => {
            seedSong({ id: 'a', title: 'Archangel', bpm: 138, year: 2007, duration: 237 })
            seedSong({ id: 'b', title: 'Moth', bpm: 134, year: 2009, duration: 372 })
            seedSong({ id: 'c', title: 'Wolf Cub', bpm: 130, year: 2009, duration: 460 })
        })

        it.each([
            [SongSortField.title, 'asc', ['Archangel', 'Moth', 'Wolf Cub']],
            [SongSortField.title, 'desc', ['Wolf Cub', 'Moth', 'Archangel']],
            [SongSortField.bpm, 'asc', ['Wolf Cub', 'Moth', 'Archangel']],
            [SongSortField.duration, 'desc', ['Wolf Cub', 'Moth', 'Archangel']],
        ] as const)('sorts by %s %s', (field, direction, expected) => {
            const result = repository.querySongs({
                query: query({ sort: { field, direction } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(expected)
        })

        it('sorts by when the song entered the library', () => {
            seedSong({
                id: 'd',
                title: 'Newest',
                createdAt: new Date('2011-01-01T00:00:00Z'),
                addedAt: new Date('2026-07-01T00:00:00Z'),
            })

            const result = repository.querySongs({
                query: query({ sort: { field: SongSortField.dateAdded, direction: 'desc' } }),
                window: { offset: 0, limit: 1 },
            })

            expect(titlesOf(result)).toEqual(['Newest'])
            expect(result.rows[0]?.dateAdded).toBe(new Date('2026-07-01T00:00:00Z').getTime())
        })
    })

    describe('filtering by entity', () => {
        beforeEach(() => {
            db.insert(artistsTable).values({ id: 'artist-burial', name: 'Burial' }).run()
            db.insert(artistsTable).values({ id: 'artist-four-tet', name: 'Four Tet' }).run()
            db.insert(genresTable).values({ id: 'genre-garage', name: 'UK Garage' }).run()
            db.insert(recordLabelsTable).values({ id: 'label-hyperdub', name: 'Hyperdub' }).run()
            db.insert(albumsTable)
                .values({
                    id: 'album-untrue',
                    identityKey: 'untrue',
                    title: 'Untrue',
                    recordLabelId: 'label-hyperdub',
                })
                .run()

            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue', recordLabelText: 'Hyperdub' })
            seedSong({ id: 'b', title: 'Moth' })
            seedSong({ id: 'c', title: 'Wolf Cub' })

            db.insert(songArtistsTable).values({ songId: 'a', artistId: 'artist-burial' }).run()
            db.insert(songArtistsTable).values({ songId: 'b', artistId: 'artist-burial' }).run()
            db.insert(songArtistsTable)
                .values({ songId: 'b', artistId: 'artist-four-tet', position: 1 })
                .run()
            db.insert(songGenresTable).values({ songId: 'a', genreId: 'genre-garage' }).run()
        })

        it('matches songs through the artist join table, not through artist text', () => {
            const result = repository.querySongs({
                query: query({ filter: { artistIds: ['artist-four-tet'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Moth'])
        })

        it('counts a song once when it matches several of the selected artists', () => {
            const result = repository.querySongs({
                query: query({ filter: { artistIds: ['artist-burial', 'artist-four-tet'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(result.total).toBe(2)
            expect(result.rows).toHaveLength(2)
        })

        it('resolves the song record label from its own tag', () => {
            const result = repository.querySongs({
                query: query({ filter: { recordLabelIds: ['label-hyperdub'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Archangel'])
        })

        it('displays, sorts and filters the same record label despite album drift or no album', () => {
            db.insert(recordLabelsTable).values({ id: 'label-warp', name: 'Warp' }).run()
            seedSong({ id: 'd', title: 'Drift', albumId: 'album-untrue', recordLabelText: 'Warp' })
            seedSong({ id: 'e', title: 'No album', recordLabelText: 'Warp' })
            seedSong({ id: 'f', title: 'No record label', albumId: 'album-untrue' })
            const result = repository.querySongs({
                query: query({ sort: { field: SongSortField.recordLabel, direction: 'asc' } }),
                window: { offset: 0, limit: 10 },
            })
            expect(
                result.rows.filter(row => row.recordLabelText != null).map(row => row.recordLabelText),
            ).toEqual(['Hyperdub', 'Warp', 'Warp'])
            expect(result.rows.find(row => row.id == 'f')?.recordLabelId).toBeNull()
            expect(result.rows.find(row => row.id == 'd')).toMatchObject({
                recordLabelId: 'label-warp',
                recordLabelText: 'Warp',
            })
            const filtered = repository.querySongs({
                query: query({ filter: { recordLabelIds: ['label-warp', 'label-warp'] } }),
                window: { offset: 0, limit: 10 },
            })
            expect(filtered.total).toBe(2)
            expect(titlesOf(filtered).sort()).toEqual(['Drift', 'No album'])
        })

        it('filters by genre entity', () => {
            const result = repository.querySongs({
                query: query({ filter: { genreIds: ['genre-garage'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Archangel'])
        })

        it('ands across fields', () => {
            const result = repository.querySongs({
                query: query({ filter: { artistIds: ['artist-burial'], genreIds: ['genre-garage'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Archangel'])
        })

        it('treats an empty id list as unfiltered', () => {
            const result = repository.querySongs({
                query: query({ filter: { artistIds: [], genreIds: [] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(result.total).toBe(3)
        })
    })

    describe('missing songs', () => {
        beforeEach(() => {
            seedSong({ id: 'a', title: 'Here', present: true })
            seedSong({ id: 'b', title: 'Gone', present: false })
        })

        it('includes missing songs by default and exposes the flag per row', () => {
            const result = repository.querySongs({
                query: query({ sort: { field: SongSortField.title, direction: 'asc' } }),
                window: { offset: 0, limit: 10 },
            })

            expect(result.total).toBe(2)
            expect(result.rows.map(row => [row.title, row.present])).toEqual([
                ['Gone', false],
                ['Here', true],
            ])
        })

        it.each([
            [SongPresence.present, ['Here']],
            [SongPresence.missing, ['Gone']],
        ])('scopes to %s', (presence, expected) => {
            const result = repository.querySongs({
                query: query({ filter: { presence } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(expected)
        })
    })

    describe('search', () => {
        beforeEach(() => {
            seedSong({ id: 'a', title: 'Archangel', artistText: 'Burial', albumTitle: 'Untrue' })
            seedSong({ id: 'b', title: 'Moth', artistText: 'Burial & Four Tet', recordLabelText: 'Text' })
            seedSong({ id: 'c', title: '100% Silk', artistText: 'Someone' })
        })

        it.each([
            ['archangel', ['Archangel']],
            ['BURIAL', ['Archangel', 'Moth']],
            ['untrue', ['Archangel']],
            ['text', ['Moth']],
        ])('matches %s across title, artist, album and record label', (search, expected) => {
            const result = repository.querySongs({
                query: query({ search, sort: { field: SongSortField.title, direction: 'asc' } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(expected)
        })

        it('treats LIKE wildcards in the term as literal characters', () => {
            const result = repository.querySongs({
                query: query({ search: '100%' }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['100% Silk'])
        })

        it('treats an all-whitespace term as no search', () => {
            const result = repository.querySongs({
                query: query({ search: '   ' }),
                window: { offset: 0, limit: 10 },
            })

            expect(result.total).toBe(3)
        })
    })

    describe('artist credit', () => {
        it('renders a single credit as one segment carrying the artist text verbatim', () => {
            db.insert(artistsTable).values({ id: 'artist-1', name: 'Burial & Four Tet' }).run()
            seedSong({ id: 'a', title: 'Moth', artistText: 'Burial & Four Tet' })
            db.insert(songArtistsTable).values({ songId: 'a', artistId: 'artist-1' }).run()

            const result = repository.querySongs({ query: query(), window: { offset: 0, limit: 10 } })

            expect(result.rows[0]?.artistCredit).toEqual([
                { artistId: 'artist-1', creditedAs: 'Burial & Four Tet', joinPhrase: '' },
            ])
        })

        it('keeps segments in position order when a raw name resolved to several artists', () => {
            db.insert(artistsTable).values({ id: 'artist-burial', name: 'Burial' }).run()
            db.insert(artistsTable).values({ id: 'artist-four-tet', name: 'Four Tet' }).run()
            seedSong({ id: 'a', title: 'Moth', artistText: 'Burial & Four Tet' })
            db.insert(songArtistsTable)
                .values({ songId: 'a', artistId: 'artist-four-tet', position: 1 })
                .run()
            db.insert(songArtistsTable).values({ songId: 'a', artistId: 'artist-burial', position: 0 }).run()

            const result = repository.querySongs({ query: query(), window: { offset: 0, limit: 10 } })

            expect(result.rows[0]?.artistCredit.map(segment => segment.creditedAs)).toEqual([
                'Burial',
                'Four Tet',
            ])
        })

        it('gives an untagged song an empty credit rather than a placeholder artist', () => {
            seedSong({ id: 'a', title: 'Untagged', artistText: null })

            const result = repository.querySongs({ query: query(), window: { offset: 0, limit: 10 } })

            expect(result.rows[0]).toMatchObject({ artistText: null, artistCredit: [] })
        })
    })

    describe('describeSongFilter', () => {
        beforeEach(() => {
            db.insert(artistsTable).values({ id: 'artist-burial', name: 'Burial' }).run()
            db.insert(artistsTable).values({ id: 'artist-four-tet', name: 'Four Tet' }).run()
            db.insert(genresTable).values({ id: 'genre-garage', name: 'UK Garage' }).run()
        })

        it('resolves ids to names in the order they were requested', () => {
            const description = repository.describeSongFilter({
                artistIds: ['artist-four-tet', 'artist-burial'],
                genreIds: ['genre-garage'],
            })

            expect(description.artists).toEqual([
                { id: 'artist-four-tet', name: 'Four Tet' },
                { id: 'artist-burial', name: 'Burial' },
            ])
            expect(description.genres).toEqual([{ id: 'genre-garage', name: 'UK Garage' }])
            expect(description.recordLabels).toEqual([])
        })

        it('drops ids that no longer resolve, so a stale URL narrows instead of failing', () => {
            const description = repository.describeSongFilter({
                artistIds: ['artist-burial', 'artist-deleted'],
            })

            expect(description.artists).toEqual([{ id: 'artist-burial', name: 'Burial' }])
        })
    })

    describe('cover art', () => {
        beforeEach(() => {
            db.insert(albumsTable)
                .values({
                    id: 'album-untrue',
                    identityKey: 'untrue',
                    title: 'Untrue',
                    coverPath: '/covers/untrue.png',
                })
                .run()
        })

        it("prefers the song's own artwork", () => {
            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue', coverPath: '/covers/song.png' })

            const result = repository.querySongs({ query: query(), window: { offset: 0, limit: 10 } })

            expect(result.rows[0]?.coverPath).toBe('/covers/song.png')
        })

        it("falls back to the album's, because a track with no embedded art still has an album", () => {
            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue', coverPath: null })

            const result = repository.querySongs({ query: query(), window: { offset: 0, limit: 10 } })

            expect(result.rows[0]?.coverPath).toBe('/covers/untrue.png')
        })

        it('reports no artwork rather than an empty string when neither has any', () => {
            seedSong({ id: 'a', title: 'Archangel', coverPath: null })

            const result = repository.querySongs({ query: query(), window: { offset: 0, limit: 10 } })

            expect(result.rows[0]?.coverPath).toBeNull()
        })
    })

    // -----------------------------------------------------------------------
    // Albums — MAE-119
    // -----------------------------------------------------------------------

    describe('queryAlbums', () => {
        beforeEach(() => {
            db.insert(artistsTable).values({ id: 'artist-burial', name: 'Burial' }).run()
            db.insert(artistsTable).values({ id: 'artist-various', name: 'Various Artists' }).run()
            db.insert(genresTable).values({ id: 'genre-garage', name: 'UK Garage' }).run()
            db.insert(recordLabelsTable).values({ id: 'label-hyperdub', name: 'Hyperdub' }).run()
            db.insert(recordLabelsTable).values({ id: 'label-warp', name: 'Warp' }).run()

            seedAlbum({
                id: 'album-untrue',
                title: 'Untrue',
                artistText: 'Burial',
                year: 2007,
                recordLabelId: 'label-hyperdub',
                recordLabelText: 'Hyperdub',
                dateAdded: new Date('2026-05-01T00:00:00Z'),
            })
            seedAlbum({
                id: 'album-selected',
                title: 'Selected Ambient Works',
                artistText: 'Aphex Twin',
                year: 1992,
                recordLabelId: 'label-warp',
                recordLabelText: 'Warp',
                dateAdded: new Date('2026-02-01T00:00:00Z'),
            })

            db.insert(albumArtistsTable).values({ albumId: 'album-untrue', artistId: 'artist-burial' }).run()
        })

        it('returns a window of tiles and the total of the whole query', () => {
            const result = repository.queryAlbums({
                query: albumQuery(),
                window: { offset: 0, limit: 1 },
            })

            expect(result.rows).toHaveLength(1)
            expect(result.total).toBe(2)
        })

        it('sorts by the newest addition by default, not alphabetically', () => {
            const result = repository.queryAlbums({
                query: albumQuery(),
                window: { offset: 0, limit: 10 },
            })

            // Newest first. It is also the reverse of alphabetical, so the old
            // title-ascending default could not have produced it.
            expect(titlesOf(result)).toEqual(['Untrue', 'Selected Ambient Works'])
        })

        it('sorts by the denormalized date added', () => {
            const result = repository.queryAlbums({
                query: albumQuery({ sort: { field: AlbumSortField.dateAdded, direction: 'asc' } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Selected Ambient Works', 'Untrue'])
        })

        it('puts an album with no date at the bottom of the newest-first order', () => {
            // Reachable: `songs.created_at` is nullable, so a record whose files carry
            // no creation time has no date to stand on.
            seedAlbum({ id: 'album-undated', title: 'Untitled Tape', dateAdded: null })

            const result = repository.queryAlbums({
                query: albumQuery(),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result).at(-1)).toBe('Untitled Tape')
        })

        it('counts each tile’s tracks over the window rather than reading a stored column', () => {
            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue', recordLabelText: 'Hyperdub' })
            seedSong({ id: 'b', title: 'Near Dark', albumId: 'album-untrue' })
            seedSong({ id: 'c', title: 'Xtal', albumId: 'album-selected' })

            const result = repository.queryAlbums({
                query: albumQuery(),
                window: { offset: 0, limit: 10 },
            })

            expect(result.rows.map(row => [row.title, row.songCount])).toEqual([
                ['Untrue', 2],
                ['Selected Ambient Works', 1],
            ])
        })

        it('reports zero for an album no song points at any more', () => {
            const result = repository.queryAlbums({
                query: albumQuery(),
                window: { offset: 0, limit: 10 },
            })

            expect(result.rows.map(row => row.songCount)).toEqual([0, 0])
        })

        it('sorts by the denormalized record label', () => {
            const result = repository.queryAlbums({
                query: albumQuery({ sort: { field: AlbumSortField.recordLabel, direction: 'desc' } }),
                window: { offset: 0, limit: 10 },
            })

            // Descending — Warp before Hyperdub — so this differs from the default order.
            expect(titlesOf(result)).toEqual(['Selected Ambient Works', 'Untrue'])
        })

        it('matches album artists through the join table, not through artist text', () => {
            const result = repository.queryAlbums({
                query: albumQuery({ filter: { albumArtistIds: ['artist-burial'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Untrue'])
        })

        it('counts an album once when it is credited to several of the selected artists', () => {
            db.insert(albumArtistsTable)
                .values({ albumId: 'album-untrue', artistId: 'artist-various', position: 1 })
                .run()

            const result = repository.queryAlbums({
                query: albumQuery({ filter: { albumArtistIds: ['artist-burial', 'artist-various'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(result.total).toBe(1)
            expect(result.rows).toHaveLength(1)
        })

        it('filters by record label entity', () => {
            const result = repository.queryAlbums({
                query: albumQuery({ filter: { recordLabelIds: ['label-warp'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Selected Ambient Works'])
        })

        it('reaches a genre through the album’s songs', () => {
            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue', recordLabelText: 'Hyperdub' })
            db.insert(songGenresTable).values({ songId: 'a', genreId: 'genre-garage' }).run()

            const result = repository.queryAlbums({
                query: albumQuery({ filter: { genreIds: ['genre-garage'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Untrue'])
        })

        it('counts an album once when several of its songs carry the selected genre', () => {
            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue', recordLabelText: 'Hyperdub' })
            seedSong({ id: 'b', title: 'Near Dark', albumId: 'album-untrue' })
            db.insert(songGenresTable).values({ songId: 'a', genreId: 'genre-garage' }).run()
            db.insert(songGenresTable).values({ songId: 'b', genreId: 'genre-garage' }).run()

            const result = repository.queryAlbums({
                query: albumQuery({ filter: { genreIds: ['genre-garage'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(result.total).toBe(1)
        })

        it('searches title, album artist and record label', () => {
            expect(titlesOf(repository.queryAlbums(albumSearch('untr')))).toEqual(['Untrue'])
            expect(titlesOf(repository.queryAlbums(albumSearch('aphex')))).toEqual(['Selected Ambient Works'])
            expect(titlesOf(repository.queryAlbums(albumSearch('hyperdub')))).toEqual(['Untrue'])
        })

        it('searches the catalogue number, which is how a record is often asked for', () => {
            seedAlbum({ id: 'album-cat', title: 'Angels & Devils', catalogNumber: 'HDBLP009' })

            expect(titlesOf(repository.queryAlbums(albumSearch('hdblp009')))).toEqual(['Angels & Devils'])
        })

        it('reaches the track artists of the album’s songs, not just the sleeve credit', () => {
            // The point of the reach: on a compilation the artists are the record, and
            // none of them is the album artist.
            seedAlbum({ id: 'album-va', title: 'Hyperdub 5', artistText: 'Various Artists' })
            seedSong({ id: 'a', title: 'Kingdom', artistText: 'Cooly G', albumId: 'album-va' })

            expect(titlesOf(repository.queryAlbums(albumSearch('cooly')))).toEqual(['Hyperdub 5'])
        })

        it('reaches the genres of the album’s songs, which is the only place a genre is tagged', () => {
            seedSong({ id: 'a', title: 'Archangel', genreText: 'UK Garage', albumId: 'album-untrue' })

            expect(titlesOf(repository.queryAlbums(albumSearch('garage')))).toEqual(['Untrue'])
        })

        it('counts an album once when several of its songs match the term', () => {
            // The reach is an EXISTS rather than a join for this reason: a join would
            // return the album once per matching song and corrupt the total.
            seedSong({ id: 'a', title: 'Archangel', artistText: 'Burial', albumId: 'album-untrue' })
            seedSong({ id: 'b', title: 'Near Dark', artistText: 'Burial', albumId: 'album-untrue' })

            const result = repository.queryAlbums(albumSearch('burial'))

            expect(result.total).toBe(1)
            expect(result.rows).toHaveLength(1)
        })

        it('does not search the titles of the album’s songs', () => {
            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue', recordLabelText: 'Hyperdub' })

            expect(repository.queryAlbums(albumSearch('archangel')).total).toBe(0)
        })

        it('does not match a song on another album, or one on no album at all', () => {
            seedSong({ id: 'a', title: 'Kingdom', artistText: 'Cooly G', albumId: 'album-selected' })
            seedSong({ id: 'b', title: 'Stray', artistText: 'Ikonika', albumId: null })

            expect(titlesOf(repository.queryAlbums(albumSearch('cooly')))).toEqual(['Selected Ambient Works'])
            expect(repository.queryAlbums(albumSearch('ikonika')).total).toBe(0)
        })

        it('carries the album artists as entities', () => {
            const result = repository.queryAlbums({
                query: albumQuery({ filter: { albumArtistIds: ['artist-burial'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(result.rows[0]?.albumArtists).toEqual([{ id: 'artist-burial', name: 'Burial' }])
        })

        it('skips the row query when the window starts past the end', () => {
            const result = repository.queryAlbums({
                query: albumQuery(),
                window: { offset: 50, limit: 10 },
            })

            expect(result).toEqual({ rows: [], offset: 50, total: 2 })
        })
    })

    describe('describeAlbumFilter', () => {
        it('resolves ids to names and drops the ones that no longer exist', () => {
            db.insert(artistsTable).values({ id: 'artist-burial', name: 'Burial' }).run()
            db.insert(recordLabelsTable).values({ id: 'label-hyperdub', name: 'Hyperdub' }).run()

            const description = repository.describeAlbumFilter({
                albumArtistIds: ['artist-burial', 'artist-gone'],
                recordLabelIds: ['label-hyperdub'],
            })

            expect(description.albumArtists).toEqual([{ id: 'artist-burial', name: 'Burial' }])
            expect(description.recordLabels).toEqual([{ id: 'label-hyperdub', name: 'Hyperdub' }])
            expect(description.genres).toEqual([])
        })
    })

    describe('getAlbumDetail', () => {
        beforeEach(() => {
            db.insert(artistsTable).values({ id: 'artist-burial', name: 'Burial' }).run()
            db.insert(genresTable).values({ id: 'genre-garage', name: 'UK Garage' }).run()
            db.insert(genresTable).values({ id: 'genre-dubstep', name: 'Dubstep' }).run()
            db.insert(recordLabelsTable).values({ id: 'label-hyperdub', name: 'Hyperdub' }).run()

            seedAlbum({
                id: 'album-untrue',
                title: 'Untrue',
                artistText: 'Burial',
                year: 2007,
                date: '2007-11-05',
                catalogNumber: 'HDBCD002',
                coverPath: '/covers/untrue.png',
                recordLabelId: 'label-hyperdub',
                recordLabelText: 'Hyperdub',
            })
            db.insert(albumArtistsTable).values({ albumId: 'album-untrue', artistId: 'artist-burial' }).run()

            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue', duration: 240 })
            seedSong({ id: 'b', title: 'Near Dark', albumId: 'album-untrue', duration: 180 })
            db.insert(songGenresTable).values({ songId: 'a', genreId: 'genre-garage' }).run()
            db.insert(songGenresTable).values({ songId: 'b', genreId: 'genre-dubstep' }).run()
        })

        it('returns the album’s own attributes', () => {
            const detail = repository.getAlbumDetail('album-untrue')

            expect(detail).toMatchObject({
                id: 'album-untrue',
                title: 'Untrue',
                albumArtistText: 'Burial',
                year: 2007,
                date: '2007-11-05',
                catalogNumber: 'HDBCD002',
                coverPath: '/covers/untrue.png',
                recordLabelId: 'label-hyperdub',
                recordLabelText: 'Hyperdub',
                songCount: 2,
            })
        })

        it('sums the durations of its songs as a number', () => {
            expect(repository.getAlbumDetail('album-untrue')?.totalDuration).toBe(420)
        })

        it('reports no total duration when no song on the album has one', () => {
            seedAlbum({ id: 'album-bare', title: 'Bare' })
            seedSong({ id: 'c', title: 'Untimed', albumId: 'album-bare', duration: null })

            expect(repository.getAlbumDetail('album-bare')?.totalDuration).toBeNull()
        })

        it('collects the distinct genres across its songs', () => {
            expect(repository.getAlbumDetail('album-untrue')?.genres).toEqual([
                { id: 'genre-dubstep', name: 'Dubstep' },
                { id: 'genre-garage', name: 'UK Garage' },
            ])
        })

        it('carries the album artists as entities', () => {
            expect(repository.getAlbumDetail('album-untrue')?.albumArtists).toEqual([
                { id: 'artist-burial', name: 'Burial' },
            ])
        })

        it('returns null for an id that resolves to nothing, rather than throwing', () => {
            expect(repository.getAlbumDetail('album-gone')).toBeNull()
        })

        it('orders tracks by disc and reports tagged totals per disc and album', () => {
            seedAlbum({ id: 'album-multi', title: 'Double' })
            seedSong({
                id: 'disc-2-first',
                title: 'Disc 2 First',
                albumId: 'album-multi',
                discNumber: 2,
                discTotal: 2,
                trackNumber: 1,
                trackTotal: 3,
            })
            seedSong({
                id: 'disc-1-second',
                title: 'Disc 1 Second',
                albumId: 'album-multi',
                discNumber: 1,
                discTotal: 2,
                trackNumber: 2,
                trackTotal: 2,
            })
            seedSong({
                id: 'disc-1-first',
                title: 'Disc 1 First',
                albumId: 'album-multi',
                discNumber: 1,
                discTotal: 2,
                trackNumber: 1,
                trackTotal: 2,
            })

            const query = emptySongQuery()
            query.filter = { albumIds: ['album-multi'] }
            query.sort = { field: SongSortField.trackNumber, direction: 'asc' }
            expect(titlesOf(repository.querySongs({ query, window: { offset: 0, limit: 10 } }))).toEqual([
                'Disc 1 First',
                'Disc 1 Second',
                'Disc 2 First',
            ])
            expect(repository.getAlbumDetail('album-multi')).toMatchObject({
                songCount: 3,
                trackTotal: 5,
                discGroups: [
                    { discNumber: 1, songCount: 2, trackTotal: 2, startIndex: 0 },
                    { discNumber: 2, songCount: 1, trackTotal: 3, startIndex: 2 },
                ],
            })
        })
    })
})

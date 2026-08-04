import {
    AlbumSortField,
    emptyAlbumQuery,
    emptySongQuery,
    SongPresence,
    SongSortField,
    type AlbumQuery,
    type QueryAlbumsRequest,
    type SongQuery,
} from '@release-maestro/core'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'fs'
import { join } from 'path'
import { DatabaseClient } from '../../database/database.client'
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
    year?: number | null
    bpm?: number | null
    musicalKey?: string | null
    duration?: number | null
    createdAt?: Date | null
    present?: boolean
    coverPath?: string | null
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
    trackCount?: number
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
                fileFingerprint: `fingerprint-${seed.id}`,
                lastSeenAt: new Date('2026-01-01T00:00:00Z'),
                present: seed.present ?? true,
                title: seed.title,
                artistText: seed.artistText ?? null,
                albumTitle: seed.albumTitle ?? null,
                albumId: seed.albumId ?? null,
                genreText: seed.genreText ?? null,
                recordLabelText: seed.recordLabelText ?? null,
                year: seed.year ?? null,
                bpm: seed.bpm ?? null,
                musicalKey: seed.musicalKey ?? null,
                duration: seed.duration ?? null,
                coverPath: seed.coverPath ?? null,
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
                trackCount: seed.trackCount ?? 0,
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
        repository = new LibraryBrowseRepository({ db } as unknown as DatabaseClient)
    })

    afterEach(() => sqlite.close())

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

        it('sorts by date added using the file creation time', () => {
            seedSong({ id: 'd', title: 'Newest', createdAt: new Date('2026-07-01T00:00:00Z') })

            const result = repository.querySongs({
                query: query({ sort: { field: SongSortField.dateAdded, direction: 'desc' } }),
                window: { offset: 0, limit: 1 },
            })

            expect(titlesOf(result)).toEqual(['Newest'])
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

            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue' })
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

        it('reaches a record label through the album', () => {
            const result = repository.querySongs({
                query: query({ filter: { recordLabelIds: ['label-hyperdub'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Archangel'])
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
                trackCount: 13,
            })
            seedAlbum({
                id: 'album-selected',
                title: 'Selected Ambient Works',
                artistText: 'Aphex Twin',
                year: 1992,
                recordLabelId: 'label-warp',
                recordLabelText: 'Warp',
                trackCount: 2,
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

        it('sorts by title ascending by default', () => {
            const result = repository.queryAlbums({
                query: albumQuery(),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Selected Ambient Works', 'Untrue'])
        })

        it('sorts by the denormalized track count', () => {
            const result = repository.queryAlbums({
                query: albumQuery({ sort: { field: AlbumSortField.trackCount, direction: 'desc' } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Untrue', 'Selected Ambient Works'])
        })

        it('sorts by the denormalized record label', () => {
            const result = repository.queryAlbums({
                query: albumQuery({ sort: { field: AlbumSortField.recordLabel, direction: 'asc' } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Untrue', 'Selected Ambient Works'])
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
            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue' })
            db.insert(songGenresTable).values({ songId: 'a', genreId: 'genre-garage' }).run()

            const result = repository.queryAlbums({
                query: albumQuery({ filter: { genreIds: ['genre-garage'] } }),
                window: { offset: 0, limit: 10 },
            })

            expect(titlesOf(result)).toEqual(['Untrue'])
        })

        it('counts an album once when several of its songs carry the selected genre', () => {
            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue' })
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

        it('does not search the titles of the album’s songs', () => {
            seedSong({ id: 'a', title: 'Archangel', albumId: 'album-untrue' })

            expect(repository.queryAlbums(albumSearch('archangel')).total).toBe(0)
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
                trackCount: 2,
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
                trackCount: 2,
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
    })
})

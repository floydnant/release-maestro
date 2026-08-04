import { emptySongQuery, SongPresence, SongSortField, type SongQuery } from '@release-maestro/core'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'fs'
import { join } from 'path'
import { DatabaseClient } from '../../database/database.client'
import * as schema from '../../database/drizzle.schema'
import {
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

    const query = (overrides: Partial<SongQuery> = {}): SongQuery => ({ ...emptySongQuery(), ...overrides })
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
})

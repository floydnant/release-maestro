import { emptySongQuery, SongMetadata } from '@release-maestro/core'
import Database from 'better-sqlite3'
import { fromPartial } from '@total-typescript/shoehorn'
import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import * as schema from '../../database/drizzle.schema'
import {
    albumArtistsTable,
    albumsTable,
    artistRawNameArtistsTable,
    artistRawNamesTable,
    artistsTable,
    genreRawNameGenresTable,
    genreRawNamesTable,
    genresTable,
    NormalizationIssueEntityType,
    NormalizationIssueField,
    NormalizationIssueStatus,
    NormalizationIssueType,
    normalizationIssuesTable,
    recordLabelsTable,
    songArtistsTable,
    songGenresTable,
    songsTable,
} from '../../database/drizzle.schema'
import { NORMALIZER_VERSION } from './library-normalization'
import { LibraryBrowseRepository } from './library-browse.repository'
import { LibraryBackendRepository } from './library.backend.repository'

const EXTRACTOR_VERSION = '1111111111111111'
const NEXT_EXTRACTOR_VERSION = '2222222222222222'

const fact = {
    path: '/music/song.flac',
    fileName: 'song.flac',
    size: 1_024,
    modifiedAt: 1_750_000_000_000,
    createdAt: 1_740_000_000_000,
}
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

describe('LibraryBackendRepository', () => {
    let sqlite: Database.Database
    let db: ReturnType<typeof drizzle<typeof schema>>
    let repository: LibraryBackendRepository
    let browse: LibraryBrowseRepository

    beforeEach(() => {
        sqlite = new Database(':memory:')
        sqlite.pragma('foreign_keys = ON')
        db = drizzle(sqlite, { schema })
        migrate(db, { migrationsFolder })
        const database = { db }
        repository = new LibraryBackendRepository(database)
        browse = new LibraryBrowseRepository(database)
    })

    afterEach(() => sqlite.close())

    it('dates first-library songs from the file, then dates new discoveries from the scan', () => {
        const firstScan = new Date('2026-06-15T10:00:00Z')
        const nextScan = new Date('2026-07-15T10:00:00Z')
        const oldFile = { ...fact, path: '/music/old.flac', fileName: 'old.flac' }
        const arrivingFile = { ...fact, path: '/music/arriving.flac', fileName: 'arriving.flac' }

        repository.processPrescanBatch([oldFile], firstScan, true)
        repository.processPrescanBatch([oldFile, arrivingFile], nextScan, false)

        const songs = db.select().from(songsTable).all()
        expect(songs.find(song => song.path == oldFile.path)?.addedAt).toEqual(new Date(fact.createdAt))
        expect(songs.find(song => song.path == arrivingFile.path)?.addedAt).toEqual(nextScan)

        db.update(songsTable).set({ present: false }).where(eq(songsTable.path, oldFile.path)).run()
        repository.processPrescanBatch([oldFile], new Date('2026-08-15T10:00:00Z'), false)
        expect(db.select().from(songsTable).where(eq(songsTable.path, oldFile.path)).get()?.addedAt).toEqual(
            new Date(fact.createdAt),
        )
    })

    it('dates a song inserted directly during metadata ingest', () => {
        const scannedAt = new Date('2026-07-15T10:00:00Z')
        repository.ingestMetadata(newSongFixture(), fact, scannedAt, EXTRACTOR_VERSION)

        expect(db.select().from(songsTable).get()?.addedAt).toEqual(scannedAt)
    })

    it('stores disc and track totals from the extractor', () => {
        repository.ingestMetadata(
            newSongFixture({ track: 2, discNumber: 2, discTotal: 3, trackTotal: 8 }),
            fact,
            new Date('2026-07-15T10:00:00Z'),
            EXTRACTOR_VERSION,
        )

        expect(db.select().from(songsTable).get()).toMatchObject({
            trackNumber: 2,
            discNumber: 2,
            discTotal: 3,
            trackTotal: 8,
        })
    })

    it('uses discovery time when an initial file has no creation time', () => {
        const seenAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([{ ...fact, createdAt: undefined }], seenAt, true)

        expect(db.select().from(songsTable).get()?.addedAt).toEqual(seenAt)
    })

    it('creates discovery rows and skips unchanged files on the next prescan', () => {
        const firstSeenAt = new Date('2026-06-15T10:00:00Z')
        const first = repository.processPrescanBatch([fact], firstSeenAt)

        expect(first).toMatchObject({ new: 1, changed: 0, unchanged: 0 })
        expect(repository.countSongsNeedingMetadata(firstSeenAt, EXTRACTOR_VERSION)).toBe(1)
        expect(repository.countSongsNeedingVersionRefresh(firstSeenAt, EXTRACTOR_VERSION)).toBe(0)

        const secondSeenAt = new Date('2026-06-15T11:00:00Z')
        const second = repository.processPrescanBatch([fact], secondSeenAt)
        const song = db.select().from(songsTable).get()

        expect(second).toMatchObject({ new: 0, changed: 0, unchanged: 1 })
        expect(song?.lastSeenAt).toEqual(secondSeenAt)
        expect(song?.lastScannedAt).toBeNull()
    })

    it('re-reads an untouched file when the normalizer revision has moved on', () => {
        const seenAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], seenAt)
        repository.ingestMetadata(newSongFixture({ artist: 'Alpha' }), fact, seenAt, EXTRACTOR_VERSION)

        // Ingested at the current revision, so nothing is pending: the file has not
        // changed and neither have the rules that were applied to it.
        expect(repository.countSongsNeedingMetadata(seenAt, EXTRACTOR_VERSION)).toBe(0)

        // Exactly what an older build left behind. The file on disk is untouched, so
        // the fingerprint gate alone would skip this row forever and it would keep
        // whatever the previous rules derived.
        db.update(songsTable)
            .set({ normalizerVersion: NORMALIZER_VERSION - 1 })
            .run()

        expect(repository.countSongsNeedingMetadata(seenAt, EXTRACTOR_VERSION)).toBe(1)
        expect(repository.listSongsNeedingMetadata(seenAt, null, 10, EXTRACTOR_VERSION)).toMatchObject([
            { path: fact.path },
        ])
    })

    it('treats a row that predates the normalizer version column as pending', () => {
        const seenAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], seenAt)
        repository.ingestMetadata(newSongFixture({ artist: 'Alpha' }), fact, seenAt, EXTRACTOR_VERSION)
        db.update(songsTable).set({ normalizerVersion: null }).run()

        expect(repository.countSongsNeedingMetadata(seenAt, EXTRACTOR_VERSION)).toBe(1)
    })

    it('re-reads an untouched file after the extractor revision changes', () => {
        const seenAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], seenAt)
        repository.ingestMetadata(newSongFixture(), fact, seenAt, EXTRACTOR_VERSION)

        expect(repository.countSongsNeedingMetadata(seenAt, EXTRACTOR_VERSION)).toBe(0)
        expect(repository.countSongsNeedingVersionRefresh(seenAt, EXTRACTOR_VERSION)).toBe(0)
        expect(repository.countSongsNeedingMetadata(seenAt, NEXT_EXTRACTOR_VERSION)).toBe(1)
        expect(repository.countSongsNeedingVersionRefresh(seenAt, NEXT_EXTRACTOR_VERSION)).toBe(1)
        expect(repository.listSongsNeedingMetadata(seenAt, null, 10, NEXT_EXTRACTOR_VERSION)).toMatchObject([
            { path: fact.path },
        ])

        repository.ingestMetadata(newSongFixture(), fact, seenAt, NEXT_EXTRACTOR_VERSION)
        expect(repository.countSongsNeedingMetadata(seenAt, NEXT_EXTRACTOR_VERSION)).toBe(0)
    })

    it('re-reads rows from before extractor revisions were stored', () => {
        const seenAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], seenAt)
        repository.ingestMetadata(newSongFixture(), fact, seenAt, EXTRACTOR_VERSION)
        db.update(songsTable).set({ extractorVersion: null }).run()

        expect(repository.countSongsNeedingMetadata(seenAt, EXTRACTOR_VERSION)).toBe(1)
        expect(repository.countSongsNeedingVersionRefresh(seenAt, EXTRACTOR_VERSION)).toBe(1)
    })

    it('keeps performer references separate from compilation album artists', () => {
        const metadata = newSongFixture({
            artist: 'Performer',
            albumArtist: 'Various Artists',
            albumTitle: 'Compilation',
            extraMetadata: [
                ['Custom: DISCOGS_ARTIST_ID', '456'],
                ['MusicBrainzArtistId', 'performer-id'],
                ['MusicBrainzReleaseArtistId', 'album-artist-id'],
            ],
        })
        const seenAt = new Date('2026-06-15T10:00:00Z')
        repository.ingestMetadata(metadata, fact, seenAt, EXTRACTOR_VERSION)
        repository.ingestMetadata(metadata, fact, seenAt, EXTRACTOR_VERSION)

        const artists = db.select().from(artistsTable).all()
        const browse = new LibraryBrowseRepository({ db })
        const performer = artists.find(artist => artist.name == 'Performer')!
        const albumArtist = artists.find(artist => artist.name == 'Various Artists')!
        expect(browse.getArtistDetail(performer.id)?.externalRefs).toEqual({
            DISCOGS_ARTIST_ID: ['456'],
            MUSICBRAINZ_ARTIST_ID: ['performer-id'],
        })
        expect(browse.getArtistDetail(albumArtist.id)?.externalRefs).toEqual({
            MUSICBRAINZ_ARTIST_ID: ['album-artist-id'],
        })
    })

    it('keeps recording references on songs and shares product references with albums', () => {
        const metadata = newSongFixture({
            artist: 'Artist',
            albumArtist: 'Artist',
            albumTitle: 'Album',
            label: 'Record label',
            extraMetadata: [
                ['Custom: ----:com.apple.iTunes:Acoustid Id', 'acoustid-1'],
                ['Isrc', 'GBABC2600001'],
                ['Custom: UPC', '001234'],
                ['Custom: ASIN', 'B000000001'],
                ['Custom: SPOTIFY_TRACK_ID', 'spotify-song-1'],
                ['Custom: SPOTIFY_RELEASE_ID', 'spotify-album-1'],
                ['Custom: DISCOGS_MASTER_RELEASE_ID', '123'],
                ['Custom: DISCOGS_ARTIST_ID', '456'],
                ['Custom: DISCOGS_LABEL_ID', '789'],
            ],
        })
        const seenAt = new Date('2026-06-15T10:00:00Z')
        repository.ingestMetadata(metadata, fact, seenAt, EXTRACTOR_VERSION)
        repository.ingestMetadata(metadata, fact, seenAt, EXTRACTOR_VERSION)

        expect(db.select().from(songsTable).get()?.externalRefs).toEqual({
            ACOUSTID_ID: ['acoustid-1'],
            ISRC: ['GBABC2600001'],
            BARCODE: ['001234'],
            ASIN: ['B000000001'],
            DISCOGS_ARTIST_ID: ['456'],
            DISCOGS_LABEL_ID: ['789'],
            SPOTIFY_TRACK_ID: ['spotify-song-1'],
            SPOTIFY_RELEASE_ID: ['spotify-album-1'],
            DISCOGS_MASTER_RELEASE_ID: ['123'],
        })
        expect(db.select().from(albumsTable).get()?.externalRefs).toEqual({
            BARCODE: ['001234'],
            ASIN: ['B000000001'],
            SPOTIFY_RELEASE_ID: ['spotify-album-1'],
            DISCOGS_MASTER_RELEASE_ID: ['123'],
        })
        const artist = db.select().from(artistsTable).get()!
        const browse = new LibraryBrowseRepository({ db })
        expect(browse.getArtistDetail(artist.id)?.externalRefs).toEqual({ DISCOGS_ARTIST_ID: ['456'] })
        expect(db.select().from(recordLabelsTable).get()?.externalRefs).toEqual({
            DISCOGS_LABEL_ID: ['789'],
        })
    })

    it('ingests normalized relations while preserving raw artist text', () => {
        const seenAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], seenAt)
        repository.ingestMetadata(
            newSongFixture({
                title: '  Song title ',
                artist: 'Alpha & Beta',
                albumTitle: 'Album',
                albumArtist: 'Album Artist',
                genre: 'Psytrance',
                label: 'Label',
                catalogNumber: ' CAT-1 ',
                coverPath: '/cache/cover.jpg',
                extraMetadata: [
                    ['Custom: MUSICBRAINZ_RECORDING_ID', 'recording-1'],
                    ['Custom: BEATPORT_LABEL_URL', 'https://www.beatport.com/label/example/1'],
                    ['Custom: BANDCAMP_LABEL_URL', 'https://example.bandcamp.com'],
                    ['Custom: SERATO_DATA', 'ignored'],
                ],
            }),
            fact,
            new Date('2026-06-15T10:05:00Z'),
            EXTRACTOR_VERSION,
        )

        const song = db.select().from(songsTable).get()
        const artists = db.select().from(artistsTable).all()
        const links = db.select().from(songArtistsTable).all()
        const album = db.select().from(albumsTable).get()
        const recordLabel = db.select().from(recordLabelsTable).get()
        const rawArtistName = db
            .select()
            .from(artistRawNamesTable)
            .where(eq(artistRawNamesTable.rawText, 'Alpha & Beta'))
            .get()
        const rawGenreName = db
            .select()
            .from(genreRawNamesTable)
            .where(eq(genreRawNamesTable.rawText, 'Psytrance'))
            .get()

        expect(song).toMatchObject({
            rawArtist: 'Alpha & Beta',
            rawRecordLabel: 'Label',
            artistText: 'Alpha & Beta',
            title: 'Song title',
            present: true,
            coverPath: '/cache/cover.jpg',
            recordLabelText: 'Label',
            externalRefs: { MUSICBRAINZ_RECORDING_ID: ['recording-1'] },
        })
        expect(recordLabel).toMatchObject({
            name: 'Label',
            externalRefs: {
                BEATPORT_LABEL_URL: ['https://www.beatport.com/label/example/1'],
                BANDCAMP_LABEL_URL: ['https://example.bandcamp.com'],
            },
        })
        expect(album?.recordLabelId).toBe(recordLabel?.id ?? null)
        expect(song?.lastSeenAt).toEqual(seenAt)
        expect(song?.lastScannedAt).toEqual(new Date('2026-06-15T10:05:00Z'))
        expect(song?.metadataHash).toHaveLength(64)
        expect(
            db
                .select()
                .from(normalizationIssuesTable)
                .where(eq(normalizationIssuesTable.entityId, song?.id ?? ''))
                .all(),
        ).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    entityType: NormalizationIssueEntityType.Song,
                    issueType: NormalizationIssueType.ArtistLooksMultiValue,
                    field: NormalizationIssueField.Artist,
                    value: 'Alpha & Beta',
                    status: NormalizationIssueStatus.Open,
                }),
            ]),
        )
        expect(artists.map(artist => artist.name).sort()).toEqual(['Album Artist', 'Alpha & Beta'])
        expect(links).toHaveLength(1)
        expect(rawArtistName?.confirmedByUser).toBe(false)
        expect(
            db
                .select()
                .from(artistRawNameArtistsTable)
                .where(eq(artistRawNameArtistsTable.artistRawNameId, rawArtistName?.id ?? ''))
                .all(),
        ).toHaveLength(1)
        expect(rawGenreName?.confirmedByUser).toBe(false)
        expect(
            db
                .select()
                .from(genreRawNameGenresTable)
                .where(eq(genreRawNameGenresTable.genreRawNameId, rawGenreName?.id ?? ''))
                .all(),
        ).toHaveLength(1)
        expect(repository.countSongsNeedingMetadata(seenAt, EXTRACTOR_VERSION)).toBe(0)
    })

    it('attributes artist references to the credit named by the tag', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], scannedAt)
        repository.ingestMetadata(
            newSongFixture({
                artist: 'Track Artist',
                albumArtist: 'Album Artist',
                albumTitle: 'Shared record',
                extraMetadata: [
                    ['MUSICBRAINZ_ARTIST_ID', 'track-id'],
                    ['MusicBrainzReleaseArtistId', 'album-id'],
                    ['DISCOGS_ARTIST_LINK', 'https://www.discogs.com/artist/123'],
                ],
            }),
            fact,
            scannedAt,
            EXTRACTOR_VERSION,
        )

        const artists = db.select().from(artistsTable).all()
        const artistId = (name: string): string => {
            const artist = artists.find(row => row.name === name)
            if (!artist) throw new Error(`Missing artist ${name}`)
            return artist.id
        }
        const browse = new LibraryBrowseRepository({ db })
        expect(browse.getArtistDetail(artistId('Track Artist'))?.externalRefs).toEqual({
            MUSICBRAINZ_ARTIST_ID: ['track-id'],
            DISCOGS_ARTIST_LINK: ['https://www.discogs.com/artist/123'],
        })
        expect(browse.getArtistDetail(artistId('Album Artist'))?.externalRefs).toEqual({
            MUSICBRAINZ_ARTIST_ID: ['album-id'],
        })
        expect(browse.getArtistDetail(artistId('Album Artist'))?.songCount).toBe(0)
    })

    it('replaces corrected artist references and removes deleted tags on a deep read', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        const original = newSongFixture({
            artist: 'Original Artist',
            extraMetadata: [['MUSICBRAINZ_ARTIST_ID', 'original-id']],
        })
        const corrected = newSongFixture({
            artist: 'Correct Artist',
            extraMetadata: [['MUSICBRAINZ_ARTIST_ID', 'correct-id']],
        })
        repository.ingestMetadata(original, fact, scannedAt, EXTRACTOR_VERSION)
        repository.ingestMetadata(corrected, fact, scannedAt, EXTRACTOR_VERSION)
        const artist = db.select().from(artistsTable).where(eq(artistsTable.name, 'Correct Artist')).get()!
        const browse = new LibraryBrowseRepository({ db })
        expect(browse.getArtistDetail(artist.id)?.externalRefs).toEqual({
            MUSICBRAINZ_ARTIST_ID: ['correct-id'],
        })
        repository.ingestMetadata({ ...corrected, extraMetadata: [] }, fact, scannedAt, EXTRACTOR_VERSION)
        expect(browse.getArtistDetail(artist.id)?.externalRefs).toEqual({})
    })

    it.each<[string, Partial<SongMetadata>]>([
        ['record label', { label: 'Other label' }],
        ['album artist', { albumArtist: 'Other artist' }],
        ['year', { year: 2025 }],
        ['date', { date: '2025-01-01' }],
        ['catalog number', { catalogNumber: 'OTHER-1' }],
        ['title', { albumTitle: 'Other album' }],
    ])('moves only the retagged song when its %s changes, then removes the empty album', (_, edit) => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        const first = newSongFixture({
            albumTitle: 'Album',
            albumArtist: 'Artist',
            label: 'Label',
            year: 2024,
            date: '2024-01-01',
            catalogNumber: 'CAT-1',
            coverPath: '/cache/a.jpg',
        })
        const second = {
            ...first,
            path: '/music/second.flac',
            fileName: 'second.flac',
            coverPath: '/cache/b.jpg',
        }
        const secondFact = {
            ...fact,
            path: second.path,
            fileName: second.fileName,
            createdAt: fact.createdAt + 1000,
        }
        repository.ingestMetadata(first, fact, scannedAt, EXTRACTOR_VERSION)
        repository.ingestMetadata(second, secondFact, scannedAt, EXTRACTOR_VERSION)
        const originalSongs = db.select().from(songsTable).orderBy(asc(songsTable.path)).all()
        const originalAlbum = db.select().from(albumsTable).get()
        if (!originalAlbum) throw new Error('expected original album')

        repository.ingestMetadata({ ...first, ...edit }, fact, scannedAt, EXTRACTOR_VERSION)
        expect(db.select().from(albumsTable).all()).toHaveLength(2)
        expect(db.select().from(albumsTable).where(eq(albumsTable.id, originalAlbum.id)).get()).toMatchObject(
            {
                coverPath: second.coverPath,
                dateAdded: new Date(secondFact.createdAt),
            },
        )
        expect(db.select().from(songsTable).where(eq(songsTable.path, second.path)).get()?.albumId).toBe(
            originalAlbum.id,
        )

        repository.ingestMetadata({ ...second, ...edit }, secondFact, scannedAt, EXTRACTOR_VERSION)
        repository.ingestMetadata({ ...first, ...edit }, fact, scannedAt, EXTRACTOR_VERSION)
        const songs = db.select().from(songsTable).orderBy(asc(songsTable.path)).all()
        const albums = db.select().from(albumsTable).all()
        expect(songs.map(song => song.id)).toEqual(originalSongs.map(song => song.id))
        expect(albums).toHaveLength(1)
        expect(albums[0]?.id).not.toBe(originalAlbum.id)
        expect(songs.every(song => song.albumId == albums[0]?.id)).toBe(true)
        expect(albums[0]).toMatchObject({
            coverPath: first.coverPath,
            dateAdded: new Date(secondFact.createdAt),
        })
        expect(db.select().from(albumArtistsTable).all()).toHaveLength(1)
        const rows = browse.querySongs({ query: emptySongQuery(), window: { offset: 0, limit: 10 } }).rows
        expect(rows).toHaveLength(2)
        for (const row of rows) {
            expect(row.recordLabelText).toBe(edit.label ?? first.label)
            if (!row.recordLabelId) throw new Error('expected record label ID')
            expect(
                browse
                    .querySongs({
                        query: { ...emptySongQuery(), filter: { recordLabelIds: [row.recordLabelId] } },
                        window: { offset: 0, limit: 10 },
                    })
                    .rows.map(song => song.id),
            ).toContain(row.id)
        }
    })

    it('chooses cover art independently of read order, including missing members', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        const first = newSongFixture({ albumTitle: 'Album', coverPath: '/cache/a.jpg' })
        const second = {
            ...first,
            path: '/music/second.flac',
            fileName: 'second.flac',
            coverPath: '/cache/b.jpg',
        }
        const secondFact = { ...fact, path: second.path, fileName: second.fileName }
        repository.ingestMetadata(second, secondFact, scannedAt, EXTRACTOR_VERSION)
        repository.ingestMetadata(first, fact, scannedAt, EXTRACTOR_VERSION)
        repository.ingestMetadata(second, secondFact, scannedAt, EXTRACTOR_VERSION)
        expect(db.select().from(albumsTable).get()?.coverPath).toBe('/cache/a.jpg')
        db.update(songsTable).set({ present: false }).where(eq(songsTable.path, first.path)).run()
        repository.ingestMetadata({ ...second, coverPath: null }, secondFact, scannedAt, EXTRACTOR_VERSION)
        expect(db.select().from(albumsTable).get()?.coverPath).toBe('/cache/a.jpg')
        repository.ingestMetadata({ ...first, coverPath: null }, fact, scannedAt, EXTRACTOR_VERSION)
        expect(db.select().from(albumsTable).get()?.coverPath).toBeNull()
    })

    it('removes the last album membership when an album title is cleared', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.ingestMetadata(
            newSongFixture({ albumTitle: 'Album', albumArtist: 'Artist' }),
            fact,
            scannedAt,
            EXTRACTOR_VERSION,
        )
        repository.ingestMetadata(newSongFixture(), fact, scannedAt, EXTRACTOR_VERSION)
        expect(db.select().from(albumsTable).all()).toEqual([])
        expect(db.select().from(albumArtistsTable).all()).toEqual([])
        expect(db.select().from(songsTable).get()?.albumId).toBeNull()
    })

    it('backfills covers and removes legacy empty albums without dropping missing songs', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.ingestMetadata(
            newSongFixture({ albumTitle: 'Album', albumArtist: 'Artist', coverPath: '/cache/a.jpg' }),
            fact,
            scannedAt,
            EXTRACTOR_VERSION,
        )
        db.update(songsTable).set({ present: false }).run()
        db.update(albumsTable).set({ coverPath: '/cache/stale.jpg' }).run()
        db.insert(albumsTable).values({ id: 'empty', identityKey: 'empty', title: 'Empty' }).run()
        const artist = db.select().from(artistsTable).get()
        if (!artist) throw new Error('expected artist')
        db.insert(albumArtistsTable).values({ albumId: 'empty', artistId: artist.id }).run()

        const migration = readFileSync(join(migrationsFolder, '0012_reconcile-album-fields.sql'), 'utf8')
        sqlite.exec(migration)
        sqlite.exec(migration)
        expect(db.select().from(albumsTable).all()).toEqual([
            expect.objectContaining({ title: 'Album', coverPath: '/cache/a.jpg' }),
        ])
        expect(db.select().from(albumArtistsTable).all()).toHaveLength(1)
        expect(db.select().from(songsTable).get()?.present).toBe(false)
    })

    it('reapplies a user-confirmed raw-name resolution in order', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], scannedAt)
        const metadata = newSongFixture({ artist: 'Alpha & Beta' })
        repository.ingestMetadata(metadata, fact, scannedAt, EXTRACTOR_VERSION)

        const rawName = db
            .select()
            .from(artistRawNamesTable)
            .where(eq(artistRawNamesTable.rawText, 'Alpha & Beta'))
            .get()
        if (!rawName) throw new Error('expected raw artist name')
        const alphaId = crypto.randomUUID()
        const betaId = crypto.randomUUID()
        db.insert(artistsTable)
            .values([
                { id: alphaId, name: 'Alpha', externalRefs: {} },
                { id: betaId, name: 'Beta', externalRefs: {} },
            ])
            .run()
        db.update(artistRawNamesTable)
            .set({
                resolutionType: 'user',
                confidence: 1,
                confirmedByUser: true,
                updatedAt: scannedAt,
            })
            .where(eq(artistRawNamesTable.id, rawName.id))
            .run()
        db.delete(artistRawNameArtistsTable)
            .where(eq(artistRawNameArtistsTable.artistRawNameId, rawName.id))
            .run()
        db.insert(artistRawNameArtistsTable)
            .values([
                { artistRawNameId: rawName.id, artistId: alphaId, position: 0 },
                { artistRawNameId: rawName.id, artistId: betaId, position: 1 },
            ])
            .run()

        repository.ingestMetadata(metadata, fact, new Date('2026-06-15T11:00:00Z'), EXTRACTOR_VERSION)

        const song = db.select().from(songsTable).get()
        if (!song) throw new Error('expected ingested song')
        const linkedArtistIds = db
            .select()
            .from(songArtistsTable)
            .where(eq(songArtistsTable.songId, song.id))
            .orderBy(asc(songArtistsTable.position))
            .all()
            .map(link => link.artistId)

        expect(linkedArtistIds).toEqual([alphaId, betaId])
    })

    it('reapplies a user-confirmed raw genre resolution', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], scannedAt)
        const metadata = newSongFixture({ genre: 'Psytrance / Goa' })
        repository.ingestMetadata(metadata, fact, scannedAt, EXTRACTOR_VERSION)

        const rawName = db
            .select()
            .from(genreRawNamesTable)
            .where(eq(genreRawNamesTable.rawText, 'Psytrance / Goa'))
            .get()
        if (!rawName) throw new Error('expected raw genre name')

        const psytranceId = crypto.randomUUID()
        const goaId = crypto.randomUUID()
        db.insert(genresTable)
            .values([
                { id: psytranceId, name: 'Psytrance' },
                { id: goaId, name: 'Goa' },
            ])
            .run()
        db.update(genreRawNamesTable)
            .set({
                resolutionType: 'user',
                confidence: 1,
                confirmedByUser: true,
                updatedAt: scannedAt,
            })
            .where(eq(genreRawNamesTable.id, rawName.id))
            .run()
        db.delete(genreRawNameGenresTable).where(eq(genreRawNameGenresTable.genreRawNameId, rawName.id)).run()
        db.insert(genreRawNameGenresTable)
            .values([
                { genreRawNameId: rawName.id, genreId: psytranceId, position: 0 },
                { genreRawNameId: rawName.id, genreId: goaId, position: 1 },
            ])
            .run()

        repository.ingestMetadata(metadata, fact, new Date('2026-06-15T11:00:00Z'), EXTRACTOR_VERSION)

        const song = db.select().from(songsTable).get()
        if (!song) throw new Error('expected ingested song')
        const linkedGenreIds = db
            .select()
            .from(songGenresTable)
            .where(eq(songGenresTable.songId, song.id))
            .all()
            .map(link => link.genreId)

        expect(linkedGenreIds).toHaveLength(2)
        expect(linkedGenreIds).toEqual(expect.arrayContaining([psytranceId, goaId]))
    })

    it('marks songs not observed during the current prescan as absent', () => {
        repository.processPrescanBatch([fact], new Date('2026-06-15T10:00:00Z'))

        expect(repository.markNotSeenPresent(new Date('2026-06-15T11:00:00Z'))).toBe(1)
        expect(db.select().from(songsTable).get()?.present).toBe(false)
    })

    it('preserves dismissed normalization issues when they are detected again', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], scannedAt)
        const metadata = newSongFixture({ artist: 'Alpha & Beta' })
        repository.ingestMetadata(metadata, fact, scannedAt, EXTRACTOR_VERSION)

        const issue = db
            .select()
            .from(normalizationIssuesTable)
            .where(eq(normalizationIssuesTable.issueType, NormalizationIssueType.ArtistLooksMultiValue))
            .get()
        if (!issue) throw new Error('expected normalization issue')

        const closedAt = new Date('2026-06-15T10:10:00Z')
        db.update(normalizationIssuesTable)
            .set({ status: 'DISMISSED', closedAt })
            .where(eq(normalizationIssuesTable.id, issue.id))
            .run()

        repository.ingestMetadata(metadata, fact, new Date('2026-06-15T11:00:00Z'), EXTRACTOR_VERSION)

        expect(
            db.select().from(normalizationIssuesTable).where(eq(normalizationIssuesTable.id, issue.id)).get(),
        ).toMatchObject({
            status: NormalizationIssueStatus.Dismissed,
            closedAt,
        })
    })

    it('marks open normalization issues as disappeared when the detector no longer emits them', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], scannedAt)
        repository.ingestMetadata(
            newSongFixture({ artist: 'Alpha & Beta' }),
            fact,
            scannedAt,
            EXTRACTOR_VERSION,
        )

        const issue = db
            .select()
            .from(normalizationIssuesTable)
            .where(eq(normalizationIssuesTable.issueType, NormalizationIssueType.ArtistLooksMultiValue))
            .get()
        if (!issue) throw new Error('expected normalization issue')

        const rescannedAt = new Date('2026-06-15T11:00:00Z')
        repository.ingestMetadata(newSongFixture({ artist: 'Alpha' }), fact, rescannedAt, EXTRACTOR_VERSION)

        expect(
            db.select().from(normalizationIssuesTable).where(eq(normalizationIssuesTable.id, issue.id)).get(),
        ).toMatchObject({
            status: NormalizationIssueStatus.Disappeared,
            closedAt: rescannedAt,
        })
    })

    it('collects entities left behind by a re-read while retaining confirmed resolutions', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.ingestMetadata(
            newSongFixture({
                artist: 'Old Artist',
                albumArtist: 'Old Artist',
                albumTitle: 'Old Album',
                genre: 'Old Genre',
                label: 'Old Label',
            }),
            fact,
            scannedAt,
            EXTRACTOR_VERSION,
        )
        const confirmedArtist = db
            .select()
            .from(artistRawNamesTable)
            .where(eq(artistRawNamesTable.rawText, 'Old Artist'))
            .get()
        if (!confirmedArtist) throw new Error('expected raw artist name')
        db.update(artistRawNamesTable)
            .set({ confirmedByUser: true })
            .where(eq(artistRawNamesTable.id, confirmedArtist.id))
            .run()

        repository.ingestMetadata(
            newSongFixture({
                artist: 'New Artist',
                albumArtist: 'New Artist',
                albumTitle: 'New Album',
                genre: 'New Genre',
                label: 'New Label',
            }),
            fact,
            new Date('2026-06-15T11:00:00Z'),
            NEXT_EXTRACTOR_VERSION,
        )
        repository.removeUnusedCatalogEntities()

        expect(
            db
                .select()
                .from(albumsTable)
                .all()
                .map(album => album.title),
        ).toEqual(['New Album'])
        expect(
            db
                .select()
                .from(artistsTable)
                .all()
                .map(artist => artist.name)
                .sort(),
        ).toEqual(['New Artist', 'Old Artist'])
        expect(
            db
                .select()
                .from(genresTable)
                .all()
                .map(genre => genre.name),
        ).toEqual(['New Genre'])
        expect(
            db
                .select()
                .from(recordLabelsTable)
                .all()
                .map(label => label.name),
        ).toEqual(['New Label'])
        expect(
            db
                .select()
                .from(artistRawNamesTable)
                .all()
                .map(name => name.rawText)
                .sort(),
        ).toEqual(['New Artist', 'Old Artist'])
        expect(
            db
                .select()
                .from(genreRawNamesTable)
                .all()
                .map(name => name.rawText),
        ).toEqual(['New Genre'])
    })
})

import Database from 'better-sqlite3'
import { asc, eq } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'fs'
import { join } from 'path'
import { newSongFixture } from '../../../test/fixtures/song-metadata.fixture'
import { DatabaseClient } from '../../database/database.client'
import * as schema from '../../database/drizzle.schema'
import {
    artistRawNameArtistsTable,
    artistRawNamesTable,
    artistsTable,
    genreRawNameGenresTable,
    genreRawNamesTable,
    genresTable,
    normalizationIssuesTable,
    songArtistsTable,
    songGenresTable,
    songsTable,
} from '../../database/drizzle.schema'
import { LibraryBackendRepository } from './library.backend.repository'

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

    beforeEach(() => {
        sqlite = new Database(':memory:')
        sqlite.pragma('foreign_keys = ON')
        db = drizzle(sqlite, { schema })
        migrate(db, { migrationsFolder })
        repository = new LibraryBackendRepository({ db } as unknown as DatabaseClient)
    })

    afterEach(() => sqlite.close())

    it('creates discovery rows and skips unchanged files on the next prescan', () => {
        const firstSeenAt = new Date('2026-06-15T10:00:00Z')
        const first = repository.processPrescanBatch([fact], firstSeenAt)

        expect(first).toMatchObject({ new: 1, changed: 0, unchanged: 0 })
        expect(repository.countSongsNeedingMetadata()).toBe(1)

        const secondSeenAt = new Date('2026-06-15T11:00:00Z')
        const second = repository.processPrescanBatch([fact], secondSeenAt)
        const song = db.select().from(songsTable).get()

        expect(second).toMatchObject({ new: 0, changed: 0, unchanged: 1 })
        expect(song?.lastSeenAt).toEqual(secondSeenAt)
        expect(song?.lastScannedAt).toBeNull()
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
                    ['Custom: SERATO_DATA', 'ignored'],
                ],
            }),
            fact,
            new Date('2026-06-15T10:05:00Z'),
        )

        const song = db.select().from(songsTable).get()
        const artists = db.select().from(artistsTable).all()
        const links = db.select().from(songArtistsTable).all()
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
            artistText: 'Alpha & Beta',
            title: 'Song title',
            present: true,
            coverPath: '/cache/cover.jpg',
            externalRefs: { MUSICBRAINZ_RECORDING_ID: ['recording-1'] },
        })
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
                    entityType: 'song',
                    issueType: 'artist_looks_multi_value',
                    field: 'artist',
                    value: 'Alpha & Beta',
                    status: 'open',
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
        expect(repository.countSongsNeedingMetadata()).toBe(0)
    })

    it('reapplies a user-confirmed raw-name resolution in order', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], scannedAt)
        const metadata = newSongFixture({ artist: 'Alpha & Beta' })
        repository.ingestMetadata(metadata, fact, scannedAt)

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

        repository.ingestMetadata(metadata, fact, new Date('2026-06-15T11:00:00Z'))

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
        repository.ingestMetadata(metadata, fact, scannedAt)

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

        repository.ingestMetadata(metadata, fact, new Date('2026-06-15T11:00:00Z'))

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
        repository.ingestMetadata(metadata, fact, scannedAt)

        const issue = db
            .select()
            .from(normalizationIssuesTable)
            .where(eq(normalizationIssuesTable.issueType, 'artist_looks_multi_value'))
            .get()
        if (!issue) throw new Error('expected normalization issue')

        const dismissedAt = new Date('2026-06-15T10:10:00Z')
        db.update(normalizationIssuesTable)
            .set({ status: 'dismissed', dismissedAt })
            .where(eq(normalizationIssuesTable.id, issue.id))
            .run()

        repository.ingestMetadata(metadata, fact, new Date('2026-06-15T11:00:00Z'))

        expect(
            db.select().from(normalizationIssuesTable).where(eq(normalizationIssuesTable.id, issue.id)).get(),
        ).toMatchObject({
            status: 'dismissed',
            dismissedAt,
        })
    })

    it('marks open normalization issues as disappeared when the detector no longer emits them', () => {
        const scannedAt = new Date('2026-06-15T10:00:00Z')
        repository.processPrescanBatch([fact], scannedAt)
        repository.ingestMetadata(newSongFixture({ artist: 'Alpha & Beta' }), fact, scannedAt)

        const issue = db
            .select()
            .from(normalizationIssuesTable)
            .where(eq(normalizationIssuesTable.issueType, 'artist_looks_multi_value'))
            .get()
        if (!issue) throw new Error('expected normalization issue')

        const rescannedAt = new Date('2026-06-15T11:00:00Z')
        repository.ingestMetadata(newSongFixture({ artist: 'Alpha' }), fact, rescannedAt)

        expect(
            db.select().from(normalizationIssuesTable).where(eq(normalizationIssuesTable.id, issue.id)).get(),
        ).toMatchObject({
            status: 'disappeared',
            disappearedAt: rescannedAt,
        })
    })
})

import { Prettify } from '@release-maestro/core'
import { index, integer, primaryKey, real, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export enum ExternalRefKeys {
    MusicBrainzTrackId = 'MUSICBRAINZ_TRACK_ID',
    MusicBrainzReleaseId = 'MUSICBRAINZ_RELEASE_ID',
    MusicBrainzReleaseGroupId = 'MUSICBRAINZ_RELEASE_GROUP_ID',
    MusicBrainzReleaseArtistId = 'MUSICBRAINZ_RELEASE_ARTIST_ID',
    MusicBrainzReleaseTrackId = 'MUSICBRAINZ_RELEASE_TRACK_ID',
    MusicBrainzRecordingId = 'MUSICBRAINZ_RECORDING_ID',
    MusicBrainzWorkId = 'MUSICBRAINZ_WORK_ID',
    MusicBrainzArtistId = 'MUSICBRAINZ_ARTIST_ID',
    MusicBrainzLabelId = 'MUSICBRAINZ_LABEL_ID',
    MusicBrainzAlbumId = 'MUSICBRAINZ_ALBUM_ID',
    MusicBrainzAlbumArtistId = 'MUSICBRAINZ_ALBUM_ARTIST_ID',

    BandcampUrl = 'BANDCAMP_URL',
    BandcampTrackId = 'BANDCAMP_TRACK_ID',
    BandcampReleaseId = 'BANDCAMP_RELEASE_ID',
    BandcampAlbumId = 'BANDCAMP_ALBUM_ID',
    BandcampLabelId = 'BANDCAMP_LABEL_ID',
    BandcampLabelUrl = 'BANDCAMP_LABEL_URL',
    BandcampArtistId = 'BANDCAMP_ARTIST_ID',

    DiscogsReleaseId = 'DISCOGS_RELEASE_ID',
    DiscogsArtistLink = 'DISCOGS_ARTIST_LINK',
    DiscogsLabelLink = 'DISCOGS_LABEL_LINK',

    BeatportTrackId = 'BEATPORT_TRACK_ID',
    BeatportTrackUrl = 'BEATPORT_TRACK_URL',
    BeatportReleaseId = 'BEATPORT_RELEASE_ID',
    BeatportLabelUrl = 'BEATPORT_LABEL_URL',
    BeatportArtistUrl = 'BEATPORT_ARTIST_URL',
}
export type ExternalRefs = Prettify<Partial<Record<ExternalRefKeys, string[]>>>

export interface NormalizationIssue {
    type: NormalizationIssueType
    field: NormalizationIssueField
    value?: string
}
export const NormalizationIssueType = {
    ArtistMissing: 'ARTIST_MISSING',
    AlbumArtistMissing: 'ALBUM_ARTIST_MISSING',
    ArtistLooksMultiValue: 'ARTIST_LOOKS_MULTI_VALUE',
    TitleContainsArtistSeparator: 'TITLE_CONTAINS_ARTIST_SEPARATOR',
    ArtistEqualsLabel: 'ARTIST_EQUALS_LABEL',
    AlbumTitleMissing: 'ALBUM_TITLE_MISSING',
    GenreLooksMultiValue: 'GENRE_LOOKS_MULTI_VALUE',
    GenreMissing: 'GENRE_MISSING',
    AlbumArtistLooksMultiValue: 'ALBUM_ARTIST_LOOKS_MULTI_VALUE',
} as const
export type NormalizationIssueType = (typeof NormalizationIssueType)[keyof typeof NormalizationIssueType]

export const NormalizationIssueField = {
    Artist: 'ARTIST',
    AlbumArtist: 'ALBUM_ARTIST',
    Title: 'TITLE',
    Genre: 'GENRE',
    Label: 'LABEL',
    AlbumTitle: 'ALBUM_TITLE',
} as const
export type NormalizationIssueField = (typeof NormalizationIssueField)[keyof typeof NormalizationIssueField]

export const NormalizationIssueEntityType = {
    Song: 'SONG',
} as const
export type NormalizationIssueEntityType =
    (typeof NormalizationIssueEntityType)[keyof typeof NormalizationIssueEntityType]

export const NormalizationIssueStatus = {
    Open: 'OPEN',
    Dismissed: 'DISMISSED',
    Resolved: 'RESOLVED',
    Disappeared: 'DISAPPEARED',
} as const
export type NormalizationIssueStatus =
    (typeof NormalizationIssueStatus)[keyof typeof NormalizationIssueStatus]

export const feedItemsTable = sqliteTable(
    'feed_items',
    {
        id: text('id').primaryKey(),
        ingestedAt: integer('ingested_at', { mode: 'timestamp' }).notNull(),
        eventDate: integer('event_date', { mode: 'timestamp' }).notNull(),
        isSnoozed: integer('is_snoozed', { mode: 'boolean' }).notNull(),
        lastViewedAt: integer('last_viewed_at', { mode: 'timestamp' }),
        type: text('type').notNull(),
        dedupeIdentifier: text('dedupe_identifier').notNull(),
        data: text('data', { mode: 'json' }).notNull(),
        source: text('source', { mode: 'json' }).notNull(),
    },
    table => [uniqueIndex('feed_item_type_dedupe_identifier_key').on(table.type, table.dedupeIdentifier)],
)

export const feedItemHistoryEntriesTable = sqliteTable('feed_item_history_entries', {
    id: text('id').primaryKey(),
    ts: integer('ts', { mode: 'timestamp' }).notNull(),
    feedItemId: text('feed_item_id')
        .notNull()
        .references(() => feedItemsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
})

export const labelsTable = sqliteTable(
    'labels',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        externalRefs: text('external_refs', { mode: 'json' }).$type<ExternalRefs>().notNull().default({}),
    },
    table => [uniqueIndex('labels_name_key').on(table.name)],
)

export const artistsTable = sqliteTable(
    'artists',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
        sortName: text('sort_name'),
        externalRefs: text('external_refs', { mode: 'json' }).$type<ExternalRefs>().notNull().default({}),
    },
    table => [uniqueIndex('artists_name_key').on(table.name)],
)

export const genresTable = sqliteTable(
    'genres',
    {
        id: text('id').primaryKey(),
        name: text('name').notNull(),
    },
    table => [uniqueIndex('genres_name_key').on(table.name)],
)

export const albumsTable = sqliteTable(
    'albums',
    {
        id: text('id').primaryKey(),
        identityKey: text('identity_key').notNull(),
        title: text('title').notNull(),
        artistText: text('artist_text'),
        year: integer('year'),
        date: text('date'),
        catalogNumber: text('catalog_number'),
        coverPath: text('cover_path'),
        externalRefs: text('external_refs', { mode: 'json' }).$type<ExternalRefs>().notNull().default({}),
        labelId: text('label_id').references(() => labelsTable.id, {
            onDelete: 'set null',
            onUpdate: 'cascade',
        }),
    },
    table => [
        uniqueIndex('albums_identity_key_key').on(table.identityKey),
        index('albums_title_idx').on(table.title),
        index('albums_label_id_idx').on(table.labelId),
    ],
)

export const songsTable = sqliteTable(
    'songs',
    {
        id: text('id').primaryKey(),
        path: text('path').notNull(),
        fileName: text('file_name').notNull(),
        size: integer('size').notNull(),
        modifiedAt: integer('modified_at', { mode: 'timestamp_ms' }).notNull(),
        createdAt: integer('created_at', { mode: 'timestamp_ms' }),
        fileFingerprint: text('file_fingerprint').notNull(),
        scannedFileFingerprint: text('scanned_file_fingerprint'),
        present: integer('present', { mode: 'boolean' }).notNull().default(true),
        lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
        lastScannedAt: integer('last_scanned_at', { mode: 'timestamp_ms' }),

        rawTitle: text('raw_title'),
        rawArtist: text('raw_artist'),
        rawAlbumTitle: text('raw_album_title'),
        rawAlbumArtist: text('raw_album_artist'),
        rawGenre: text('raw_genre'),
        rawLabel: text('raw_label'),

        title: text('title').notNull(),
        artistText: text('artist_text'),
        albumTitle: text('album_title'),
        albumArtistText: text('album_artist_text'),
        genreText: text('genre_text'),
        labelText: text('label_text'),
        catalogNumber: text('catalog_number'),
        year: integer('year'),
        trackNumber: integer('track_number'),
        comment: text('comment'),
        musicalKey: text('musical_key'),
        bpm: real('bpm'),
        energy: text('energy'),
        lyrics: text('lyrics'),
        date: text('date'),
        coverPath: text('cover_path'),

        duration: real('duration'),
        overallBitrate: integer('overall_bitrate'),
        audioBitrate: integer('audio_bitrate'),
        sampleRate: integer('sample_rate'),
        bitDepth: integer('bit_depth'),
        channels: integer('channels'),
        tagType: text('tag_type'),
        codec: text('codec'),

        metadataHash: text('metadata_hash'),
        externalRefs: text('external_refs', { mode: 'json' }).$type<ExternalRefs>().notNull().default({}),
        albumId: text('album_id').references(() => albumsTable.id, {
            onDelete: 'set null',
            onUpdate: 'cascade',
        }),
    },
    table => [
        uniqueIndex('songs_path_key').on(table.path),
        index('songs_present_idx').on(table.present),
        index('songs_file_fingerprint_idx').on(table.fileFingerprint),
        index('songs_album_id_idx').on(table.albumId),
    ],
)

export const normalizationIssuesTable = sqliteTable(
    'normalization_issues',
    {
        id: text('id').primaryKey(),
        entityType: text('entity_type', {
            enum: Object.values(NormalizationIssueEntityType) as [
                NormalizationIssueEntityType,
                ...NormalizationIssueEntityType[],
            ],
        }).notNull(),
        entityId: text('entity_id').notNull(),
        issueType: text('issue_type', {
            enum: Object.values(NormalizationIssueType) as [
                NormalizationIssueType,
                ...NormalizationIssueType[],
            ],
        }).notNull(),
        field: text('field', {
            enum: Object.values(NormalizationIssueField) as [
                NormalizationIssueField,
                ...NormalizationIssueField[],
            ],
        }).notNull(),
        value: text('value'),
        fingerprint: text('fingerprint').notNull(),
        status: text('status', {
            enum: Object.values(NormalizationIssueStatus) as [
                NormalizationIssueStatus,
                ...NormalizationIssueStatus[],
            ],
        })
            .notNull()
            .default(NormalizationIssueStatus.Open),
        firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
        lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
        closedAt: integer('closed_at', { mode: 'timestamp_ms' }),
        detectorVersion: integer('detector_version').notNull(),
    },
    table => [
        uniqueIndex('normalization_issues_entity_fingerprint_key').on(
            table.entityType,
            table.entityId,
            table.fingerprint,
        ),
        index('normalization_issues_entity_idx').on(table.entityType, table.entityId),
        index('normalization_issues_status_idx').on(table.status),
    ],
)

export const songArtistsTable = sqliteTable(
    'song_artists',
    {
        songId: text('song_id')
            .notNull()
            .references(() => songsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
        artistId: text('artist_id')
            .notNull()
            .references(() => artistsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
        role: text('role'),
        position: integer('position').notNull().default(0),
    },
    table => [
        primaryKey({ columns: [table.songId, table.artistId, table.position] }),
        index('song_artists_artist_id_idx').on(table.artistId),
    ],
)

export const songGenresTable = sqliteTable(
    'song_genres',
    {
        songId: text('song_id')
            .notNull()
            .references(() => songsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
        genreId: text('genre_id')
            .notNull()
            .references(() => genresTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
    },
    table => [
        primaryKey({ columns: [table.songId, table.genreId] }),
        index('song_genres_genre_id_idx').on(table.genreId),
    ],
)

export const albumArtistsTable = sqliteTable(
    'album_artists',
    {
        albumId: text('album_id')
            .notNull()
            .references(() => albumsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
        artistId: text('artist_id')
            .notNull()
            .references(() => artistsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
        role: text('role'),
        position: integer('position').notNull().default(0),
    },
    table => [
        primaryKey({ columns: [table.albumId, table.artistId, table.position] }),
        index('album_artists_artist_id_idx').on(table.artistId),
    ],
)

export const artistRawNamesTable = sqliteTable(
    'artist_raw_names',
    {
        id: text('id').primaryKey(),
        rawText: text('raw_text').notNull(),
        normalizedText: text('normalized_text'),
        resolutionType: text('resolution_type'),
        confidence: real('confidence'),
        confirmedByUser: integer('confirmed_by_user', { mode: 'boolean' }).notNull().default(false),
        firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
        lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
        createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
        updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    },
    table => [
        uniqueIndex('artist_raw_names_raw_text_key').on(table.rawText),
        index('artist_raw_names_confirmed_idx').on(table.confirmedByUser),
    ],
)

export const artistRawNameArtistsTable = sqliteTable(
    'artist_raw_name_artists',
    {
        artistRawNameId: text('artist_raw_name_id')
            .notNull()
            .references(() => artistRawNamesTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
        artistId: text('artist_id')
            .notNull()
            .references(() => artistsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
        position: integer('position').notNull(),
    },
    table => [
        primaryKey({ columns: [table.artistRawNameId, table.artistId, table.position] }),
        index('artist_raw_name_artists_artist_idx').on(table.artistId),
    ],
)

export const genreRawNamesTable = sqliteTable(
    'genre_raw_names',
    {
        id: text('id').primaryKey(),
        rawText: text('raw_text').notNull(),
        normalizedText: text('normalized_text'),
        resolutionType: text('resolution_type'),
        confidence: real('confidence'),
        confirmedByUser: integer('confirmed_by_user', { mode: 'boolean' }).notNull().default(false),
        firstSeenAt: integer('first_seen_at', { mode: 'timestamp_ms' }).notNull(),
        lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull(),
        createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
        updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
    },
    table => [
        uniqueIndex('genre_raw_names_raw_text_key').on(table.rawText),
        index('genre_raw_names_confirmed_idx').on(table.confirmedByUser),
    ],
)

export const genreRawNameGenresTable = sqliteTable(
    'genre_raw_name_genres',
    {
        genreRawNameId: text('genre_raw_name_id')
            .notNull()
            .references(() => genreRawNamesTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
        genreId: text('genre_id')
            .notNull()
            .references(() => genresTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
        position: integer('position').notNull(),
    },
    table => [
        primaryKey({ columns: [table.genreRawNameId, table.genreId, table.position] }),
        index('genre_raw_name_genres_genre_idx').on(table.genreId),
    ],
)

export type DbFeedItem = typeof feedItemsTable.$inferSelect
export type DbFeedItemHistoryEntry = typeof feedItemHistoryEntriesTable.$inferSelect
export type DbSong = typeof songsTable.$inferSelect
export type DbArtist = typeof artistsTable.$inferSelect
export type DbAlbum = typeof albumsTable.$inferSelect
export type DbGenre = typeof genresTable.$inferSelect
export type DbLabel = typeof labelsTable.$inferSelect

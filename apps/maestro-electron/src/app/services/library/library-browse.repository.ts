import {
    BROWSE_WINDOW_MAX_LIMIT,
    SongPresence,
    SongSortField,
    type ArtistCreditSegment,
    type BrowseWindow,
    type CatalogEntityRef,
    type QuerySongsRequest,
    type SongFilter,
    type SongFilterDescription,
    type SongQuery,
    type SongWindowResult,
} from '@release-maestro/core'
import { and, asc, count, desc, eq, exists, inArray, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { DatabaseClient } from '../../database/database.client'
import {
    albumsTable,
    artistsTable,
    genresTable,
    recordLabelsTable,
    songArtistsTable,
    songGenresTable,
    songsTable,
} from '../../database/drizzle.schema'
import { songSearchCondition } from './song-search'

/**
 * The library read side: windowed catalog queries (ADR 0004).
 *
 * Nothing here ever returns the whole catalog. A caller sends a {@link SongQuery}
 * plus a window and gets back the rows on screen and one total; the renderer holds
 * nothing else. Every ordering this supports is index-backed — see the
 * `mae-118-browse-sort-indexes` migration.
 *
 * Kept separate from `LibraryBackendRepository`, which is entirely scan lifecycle:
 * the write side ingests, this side reads, and they share only tables.
 */
export class LibraryBrowseRepository {
    constructor(private readonly database: DatabaseClient) {}

    querySongs({ query, window }: QuerySongsRequest): SongWindowResult {
        const where = this.songConditions(query)
        const { offset, limit } = normalizeWindow(window)

        const total =
            this.database.db.select({ value: count() }).from(songsTable).where(where).get()?.value ?? 0

        // Skip the row query entirely when the window starts past the end — a stale
        // viewport request after a filter narrows the result set is routine, not an error.
        if (offset >= total) return { rows: [], offset, total }

        const rows = this.database.db
            .select({
                id: songsTable.id,
                path: songsTable.path,
                present: songsTable.present,
                title: songsTable.title,
                coverPath: songsTable.coverPath,
                albumCoverPath: albumsTable.coverPath,
                artistText: songsTable.artistText,
                albumId: songsTable.albumId,
                albumTitle: songsTable.albumTitle,
                genreText: songsTable.genreText,
                recordLabelId: albumsTable.recordLabelId,
                recordLabelText: songsTable.recordLabelText,
                year: songsTable.year,
                bpm: songsTable.bpm,
                musicalKey: songsTable.musicalKey,
                duration: songsTable.duration,
                createdAt: songsTable.createdAt,
            })
            .from(songsTable)
            .leftJoin(albumsTable, eq(songsTable.albumId, albumsTable.id))
            .where(where)
            .orderBy(...this.songOrdering(query.sort))
            .limit(limit)
            .offset(offset)
            .all()

        const songIds = rows.map(row => row.id)
        const creditsBySong = this.artistCredits(songIds)
        const genresBySong = this.genres(songIds)

        return {
            rows: rows.map(row => ({
                id: row.id,
                path: row.path,
                present: row.present,
                title: row.title,
                // A track without embedded art still belongs to a release that has some.
                coverPath: row.coverPath ?? row.albumCoverPath,
                artistText: row.artistText,
                artistCredit: creditsBySong.get(row.id) ?? [],
                albumId: row.albumId,
                albumTitle: row.albumTitle,
                genreText: row.genreText,
                genres: genresBySong.get(row.id) ?? [],
                recordLabelId: row.recordLabelId,
                recordLabelText: row.recordLabelText,
                year: row.year,
                bpm: row.bpm,
                musicalKey: row.musicalKey,
                duration: row.duration,
                dateAdded: row.createdAt?.getTime() ?? null,
            })),
            offset,
            total,
        }
    }

    /**
     * Resolve the entity ids in a filter to display names for the filter bar's chips.
     * Ids that no longer resolve are simply absent from the result, so a stale URL
     * degrades to a narrower chip set rather than to an error.
     */
    describeSongFilter(filter: SongFilter): SongFilterDescription {
        return {
            artists: this.entityNames(artistsTable, artistsTable.name, filter.artistIds),
            genres: this.entityNames(genresTable, genresTable.name, filter.genreIds),
            recordLabels: this.entityNames(recordLabelsTable, recordLabelsTable.name, filter.recordLabelIds),
            albums: this.entityNames(albumsTable, albumsTable.title, filter.albumIds),
        }
    }

    /**
     * Filter + search as one `WHERE`. Entity filters are `EXISTS` subqueries against
     * the join tables rather than joins on the main query, so a song matching two of
     * the selected artists still counts once — a `JOIN` would duplicate its row and
     * corrupt both the total and the window.
     */
    private songConditions(query: SongQuery): SQL | undefined {
        const conditions: (SQL | undefined)[] = [songSearchCondition(query.search)]

        const presence = query.filter.presence ?? SongPresence.any
        if (presence == SongPresence.present) conditions.push(eq(songsTable.present, true))
        if (presence == SongPresence.missing) conditions.push(eq(songsTable.present, false))

        const artistIds = nonEmpty(query.filter.artistIds)
        if (artistIds) {
            conditions.push(
                exists(
                    this.database.db
                        .select({ value: songArtistsTable.songId })
                        .from(songArtistsTable)
                        .where(
                            and(
                                eq(songArtistsTable.songId, songsTable.id),
                                inArray(songArtistsTable.artistId, artistIds),
                            ),
                        ),
                ),
            )
        }

        const genreIds = nonEmpty(query.filter.genreIds)
        if (genreIds) {
            conditions.push(
                exists(
                    this.database.db
                        .select({ value: songGenresTable.songId })
                        .from(songGenresTable)
                        .where(
                            and(
                                eq(songGenresTable.songId, songsTable.id),
                                inArray(songGenresTable.genreId, genreIds),
                            ),
                        ),
                ),
            )
        }

        const albumIds = nonEmpty(query.filter.albumIds)
        if (albumIds) conditions.push(inArray(songsTable.albumId, albumIds))

        // A song reaches its record label through its album — `songs` carries the
        // label only as denormalized text, and text is never what a filter addresses.
        const recordLabelIds = nonEmpty(query.filter.recordLabelIds)
        if (recordLabelIds) {
            conditions.push(
                exists(
                    this.database.db
                        .select({ value: albumsTable.id })
                        .from(albumsTable)
                        .where(
                            and(
                                eq(albumsTable.id, songsTable.albumId),
                                inArray(albumsTable.recordLabelId, recordLabelIds),
                            ),
                        ),
                ),
            )
        }

        return and(...conditions.filter((condition): condition is SQL => condition != null))
    }

    /**
     * The `ORDER BY`, always terminated by `songs.id`.
     *
     * That tiebreaker is load-bearing, not cosmetic: windows are separate `OFFSET`
     * queries, and rows with equal sort values have no guaranteed order between
     * them, so without it scrolling can show one song twice and skip another.
     *
     * It takes the *same* direction as the sort column so the pair matches an index
     * that SQLite can walk in one direction — `title DESC, id ASC` is not the reverse
     * of any single index, and would cost a temp B-tree on every window.
     */
    private songOrdering(sort: SongQuery['sort']): SQL[] {
        const direction = sort.direction == 'desc' ? desc : asc
        return [direction(sortColumns[sort.field]), direction(songsTable.id)]
    }

    /**
     * The artist credit for each song, as ordered segments.
     *
     * Ingest never splits a raw name (MAE-97 owns that), so in practice this returns
     * exactly one segment per song, whose `creditedAs` is `artistText` verbatim —
     * which is what lets the UI print `Burial & Four Tet` unchanged. Confirmed
     * splits already storable in `artist_raw_name_artists` produce several segments;
     * those have no stored join phrases yet, so they fall back to `, `.
     */
    private artistCredits(songIds: string[]): Map<string, ArtistCreditSegment[]> {
        const credits = new Map<string, ArtistCreditSegment[]>()
        if (songIds.length == 0) return credits

        const rows = this.database.db
            .select({
                songId: songArtistsTable.songId,
                artistId: artistsTable.id,
                name: artistsTable.name,
                artistText: songsTable.artistText,
            })
            .from(songArtistsTable)
            .innerJoin(artistsTable, eq(songArtistsTable.artistId, artistsTable.id))
            .innerJoin(songsTable, eq(songArtistsTable.songId, songsTable.id))
            .where(inArray(songArtistsTable.songId, songIds))
            .orderBy(asc(songArtistsTable.songId), asc(songArtistsTable.position))
            .all()

        const bySong = new Map<string, typeof rows>()
        for (const row of rows) {
            const existing = bySong.get(row.songId)
            if (existing) existing.push(row)
            else bySong.set(row.songId, [row])
        }

        for (const [songId, artists] of bySong) {
            const single = artists.length == 1 ? artists[0] : undefined
            credits.set(
                songId,
                single
                    ? [
                          {
                              artistId: single.artistId,
                              creditedAs: single.artistText ?? single.name,
                              joinPhrase: '',
                          },
                      ]
                    : artists.map((artist, position) => ({
                          artistId: artist.artistId,
                          creditedAs: artist.name,
                          joinPhrase: position < artists.length - 1 ? ', ' : '',
                      })),
            )
        }

        return credits
    }

    private genres(songIds: string[]): Map<string, CatalogEntityRef[]> {
        const genres = new Map<string, CatalogEntityRef[]>()
        if (songIds.length == 0) return genres

        const rows = this.database.db
            .select({ songId: songGenresTable.songId, id: genresTable.id, name: genresTable.name })
            .from(songGenresTable)
            .innerJoin(genresTable, eq(songGenresTable.genreId, genresTable.id))
            .where(inArray(songGenresTable.songId, songIds))
            .orderBy(asc(songGenresTable.songId), asc(genresTable.name))
            .all()

        for (const row of rows) {
            const existing = genres.get(row.songId)
            if (existing) existing.push({ id: row.id, name: row.name })
            else genres.set(row.songId, [{ id: row.id, name: row.name }])
        }

        return genres
    }

    private entityNames<TTable extends CatalogEntityTable>(
        table: TTable,
        nameColumn: TTable['id'] | AnySQLiteColumn,
        ids: string[] | undefined,
    ): CatalogEntityRef[] {
        const requested = nonEmpty(ids)
        if (!requested) return []

        const found = new Map(
            this.database.db
                .select({ id: table.id, name: nameColumn })
                .from(table)
                .where(inArray(table.id, requested))
                .all()
                .map(row => [row.id, String(row.name)] as const),
        )

        // Requested order, not storage order: the chips should stay where the user
        // (or the URL) put them, and an unresolvable id just disappears.
        return requested.flatMap(id => {
            const name = found.get(id)
            return name == null ? [] : [{ id, name }]
        })
    }
}

/** The catalog tables a filter chip can name: an id and a human-readable label. */
type CatalogEntityTable =
    typeof artistsTable | typeof genresTable | typeof recordLabelsTable | typeof albumsTable

const sortColumns: Record<SongSortField, AnySQLiteColumn> = {
    [SongSortField.title]: songsTable.title,
    [SongSortField.artist]: songsTable.artistText,
    [SongSortField.album]: songsTable.albumTitle,
    [SongSortField.genre]: songsTable.genreText,
    [SongSortField.bpm]: songsTable.bpm,
    [SongSortField.musicalKey]: songsTable.musicalKey,
    [SongSortField.duration]: songsTable.duration,
    [SongSortField.year]: songsTable.year,
    [SongSortField.recordLabel]: songsTable.recordLabelText,
    [SongSortField.dateAdded]: songsTable.createdAt,
}

/** Treat an omitted and an empty id list identically, so filters compare by value. */
const nonEmpty = (ids: string[] | undefined): string[] | undefined =>
    ids != null && ids.length > 0 ? ids : undefined

/**
 * Clamp a requested window. The limit ceiling is what keeps "the renderer holds only
 * what is on screen" true even if a caller asks for more, and negative offsets from
 * an over-scrolled viewport are pulled back to the top rather than rejected.
 */
const normalizeWindow = (window: BrowseWindow): BrowseWindow => ({
    offset: Math.max(0, Math.trunc(window.offset)),
    limit: Math.min(BROWSE_WINDOW_MAX_LIMIT, Math.max(0, Math.trunc(window.limit))),
})

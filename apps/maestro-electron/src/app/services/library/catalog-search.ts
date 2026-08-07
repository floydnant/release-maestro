import { or, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { albumsTable, songsTable } from '../../database/drizzle.schema'

/**
 * The seam free-text catalog search lives behind.
 *
 * It is `LIKE '%…%'` today and that **will not hold** at the top of the supported
 * size range: a leading wildcard cannot use an index, so every search scans the
 * table. That is a known and accepted limitation (ADR 0004) — the point of this
 * module is that replacing it with FTS5 is one file, not a rewrite of five pages.
 *
 * Nothing outside this module may express search as SQL. Every browse surface's
 * predicate is built here, which is what keeps that swap to one file as slices 2–5
 * add surfaces.
 */

/** Escape the LIKE wildcards a user can type, so `100%` searches for a literal `100%`. */
const escapeLikePattern = (term: string): string => term.replace(/[\\%_]/g, character => `\\${character}`)

/**
 * The `%term%` a term searches for, or `undefined` when there is nothing to search
 * for. An all-whitespace term is treated as no search rather than as a search for a
 * space — otherwise a stray keystroke empties the table.
 */
const likePattern = (search: string): string | undefined => {
    const term = search.trim()
    return term ? `%${escapeLikePattern(term)}%` : undefined
}

/**
 * One column against one pattern.
 *
 * Matching is case-insensitive for ASCII (SQLite's `LIKE` default); accented
 * characters compare case-sensitively, which is a limitation of `LIKE` that FTS5
 * will fix.
 */
const matches = (column: AnySQLiteColumn, pattern: string): SQL => sql`${column} LIKE ${pattern} ESCAPE '\\'`

/** Match one term against a set of columns, or `undefined` when there is no term. */
const searchCondition = (search: string, columns: AnySQLiteColumn[]): SQL | undefined => {
    const pattern = likePattern(search)
    if (!pattern) return undefined

    return or(...columns.map(column => matches(column, pattern)))
}

/** Title, artist credit, album title and record label — what a user expects to search. */
export const songSearchCondition = (search: string): SQL | undefined =>
    searchCondition(search, [
        songsTable.title,
        songsTable.artistText,
        songsTable.albumTitle,
        songsTable.recordLabelText,
    ])

/**
 * Album title, album artist, record label and catalogue number, plus the track artists
 * and genres of the album's own songs.
 *
 * The last two are the ones that need justifying, because they reach through `songs`
 * for something `albums` does not carry. Both are attributes *of the record*: a
 * compilation's artists are exactly the artists on it, and a record's genre is tagged
 * per file because that is the only place a tag can live — an album that is half
 * dubstep is not findable any other way. Someone typing an artist's name wants the
 * records they appear on, not only the ones credited to them on the sleeve.
 *
 * Song *titles* remain deliberately excluded. Searching `remix` would return whole
 * records because of one track on them, and a tile gives no clue which song matched or
 * why — a song-title search belongs on the track list.
 *
 * The reach is a correlated `EXISTS` rather than a join, on the same rule as the entity
 * filters: an album with three matching songs must still be one row, and a join would
 * duplicate it and corrupt the total. It costs a seek into `songs_album_id_idx` per
 * candidate album, which is the same index the grid's track counts already walk.
 */
export const albumSearchCondition = (search: string): SQL | undefined => {
    const pattern = likePattern(search)
    if (!pattern) return undefined

    return or(
        matches(albumsTable.title, pattern),
        matches(albumsTable.artistText, pattern),
        matches(albumsTable.recordLabelText, pattern),
        matches(albumsTable.catalogNumber, pattern),
        sql`EXISTS (
            SELECT 1 FROM ${songsTable}
            WHERE ${songsTable.albumId} = ${albumsTable.id}
              AND (${matches(songsTable.artistText, pattern)} OR ${matches(songsTable.genreText, pattern)})
        )`,
    )
}

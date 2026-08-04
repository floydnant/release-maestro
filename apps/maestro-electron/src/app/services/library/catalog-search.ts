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
 * Match one term against a set of columns, or `undefined` when there is nothing to
 * search for. An all-whitespace term is treated as no search rather than as a search
 * for a space — otherwise a stray keystroke empties the table.
 *
 * Matching is case-insensitive for ASCII (SQLite's `LIKE` default); accented
 * characters compare case-sensitively, which is a limitation of `LIKE` that FTS5
 * will fix.
 */
const searchCondition = (search: string, columns: AnySQLiteColumn[]): SQL | undefined => {
    const term = search.trim()
    if (!term) return undefined

    const pattern = `%${escapeLikePattern(term)}%`
    return or(...columns.map(column => sql`${column} LIKE ${pattern} ESCAPE '\\'`))
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
 * Album title, album artist and record label.
 *
 * Deliberately **not** the titles of the album's songs. Searching `remix` would then
 * return whole records because of one track on them, and a tile gives no clue which
 * song matched or why — a song-title search belongs on the track list.
 */
export const albumSearchCondition = (search: string): SQL | undefined =>
    searchCondition(search, [albumsTable.title, albumsTable.artistText, albumsTable.recordLabelText])

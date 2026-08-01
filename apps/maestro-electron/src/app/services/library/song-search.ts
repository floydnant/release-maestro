import { or, sql, type SQL } from 'drizzle-orm'
import type { AnySQLiteColumn } from 'drizzle-orm/sqlite-core'
import { songsTable } from '../../database/drizzle.schema'

/**
 * The seam free-text song search lives behind.
 *
 * It is `LIKE '%…%'` today and that **will not hold** at the top of the supported
 * size range: a leading wildcard cannot use an index, so every search scans the
 * table. That is a known and accepted limitation (ADR 0004) — the point of this
 * module is that replacing it with FTS5 is one file, not a rewrite of five pages.
 *
 * Nothing outside this module may express search as SQL.
 */

/** Escape the LIKE wildcards a user can type, so `100%` searches for a literal `100%`. */
const escapeLikePattern = (term: string): string => term.replace(/[\\%_]/g, character => `\\${character}`)

/**
 * Build the search predicate for one term, or `undefined` when there is nothing to
 * search for. An all-whitespace term is treated as no search rather than as a
 * search for a space — otherwise a stray keystroke empties the table.
 *
 * The term is matched against the columns a user would expect to be searching:
 * title, artist credit, release title and record label. Matching is
 * case-insensitive for ASCII (SQLite's `LIKE` default) — accented characters
 * compare case-sensitively, which is a limitation of `LIKE` that FTS5 will fix.
 */
export const songSearchCondition = (search: string): SQL | undefined => {
    const term = search.trim()
    if (!term) return undefined

    const pattern = `%${escapeLikePattern(term)}%`
    const matches = (column: AnySQLiteColumn) => sql`${column} LIKE ${pattern} ESCAPE '\\'`

    return or(
        matches(songsTable.title),
        matches(songsTable.artistText),
        matches(songsTable.albumTitle),
        matches(songsTable.recordLabelText),
    )
}

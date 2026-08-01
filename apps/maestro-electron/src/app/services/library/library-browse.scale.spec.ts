import { emptySongQuery, SongSortField, type SongSort, type SongQuery } from '@release-maestro/core'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'fs'
import { join } from 'path'
import { DatabaseClient } from '../../database/database.client'
import * as schema from '../../database/drizzle.schema'
import { LibraryBrowseRepository } from './library-browse.repository'

/**
 * The scale check.
 *
 * Rows go straight into SQLite — no scan, no metadata engine — because the only
 * thing under test is whether a browse query still holds up at library size. This
 * is the only test in the suite that can catch a missing index: every correctness
 * test passes just as happily against a full table scan.
 *
 * The wall-clock budget is a smoke check with deliberate headroom, so it does not
 * turn into a flaky CI failure on a loaded machine. The load-bearing assertion is
 * the query plan: a sort that falls back to `USE TEMP B-TREE FOR ORDER BY` is
 * building an ordering over every row in the table on every window, and that is a
 * missing index no matter how fast the machine happens to be.
 */

const SONG_COUNT = 50_000
/** Deep enough that a table scan cannot fake it, and where OFFSET paging actually hurts. */
const DEEP_OFFSET = 45_000
const WINDOW_BUDGET_MS = 250

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

const KEYS = ['1A', '4A', '8A', '9A', '11B', '12B']
const GENRES = ['UK Garage', 'Dubstep', 'Ambient', 'Techno', 'Jungle']
const LABELS = ['Hyperdub', 'Warp', 'Ninja Tune', 'Text', 'R&S']

describe('LibraryBrowseRepository at library scale', () => {
    let sqlite: Database.Database
    let repository: LibraryBrowseRepository

    beforeAll(() => {
        sqlite = new Database(':memory:')
        sqlite.pragma('foreign_keys = ON')
        const db = drizzle(sqlite, { schema })
        migrate(db, { migrationsFolder })

        const insert = sqlite.prepare(
            `INSERT INTO songs (
                id, path, file_name, size, modified_at, created_at, file_fingerprint, last_seen_at,
                present, title, artist_text, album_title, genre_text, record_label_text,
                year, bpm, musical_key, duration, external_refs
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, '{}')`,
        )
        const seed = sqlite.transaction(() => {
            for (let index = 0; index < SONG_COUNT; index++) {
                const id = `song-${index.toString().padStart(6, '0')}`
                insert.run(
                    id,
                    `/music/${id}.flac`,
                    `${id}.flac`,
                    1_024,
                    1_750_000_000_000,
                    1_740_000_000_000 + index,
                    `fingerprint-${index}`,
                    1_750_000_000_000,
                    `Track ${(index * 7919) % SONG_COUNT}`,
                    `Artist ${index % 2_000}`,
                    `Release ${index % 5_000}`,
                    GENRES[index % GENRES.length]!,
                    LABELS[index % LABELS.length]!,
                    1990 + (index % 36),
                    // A coarse BPM grid so plenty of rows tie and the id tiebreaker matters.
                    100 + (index % 60),
                    KEYS[index % KEYS.length]!,
                    120 + (index % 300),
                )
            }
        })
        seed()
        sqlite.exec('ANALYZE')

        repository = new LibraryBrowseRepository({ db } as unknown as DatabaseClient)
    })

    afterAll(() => sqlite.close())

    const sorts: SongSort[] = Object.values(SongSortField).flatMap(field => [
        { field, direction: 'asc' as const },
        { field, direction: 'desc' as const },
    ])

    it.each(sorts)('sorts by $field $direction from an index, not a temp B-tree', sort => {
        const plan = queryPlan(sqlite, sort)

        expect(plan).not.toMatch(/TEMP B-TREE/i)
        expect(plan).toMatch(/USING (COVERING )?INDEX songs_/)
    })

    it.each(sorts)('serves a deep window sorted by $field $direction within budget', sort => {
        const query: SongQuery = { ...emptySongQuery(), sort }

        const startedAt = performance.now()
        const result = repository.querySongs({ query, window: { offset: DEEP_OFFSET, limit: 100 } })
        const elapsed = performance.now() - startedAt

        expect(result.total).toBe(SONG_COUNT)
        expect(result.rows).toHaveLength(100)
        expect(elapsed).toBeLessThan(WINDOW_BUDGET_MS)
    })

    it('keeps consecutive deep windows disjoint when sort values tie', () => {
        // BPM has ~830 rows per value at this size, so the whole window sits inside
        // one tie group — exactly where an unstable ordering loses and repeats rows.
        const query: SongQuery = { ...emptySongQuery(), sort: { field: SongSortField.bpm, direction: 'asc' } }

        const first = repository.querySongs({ query, window: { offset: DEEP_OFFSET, limit: 100 } })
        const second = repository.querySongs({ query, window: { offset: DEEP_OFFSET + 100, limit: 100 } })

        const ids = [...first.rows, ...second.rows].map(row => row.id)
        expect(new Set(ids).size).toBe(200)
    })

    it('counts a filtered query without walking the whole table into memory', () => {
        const query: SongQuery = { ...emptySongQuery(), search: 'Track 4999' }

        const startedAt = performance.now()
        const result = repository.querySongs({ query, window: { offset: 0, limit: 50 } })
        const elapsed = performance.now() - startedAt

        expect(result.total).toBeGreaterThan(0)
        // Search is `LIKE '%…%'` and cannot use an index by design (ADR 0004) — this
        // asserts the accepted cost stays bounded, not that it is indexed.
        expect(elapsed).toBeLessThan(2_000)
    })
})

/** The plan for the exact ordering the repository emits, including the id tiebreaker. */
const queryPlan = (sqlite: Database.Database, sort: SongSort): string => {
    const column = planColumns[sort.field]
    const direction = sort.direction.toUpperCase()
    const rows = sqlite
        .prepare(
            `EXPLAIN QUERY PLAN SELECT id FROM songs
             ORDER BY ${column} ${direction}, id ${direction} LIMIT 100 OFFSET ${DEEP_OFFSET}`,
        )
        .all() as { detail: string }[]
    return rows.map(row => row.detail).join('\n')
}

const planColumns: Record<SongSortField, string> = {
    [SongSortField.title]: 'title',
    [SongSortField.artist]: 'artist_text',
    [SongSortField.release]: 'album_title',
    [SongSortField.genre]: 'genre_text',
    [SongSortField.bpm]: 'bpm',
    [SongSortField.musicalKey]: 'musical_key',
    [SongSortField.duration]: 'duration',
    [SongSortField.year]: 'year',
    [SongSortField.recordLabel]: 'record_label_text',
    [SongSortField.dateAdded]: 'created_at',
}

import {
    emptySongQuery,
    SongPresence,
    SongSortField,
    type SongQuery,
    type SongSort,
} from '@release-maestro/core'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'fs'
import { join } from 'path'
import { DatabaseClient } from '../../database/database.client'
import * as schema from '../../database/drizzle.schema'
import { songsTable } from '../../database/drizzle.schema'
import { LibraryBrowseRepository } from './library-browse.repository'

/**
 * The scale check.
 *
 * Rows go straight into SQLite — no scan, no metadata engine — because the only
 * thing under test is whether a browse query still holds up at library size. This
 * is the only test in the suite that can catch a missing index: every correctness
 * test passes just as happily against a full table scan.
 *
 * **Nothing here asserts a wall-clock time.** A budget measured on a developer's
 * machine says nothing about a shared CI runner, and a number loose enough to be
 * safe there is too loose to catch anything. What this asserts instead is the query
 * *plan*: a sort that falls back to `USE TEMP B-TREE FOR ORDER BY` is building an
 * ordering over every row in the table on every window, and that is a missing index
 * no matter how fast the machine happens to be. Deep-`OFFSET` cost is a known,
 * accepted property of the paging model (ADR 0004) rather than something a test can
 * usefully police.
 *
 * The statement it explains is the repository's own window query, and rows are seeded
 * through Drizzle — both so a schema change breaks this loudly at compile time rather
 * than leaving it silently checking the wrong thing.
 */

const SONG_COUNT = 50_000
/** Deep enough that a table scan cannot fake it, and where OFFSET paging actually hurts. */
const DEEP_OFFSET = 45_000

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
    let db: ReturnType<typeof drizzle<typeof schema>>
    let repository: LibraryBrowseRepository

    /**
     * The plan for the window query the repository actually runs.
     *
     * Taken from the repository through `songWindowSql`, not rebuilt here. A minimal
     * `select(id).from(songs).orderBy(…)` stand-in explains a different statement from
     * production's sixteen columns, album left-join and filter predicates — so a join
     * or a predicate that defeated the ordering index would explain clean and the
     * check would pass while the real query fell back to a temp B-tree.
     */
    const queryPlan = (query: SongQuery): string => {
        const { sql, params } = repository.songWindowSql({
            query,
            window: { offset: DEEP_OFFSET, limit: 100 },
        })

        const rows = sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(...params) as { detail: string }[]
        return rows.map(row => row.detail).join('\n')
    }

    beforeAll(() => {
        sqlite = new Database(':memory:')
        sqlite.pragma('foreign_keys = ON')
        db = drizzle(sqlite, { schema })
        migrate(db, { migrationsFolder })

        const rows: (typeof songsTable.$inferInsert)[] = Array.from({ length: SONG_COUNT }, (_row, index) => {
            const id = `song-${index.toString().padStart(6, '0')}`
            return {
                id,
                path: `/music/${id}.flac`,
                fileName: `${id}.flac`,
                size: 1_024,
                modifiedAt: new Date(1_750_000_000_000),
                createdAt: new Date(1_740_000_000_000 + index),
                fileFingerprint: `fingerprint-${index}`,
                lastSeenAt: new Date(1_750_000_000_000),
                present: true,
                // Shuffled against the id, so nothing sorts in insertion order by luck.
                title: `Track ${(index * 7919) % SONG_COUNT}`,
                artistText: `Artist ${index % 2_000}`,
                albumTitle: `Album ${index % 5_000}`,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                genreText: GENRES[index % GENRES.length]!,
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                recordLabelText: LABELS[index % LABELS.length]!,
                year: 1990 + (index % 36),
                // A coarse BPM grid so plenty of rows tie and the id tiebreaker matters.
                bpm: 100 + (index % 60),
                // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                musicalKey: KEYS[index % KEYS.length]!,
                duration: 120 + (index % 300),
            } satisfies typeof songsTable.$inferInsert
        })

        // Chunked because SQLite caps bound parameters per statement, and 50k rows of
        // twenty columns is far past it.
        db.transaction(tx => {
            for (let start = 0; start < rows.length; start += 500) {
                tx.insert(songsTable)
                    .values(rows.slice(start, start + 500))
                    .run()
            }
        })
        sqlite.exec('ANALYZE')

        repository = new LibraryBrowseRepository({ db } as unknown as DatabaseClient)
    })

    afterAll(() => sqlite.close())

    const sorts: SongSort[] = Object.values(SongSortField).flatMap(field => [
        { field, direction: 'asc' as const },
        { field, direction: 'desc' as const },
    ])

    it.each(sorts)('sorts by $field $direction from an index, not a temp B-tree', sort => {
        const plan = queryPlan({ ...emptySongQuery(), sort })

        expect(plan).not.toMatch(/TEMP B-TREE/i)
        expect(plan).toMatch(/USING (COVERING )?INDEX songs_/)
    })

    it('still sorts from an index when a filter narrows the window', () => {
        // The predicate is what a chip click sends, and it rides on the same statement
        // as the ordering. An `EXISTS` subquery that SQLite chose to drive the outer
        // query from would cost the ordering its index and the sort a temp B-tree.
        const plan = queryPlan({
            ...emptySongQuery(),
            filter: { ...emptySongQuery().filter, presence: SongPresence.present },
            sort: { field: SongSortField.title, direction: 'asc' },
        })

        expect(plan).not.toMatch(/TEMP B-TREE/i)
        expect(plan).toMatch(/USING (COVERING )?INDEX songs_/)
    })

    it.each(sorts)('serves a full deep window sorted by $field $direction', sort => {
        const query: SongQuery = { ...emptySongQuery(), sort }

        const result = repository.querySongs({ query, window: { offset: DEEP_OFFSET, limit: 100 } })

        expect(result.total).toBe(SONG_COUNT)
        expect(result.rows).toHaveLength(100)
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

    it('serves a searched window without loading the matches into memory', () => {
        // Search is `LIKE '%…%'` and cannot use an index by design (ADR 0004). What is
        // worth asserting is that it is still *windowed*: the total counts every match
        // while only the window's rows are materialised.
        const query: SongQuery = { ...emptySongQuery(), search: 'Track 4999' }

        const result = repository.querySongs({ query, window: { offset: 0, limit: 50 } })

        expect(result.total).toBeGreaterThan(0)
        expect(result.rows.length).toBeLessThanOrEqual(50)
        expect(result.rows.length).toBeLessThanOrEqual(result.total)
    })
})

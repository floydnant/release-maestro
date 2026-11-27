import { createMigratedTestDatabase } from './database.fixture'

/** Persist interrupted moves without running metadata extraction for a scale test. */
export const seedPendingMoves = (
    database: ReturnType<typeof createMigratedTestDatabase>,
    shape: 'pairs' | 'chain',
    count: number,
): void => {
    const insert = database.sqlite.prepare(`
        INSERT INTO songs (id, path, file_name, size, modified_at, file_fingerprint,
            scanned_file_fingerprint, last_seen_at, first_seen_at, last_available_at,
            title, content_hash, move_origin_id)
        VALUES (?, ?, 'song.flac', ?, 1000, 'fingerprint', 'fingerprint', ?, ?, ?, 'Song', ?, ?)
    `)
    database.sqlite.transaction(() => {
        if (shape == 'chain') insert.run('o0', '/old/0.flac', 1000, 1000, 1000, 1000, 'hash0', null)
        for (let i = 0; i < count; i++) {
            const origin = shape == 'pairs' ? i : 0
            const seenAt = shape == 'pairs' ? 2000 : 2000 + i
            if (shape == 'pairs')
                insert.run(`o${i}`, `/old/${i}.flac`, i + 1000, 1000, 1000, 1000, `hash${i}`, null)
            insert.run(
                `d${i}`,
                `/new/${i}.flac`,
                origin + 1000,
                seenAt,
                seenAt,
                seenAt,
                `hash${origin}`,
                `o${origin}`,
            )
        }
    })()
}

import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { existsSync } from 'fs'
import { join } from 'path'
import { DatabaseClient } from '../../app/database/database.client'
import * as schema from '../../app/database/drizzle.schema'

const migrationsFolderCandidates = [join(process.cwd(), 'drizzle'), join(__dirname, '../../../../../drizzle')]

/** An in-memory database with every migration applied, wrapped as the client repositories take. */
export const createMigratedTestDatabase = () => {
    const migrationsFolder = migrationsFolderCandidates.find(candidate =>
        existsSync(join(candidate, 'meta', '_journal.json')),
    )
    if (!migrationsFolder) {
        throw new Error(`Could not locate drizzle migrations from ${migrationsFolderCandidates.join(', ')}`)
    }

    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    migrate(db, { migrationsFolder })

    return { sqlite, db, client: { db } as unknown as DatabaseClient }
}

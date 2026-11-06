import Database from 'better-sqlite3'
import { fromPartial } from '@total-typescript/shoehorn'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { DatabaseClient } from '../../app/database/database.client'
import * as schema from '../../app/database/drizzle.schema'

const migrationsFolderCandidates = [join(process.cwd(), 'drizzle'), join(__dirname, '../../../../../drizzle')]

const locateMigrationsFolder = (): string => {
    const migrationsFolder = migrationsFolderCandidates.find(candidate =>
        existsSync(join(candidate, 'meta', '_journal.json')),
    )
    if (!migrationsFolder) {
        throw new Error(`Could not locate drizzle migrations from ${migrationsFolderCandidates.join(', ')}`)
    }
    return migrationsFolder
}

const createTestDatabase = () => {
    const sqlite = new Database(':memory:')
    sqlite.pragma('foreign_keys = ON')
    const db = drizzle(sqlite, { schema })
    return { sqlite, db, client: fromPartial<DatabaseClient>({ db }) }
}

/** An in-memory database with every migration applied, wrapped as the client repositories take. */
export const createMigratedTestDatabase = () => {
    const database = createTestDatabase()
    migrate(database.db, { migrationsFolder: locateMigrationsFolder() })
    return database
}

/**
 * An in-memory database migrated up to and including the migration `tag`, for arranging rows in an
 * older shape. `migrateToLatest` then applies the remaining migrations.
 */
export const createTestDatabaseMigratedThrough = (tag: string) => {
    const migrationsFolder = locateMigrationsFolder()
    const journalPath = join('meta', '_journal.json')
    const journal: { entries: { tag: string }[] } = JSON.parse(
        readFileSync(join(migrationsFolder, journalPath), 'utf-8'),
    )
    const last = journal.entries.findIndex(entry => entry.tag === tag)
    if (last === -1) throw new Error(`Unknown migration ${tag}`)

    const partialFolder = mkdtempSync(join(tmpdir(), 'maestro-migrations-'))
    const database = createTestDatabase()
    try {
        cpSync(migrationsFolder, partialFolder, { recursive: true })
        writeFileSync(
            join(partialFolder, journalPath),
            JSON.stringify({ ...journal, entries: journal.entries.slice(0, last + 1) }),
        )
        migrate(database.db, { migrationsFolder: partialFolder })
    } finally {
        rmSync(partialFolder, { recursive: true, force: true })
    }
    return { ...database, migrateToLatest: () => migrate(database.db, { migrationsFolder }) }
}

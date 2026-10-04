import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import fs from 'fs/promises'
import { join } from 'path'
import { appPaths } from '../app-env'
import { createMainLogger } from '../logging/logger'
import { PROVIDER_DESTROY, PROVIDER_INIT } from '../utils/dependency-injection.util'
import * as schema from './drizzle.schema'

const log = createMainLogger('database')

export class DatabaseClient {
    private _sqlite: Database.Database | null = null
    private _db: ReturnType<typeof drizzle> | null = null

    get db(): ReturnType<typeof drizzle> {
        if (!this._db) {
            throw new Error('Database not initialized. Call initialize() first.')
        }
        return this._db
    }

    async [PROVIDER_INIT]() {
        try {
            await this.initialize()
        } catch (error) {
            log.error('database.initialize.failed', error)
        }
    }
    async [PROVIDER_DESTROY]() {
        try {
            await this.disconnect()
        } catch (error) {
            log.error('database.disconnect.failed', error)
        }
    }

    async initialize(): Promise<void> {
        if (this._db) {
            return
        }

        const dbPath = join(appPaths.data, 'mailbox-tool.db')
        const exists = await fs
            .stat(dbPath)
            .then(() => true)
            .catch(() => false)
        if (!exists) {
            await fs.mkdir(appPaths.data, { recursive: true })
        }
        log.info('database.initialize.started', { newDatabase: !exists })

        this._sqlite = new Database(dbPath)
        this._sqlite.pragma('foreign_keys = ON')
        this._db = drizzle(this._sqlite, { schema })

        await this.runMigrations()
    }

    async disconnect(): Promise<void> {
        if (this._sqlite) {
            this._sqlite.close()
            this._sqlite = null
            this._db = null
        }
    }

    async runMigrations(): Promise<void> {
        if (!this._db) {
            throw new Error('Database not initialized. Call initialize() first.')
        }

        try {
            const migrationsPath = join(appPaths.resources, 'drizzle')
            log.info('database.migrations.started')
            migrate(this._db, { migrationsFolder: migrationsPath })
            log.info('database.migrations.completed')
        } catch (error) {
            log.error('database.migrations.failed', error)
            throw error
        }
    }
}

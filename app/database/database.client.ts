import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { join } from 'path'
import { app } from 'electron'
import { PROVIDER_DESTROY, PROVIDER_INIT } from '../utils/dependency-injection.util'
import * as schema from './drizzle.schema'

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
            console.error('Failed to initialize database:', error)
        }
    }
    async [PROVIDER_DESTROY]() {
        try {
            await this.disconnect()
        } catch (error) {
            console.error('Error disconnecting from database:', error)
        }
    }

    async initialize(): Promise<void> {
        if (this._db) {
            return
        }

        const userDataPath = app.getPath('userData')
        const dbPath = join(userDataPath, 'mailbox-tool.db')
        console.log(`Initializing database at: ${dbPath}`)

        this._sqlite = new Database(dbPath)
        this._db = drizzle(this._sqlite, { schema })

        await this.runMigrations()

        console.log('Database initialized successfully')
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
            console.log('Running database migrations...')

            const appPath = app.getAppPath()
            const migrationsPath = join(appPath, 'drizzle')

            migrate(this._db, { migrationsFolder: migrationsPath })

            console.log('Database migrations completed successfully')
        } catch (error) {
            console.error('Failed to run migrations:', error)
            throw error
        }
    }
}

import { defineConfig } from 'drizzle-kit'
import { appEnv } from './app/app-env'

export default defineConfig({
    schema: './app/database/drizzle.schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    verbose: true,
    dbCredentials: {
        url: process.env.DATABASE_URL || appEnv.DATABASE_URL,
    },
})

import { defineConfig } from 'drizzle-kit'
import { appEnv } from './app/app-env'

export default defineConfig({
    schema: './app/database/drizzle.schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    verbose: true,
    dbCredentials: {
        url: appEnv.DATABASE_URL,
    },
})

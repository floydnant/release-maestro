import { defineConfig } from 'drizzle-kit'

const dbUrl = process.env.DATABASE_URL
if (!dbUrl) {
    throw new Error('DATABASE_URL is not set in environment variables')
}

export default defineConfig({
    schema: './app/database/drizzle.schema.ts',
    out: './drizzle',
    dialect: 'sqlite',
    verbose: true,
    dbCredentials: {
        url: dbUrl,
    },
})

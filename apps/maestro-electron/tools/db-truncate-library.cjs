/**
 * Dev utility: wipe all library data while keeping the rest of the app intact.
 *
 * Truncates every table in the dev database EXCEPT migrations (`__drizzle*`),
 * sqlite internals (`sqlite_*`), and the feed tables (`feed_*`), then deletes the
 * `library-state.json` scan-state sidecar (checks the legacy config location too).
 *
 * Run through Electron so the electron-ABI `better-sqlite3` build loads:
 *   make db-truncate-library
 * Honors RELEASE_MAESTRO_APP_DATA_DIR; defaults to ./.app-data.dev
 */
const Database = require('better-sqlite3')
const { existsSync, readFileSync, rmSync, writeFileSync } = require('node:fs')
const { join, resolve } = require('node:path')

const appDataRoot = process.env.RELEASE_MAESTRO_APP_DATA_DIR
    ? resolve(process.env.RELEASE_MAESTRO_APP_DATA_DIR)
    : join(process.cwd(), '.app-data.dev')
const dbPath = join(appDataRoot, 'data', 'mailbox-tool.db')
const settingsPath = join(appDataRoot, 'config', 'settings.json')
const libraryStatePaths = [
    join(appDataRoot, 'data', 'library-state.json'),
]
const LIBRARY_SETTINGS_KEYS = ['libraryFolders', 'libraryOnboardingSkipped']

const KEEP_PATTERNS = [/^sqlite_/, /^__drizzle/, /^feed_/]

if (!existsSync(dbPath)) {
    console.log(`No database at ${dbPath} — nothing to truncate.`)
} else {
    const db = new Database(dbPath)
    const tables = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
        .all()
        .map(row => row.name)
    const truncate = tables.filter(name => !KEEP_PATTERNS.some(pattern => pattern.test(name)))
    const keep = tables.filter(name => KEEP_PATTERNS.some(pattern => pattern.test(name)))

    db.pragma('foreign_keys = OFF')
    const run = db.transaction(() => {
        for (const table of truncate) {
            const { changes } = db.prepare(`DELETE FROM "${table}"`).run()
            console.log(`truncated ${table} (${changes} rows)`)
        }
    })
    run()
    db.pragma('foreign_keys = ON')
    db.exec('VACUUM')
    db.close()
    console.log(`kept: ${keep.join(', ') || '(none)'}`)
}

for (const statePath of libraryStatePaths) {
    if (existsSync(statePath)) {
        rmSync(statePath)
        console.log(`deleted ${statePath}`)
    }
}

if (existsSync(settingsPath)) {
    const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
    const removed = LIBRARY_SETTINGS_KEYS.filter(key => key in settings)
    for (const key of removed) delete settings[key]
    if (removed.length > 0) {
        writeFileSync(settingsPath, JSON.stringify(settings, null, '\t') + '\n')
        console.log(`removed from settings.json: ${removed.join(', ')}`)
    }
}

console.log('Done.')

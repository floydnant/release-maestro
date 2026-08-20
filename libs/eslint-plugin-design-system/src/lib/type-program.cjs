/**
 * A TypeScript `Program` for the component a template belongs to, built lazily and reused across the
 * lint process.
 *
 * The syntactic resolver in `member-classes.cjs` answers from one file's AST, which is free but
 * blind: `as const`, a union alias, a vocabulary declared next to the component instead of inside
 * it, an inherited member — all of them are closed sets that a parse cannot see and a `TypeChecker`
 * can. This module is what makes the checker affordable enough to reach for.
 *
 * Two properties do that, both measured on the renderer's 61-root program (540 files):
 *
 * - **Lazy.** Nothing here runs until a class binding names a component member the syntactic tier
 *   could not enumerate. A template with no dynamic class list never builds a program at all, so the
 *   cost lands on the files that need it rather than on the lint run.
 * - **Reused.** The first build costs ~1.1s; every rebuild after an edit costs ~80ms, because the
 *   host caches source files by mtime and `createProgram` is handed the previous program to salvage.
 *   In an editor, where ESLint is a long-lived server, that first second is paid once per session.
 *
 * Deliberately not a watch program: `ts.createWatchProgram` reaches the same incremental cost but
 * installs file watchers, and ESLint gives a rule no teardown hook to close them with.
 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

/**
 * In preference order, and all three are tried in the same directory before moving up: an Nx
 * project's `tsconfig.json` is usually a solution file with `files: []`, so the one that actually
 * includes the component is a sibling.
 */
const CONFIG_NAMES = ['tsconfig.app.json', 'tsconfig.lib.json', 'tsconfig.spec.json', 'tsconfig.json']

/** @type {Map<string, { mtimeMs: number, parsed: ts.ParsedCommandLine|null }>} */
const configCache = new Map()

/** @type {Map<string, string|null>} */
const configForFileCache = new Map()

/**
 * @typedef {object} ProgramEntry
 * @property {ts.Program} program
 * @property {ts.CompilerHost} host
 * @property {ts.ParsedCommandLine} parsed
 */

/** @type {Map<string, ProgramEntry>} */
const programCache = new Map()

/** @param {string} filePath */
const mtimeOf = filePath => {
    try {
        return fs.statSync(filePath).mtimeMs
    } catch {
        return -1
    }
}

/**
 * @param {string} configPath
 * @returns {ts.ParsedCommandLine|null} null when the file is not a readable tsconfig
 */
function parseConfig(configPath) {
    const mtimeMs = mtimeOf(configPath)
    if (mtimeMs === -1) return null

    const cached = configCache.get(configPath)
    if (cached && cached.mtimeMs === mtimeMs) return cached.parsed

    /** @type {ts.ParsedCommandLine|null} */
    let parsed = null
    try {
        // A config that cannot be read is not a finding — the walk simply moves on to the next
        // candidate — so the diagnostic is swallowed rather than surfaced.
        let unreadable = false
        const host = {
            ...ts.sys,
            onUnRecoverableConfigFileDiagnostic: () => {
                unreadable = true
            },
        }
        const candidate = ts.getParsedCommandLineOfConfigFile(configPath, {}, host)
        parsed = unreadable ? null : (candidate ?? null)
    } catch {
        parsed = null
    }

    configCache.set(configPath, { mtimeMs, parsed })
    return parsed
}

/**
 * The nearest tsconfig that actually lists this file. "Nearest" is not enough on its own — an Nx
 * app's `tsconfig.json` sits beside `tsconfig.app.json` and includes nothing — so membership is
 * checked rather than assumed, and a config that does not cover the file is skipped.
 *
 * @param {string} filePath an absolute path to a `.ts` file
 * @returns {string|null}
 */
function configForFile(filePath) {
    const cached = configForFileCache.get(filePath)
    if (cached !== undefined) return cached

    const target = path.resolve(filePath)
    let found = /** @type {string|null} */ (null)

    for (let dir = path.dirname(target); !found; ) {
        for (const name of CONFIG_NAMES) {
            const candidate = path.join(dir, name)
            const parsed = parseConfig(candidate)
            if (!parsed || parsed.fileNames.length === 0) continue
            if (parsed.fileNames.some(fileName => path.resolve(fileName) === target)) {
                found = candidate
                break
            }
        }

        const parent = path.dirname(dir)
        if (parent === dir) break
        dir = parent
    }

    configForFileCache.set(filePath, found)
    return found
}

/**
 * A compiler host whose source files are cached by mtime, so rebuilding a program re-reads only what
 * changed and `oldProgram` can reuse the rest.
 *
 * @param {ts.CompilerOptions} options
 * @returns {ts.CompilerHost}
 */
function createCachingHost(options) {
    /** @type {Map<string, { mtimeMs: number, file: ts.SourceFile|undefined }>} */
    const files = new Map()
    const base = ts.createCompilerHost(options, true)

    return {
        ...base,
        getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile) {
            const mtimeMs = mtimeOf(fileName)
            const cached = files.get(fileName)
            if (cached && cached.mtimeMs === mtimeMs) return cached.file

            const file = base.getSourceFile(fileName, languageVersion, onError, shouldCreateNewSourceFile)
            files.set(fileName, { mtimeMs, file })
            return file
        },
    }
}

/**
 * Whether anything the program was built from has changed on disk. Only the project's own files are
 * checked: `node_modules` declarations do not change inside a lint run, and statting them would cost
 * more than the check saves.
 *
 * @param {ts.Program} program
 * @returns {boolean}
 */
function isStale(program) {
    for (const source of program.getSourceFiles()) {
        if (source.fileName.includes('/node_modules/')) continue
        // `ts.SourceFile` carries no mtime, so the one it was read at is stamped on it after each build.
        const recorded = /** @type {ts.SourceFile & { __mtimeMs?: number }} */ (source).__mtimeMs
        if (recorded !== undefined && recorded !== mtimeOf(source.fileName)) return true
    }
    return false
}

/**
 * The program covering `filePath`, built on first use and rebuilt when the project's files change.
 *
 * @param {string} filePath an absolute path to a `.ts` file
 * @param {string} [explicitConfig] a tsconfig from the rule options, which skips discovery
 * @returns {{ program: ts.Program, checker: ts.TypeChecker }|null} null when no tsconfig covers the
 *   file, which is the honest answer for a component outside every project in the workspace
 */
function programFor(filePath, explicitConfig) {
    const configPath = explicitConfig ? path.resolve(explicitConfig) : configForFile(filePath)
    if (!configPath) return null

    const parsed = parseConfig(configPath)
    if (!parsed) return null

    const existing = programCache.get(configPath)
    if (existing && !isStale(existing.program)) {
        return { program: existing.program, checker: existing.program.getTypeChecker() }
    }

    const host = existing ? existing.host : createCachingHost(parsed.options)
    const program = ts.createProgram({
        rootNames: parsed.fileNames,
        options: parsed.options,
        host,
        oldProgram: existing?.program,
    })

    // Stamp every file with the mtime it was read at, so the next staleness check has a baseline.
    for (const source of program.getSourceFiles()) {
        if (source.fileName.includes('/node_modules/')) continue
        /** @type {ts.SourceFile & { __mtimeMs?: number }} */ (source).__mtimeMs = mtimeOf(source.fileName)
    }

    programCache.set(configPath, { program, host, parsed })
    return { program, checker: program.getTypeChecker() }
}

module.exports = { configForFile, programFor }

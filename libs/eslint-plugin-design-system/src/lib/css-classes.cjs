/**
 * Harvests the class names that authored CSS actually declares — global styles, the generated
 * design-token stylesheet, and the styles a component brings with it. Nothing here is maintained by
 * hand: the stylesheets are the allowlist.
 */
const fs = require('node:fs')
const path = require('node:path')
const postcss = require('postcss')
const { readComponentMetadata } = require('./component-metadata.cjs')

const CLASS_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g
const IMPORT_RULE = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g

/**
 * Parsed files are cached by mtime — a whole `nx lint` run touches the same global stylesheets once
 * per template otherwise.
 *
 * @template T
 * @typedef {Map<string, { mtimeMs: number, parsed: T }>} MtimeCache
 */

/** @type {MtimeCache<{ classes: Set<string>, imports: string[] }>} */
const stylesheetCache = new Map()

/** @type {MtimeCache<Set<string>>} */
const componentCache = new Map()

/**
 * @template T
 * @param {MtimeCache<T>} cache
 * @param {string} filePath
 * @param {(source: string) => T} produce
 * @param {T} whenMissing value to use when the file cannot be read at all
 * @returns {T}
 */
function readCached(cache, filePath, produce, whenMissing) {
    let stat
    try {
        stat = fs.statSync(filePath)
    } catch {
        return whenMissing
    }

    const cached = cache.get(filePath)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.parsed

    const parsed = produce(fs.readFileSync(filePath, 'utf8'))
    cache.set(filePath, { mtimeMs: stat.mtimeMs, parsed })
    return parsed
}

/**
 * @param {string} cssText
 * @param {Set<string>} [into]
 * @returns {Set<string>}
 */
function classesFromCssText(cssText, into = new Set()) {
    let root
    try {
        root = postcss.parse(cssText)
    } catch {
        return into
    }

    root.walkRules(rule => {
        for (const match of rule.selector.matchAll(CLASS_SELECTOR)) into.add(match[1])
    })
    return into
}

/**
 * Follows relative `@import`s so a global stylesheet implies the generated token stylesheet.
 *
 * @param {string} filePath
 * @param {Set<string>} [seen] guards against an import cycle
 * @returns {Set<string>}
 */
function classesFromCssFile(filePath, seen = new Set()) {
    const resolved = path.resolve(filePath)
    if (seen.has(resolved)) return new Set()
    seen.add(resolved)

    const own = readCached(
        stylesheetCache,
        resolved,
        text => ({
            classes: classesFromCssText(text),
            imports: [...text.matchAll(IMPORT_RULE)]
                .map(match => match[1])
                .filter(specifier => specifier.startsWith('.')),
        }),
        { classes: new Set(), imports: [] },
    )

    const all = new Set(own.classes)
    for (const specifier of own.imports) {
        for (const className of classesFromCssFile(path.resolve(path.dirname(resolved), specifier), seen)) {
            all.add(className)
        }
    }
    return all
}

/**
 * Every class the component's own styles declare, from `styleUrl`/`styleUrls` and inline `styles:`.
 * The decorator is read through the TypeScript AST (see `component-metadata.cjs`), so the answer is
 * exact rather than whatever a regex over the raw source happens to match.
 */
/**
 * @param {string} tsPath
 * @returns {Set<string>}
 */
function classesFromComponentFile(tsPath) {
    return readCached(
        componentCache,
        tsPath,
        () => {
            /** @type {Set<string>} */
            const classes = new Set()
            const dir = path.dirname(tsPath)
            const { inlineStyles, styleUrls } = readComponentMetadata(tsPath)

            for (const url of styleUrls) {
                for (const className of classesFromCssFile(path.resolve(dir, url))) classes.add(className)
            }

            for (const inlineStyle of inlineStyles) classesFromCssText(inlineStyle, classes)

            return classes
        },
        new Set(),
    )
}

/**
 * Maps a template file back to the component that owns it, including the virtual file names the
 * Angular inline-template processor produces (`foo.component.ts/0_inline-template-...html`).
 */
/**
 * @param {string} templatePath
 * @returns {string|null}
 */
function componentFileFor(templatePath) {
    const inlineMarker = templatePath.indexOf('.ts' + path.sep)
    if (inlineMarker !== -1) return templatePath.slice(0, inlineMarker + 3)

    const sibling = templatePath.replace(/\.html$/, '.ts')
    if (fs.existsSync(sibling)) return sibling

    // `templateUrl` need not match the component's own file name.
    const dir = path.dirname(templatePath)
    /** @type {string[]} */
    let entries = []
    try {
        entries = fs.readdirSync(dir)
    } catch {
        return null
    }

    for (const entry of entries) {
        if (!entry.endsWith('.ts')) continue
        const candidate = path.join(dir, entry)
        const declared = readComponentMetadata(candidate).templateUrls
        if (declared.some(url => path.resolve(dir, url) === path.resolve(templatePath))) return candidate
    }
    return null
}

/**
 * @param {string} templatePath
 * @returns {Set<string>}
 */
function componentClassesForTemplate(templatePath) {
    const componentFile = componentFileFor(templatePath)
    return componentFile ? classesFromComponentFile(componentFile) : new Set()
}

module.exports = {
    classesFromComponentFile,
    classesFromCssFile,
    classesFromCssText,
    componentClassesForTemplate,
    componentFileFor,
}

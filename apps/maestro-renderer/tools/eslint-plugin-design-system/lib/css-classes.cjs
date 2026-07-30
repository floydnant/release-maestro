/**
 * Harvests the class names that authored CSS actually declares — global styles, the generated
 * design-token stylesheet, and the styles a component brings with it. Nothing here is maintained by
 * hand: the stylesheets are the allowlist.
 */
const fs = require('node:fs')
const path = require('node:path')
const postcss = require('postcss')

const CLASS_SELECTOR = /\.(-?[_a-zA-Z][\w-]*)/g
const IMPORT_RULE = /@import\s+(?:url\()?['"]([^'"]+)['"]\)?/g

const fileCache = new Map()

function readCached(filePath, produce) {
    let stat
    try {
        stat = fs.statSync(filePath)
    } catch {
        return new Set()
    }

    const cached = fileCache.get(filePath)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.classes

    const classes = produce(fs.readFileSync(filePath, 'utf8'))
    fileCache.set(filePath, { mtimeMs: stat.mtimeMs, classes })
    return classes
}

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

/** Follows relative `@import`s so `styles.css` implies the generated token stylesheet. */
function classesFromCssFile(filePath, seen = new Set()) {
    const resolved = path.resolve(filePath)
    if (seen.has(resolved)) return new Set()
    seen.add(resolved)

    const own = readCached(resolved, text => {
        const classes = classesFromCssText(text)
        classes.imports = [...text.matchAll(IMPORT_RULE)]
            .map(match => match[1])
            .filter(specifier => specifier.startsWith('.'))
        return classes
    })

    const all = new Set(own)
    for (const specifier of own.imports ?? []) {
        for (const className of classesFromCssFile(path.resolve(path.dirname(resolved), specifier), seen)) {
            all.add(className)
        }
    }
    return all
}

/** Extracts the template literals attached to a `styles:` property, single or array form. */
function inlineStyleBlocks(source) {
    const blocks = []

    for (const match of source.matchAll(/\bstyles\s*:\s*/g)) {
        let index = match.index + match[0].length
        const isArray = source[index] === '['
        if (isArray) index += 1

        while (index < source.length) {
            const char = source[index]
            if (char === '`') {
                const end = source.indexOf('`', index + 1)
                if (end === -1) break
                blocks.push(source.slice(index + 1, end))
                index = end + 1
                if (!isArray) break
                continue
            }
            if (isArray && (char === ',' || /\s/.test(char))) {
                index += 1
                continue
            }
            break
        }
    }

    return blocks
}

/**
 * Pulls `styleUrl`/`styleUrls`/`styles` out of a component file. A regex is enough here: the rule
 * only needs the stylesheets, and parsing the decorator with the TypeScript AST would mean loading a
 * second parser for every template file.
 */
function classesFromComponentFile(tsPath) {
    return readCached(tsPath, source => {
        const classes = new Set()
        const dir = path.dirname(tsPath)

        for (const match of source.matchAll(/styleUrls?\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*")/g)) {
            for (const url of match[1].matchAll(/['"]([^'"]+)['"]/g)) {
                for (const className of classesFromCssFile(path.resolve(dir, url[1]))) classes.add(className)
            }
        }

        for (const inlineStyle of inlineStyleBlocks(source)) classesFromCssText(inlineStyle, classes)

        return classes
    })
}

/**
 * Maps a template file back to the component that owns it, including the virtual file names the
 * Angular inline-template processor produces (`foo.component.ts/0_inline-template-...html`).
 */
function componentFileFor(templatePath) {
    const inlineMarker = templatePath.indexOf('.ts' + path.sep)
    if (inlineMarker !== -1) return templatePath.slice(0, inlineMarker + 3)

    const sibling = templatePath.replace(/\.html$/, '.ts')
    if (fs.existsSync(sibling)) return sibling

    // `templateUrl` need not match the component's own file name.
    const dir = path.dirname(templatePath)
    const templateName = path.basename(templatePath)
    let entries = []
    try {
        entries = fs.readdirSync(dir)
    } catch {
        return null
    }

    for (const entry of entries) {
        if (!entry.endsWith('.ts')) continue
        const candidate = path.join(dir, entry)
        if (fs.readFileSync(candidate, 'utf8').includes(templateName)) return candidate
    }
    return null
}

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

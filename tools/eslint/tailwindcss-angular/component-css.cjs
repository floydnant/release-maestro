'use strict'

/**
 * PROTOTYPE (MAE-105) — scope-aware authored-CSS authority.
 *
 * `eslint-plugin-tailwindcss`'s `cssFiles` option is a single global pool: any
 * selector in any matched file makes that class valid everywhere. MAE-100 asks
 * for the opposite — "a selector owned by one Angular component must not make
 * that class valid in an unrelated component".
 *
 * So `cssFiles` is narrowed to genuinely global stylesheets, and this module
 * supplies the *owning component's* classes for the file currently being
 * linted: its `styleUrl(s)` files plus any inline `styles:` literals.
 */

const fs = require('node:fs')
const path = require('node:path')
const postcss = require('postcss')

const LAST_CLASS_FROM_SELECTOR = /\.([^.,\s\n:()[\]'~+>*\\]*)/gim
const STYLE_URLS = /styleUrls?\s*:\s*(\[[^\]]*\]|'[^']*'|"[^"]*"|`[^`]*`)/g
const QUOTED = /['"`]([^'"`]+)['"`]/g

const cache = new Map()

function classNamesInCss(css) {
    const found = new Set()
    let root
    try {
        root = postcss.parse(css)
    } catch {
        return found
    }
    root.walkRules(rule => {
        for (const match of rule.selector.matchAll(LAST_CLASS_FROM_SELECTOR)) {
            if (match[1]) found.add(match[1])
        }
    })
    return found
}

/**
 * Angular ESLint lints inline templates through a virtual filename such as
 * `foo.component.ts/0_inline-template-foo.component.ts-1.component.html`.
 * Everything after the real extension is noise for our purposes.
 */
function realSourcePath(filename) {
    const match = /^(.*?\.(?:ts|html))(?:[/\\].*)?$/.exec(filename)
    return match ? match[1] : filename
}

/** Reads a file, tolerating absence. */
function read(file) {
    try {
        return fs.readFileSync(file, 'utf-8')
    } catch {
        return null
    }
}

/** Collects the class names authored by the component owning `filename`. */
function ownedClassNames(filename) {
    const source = realSourcePath(filename)
    const cached = cache.get(source)
    if (cached && cached.checkedAt > Date.now() - 5_000) return cached.classNames

    const componentFile = source.endsWith('.html') ? source.replace(/\.html$/, '.ts') : source
    const dir = path.dirname(componentFile)
    const classNames = new Set()

    // Sibling stylesheet, the convention Angular's `styleUrl` defaults to.
    const siblingCss = read(componentFile.replace(/\.ts$/, '.css'))
    if (siblingCss) for (const name of classNamesInCss(siblingCss)) classNames.add(name)

    const componentSource = read(componentFile)
    if (componentSource) {
        for (const match of componentSource.matchAll(STYLE_URLS)) {
            for (const quoted of match[1].matchAll(QUOTED)) {
                const css = read(path.resolve(dir, quoted[1]))
                if (css) for (const name of classNamesInCss(css)) classNames.add(name)
            }
        }
        for (const css of inlineStyleLiterals(componentSource))
            for (const name of classNamesInCss(css)) classNames.add(name)
    }

    cache.set(source, { checkedAt: Date.now(), classNames })
    return classNames
}

/**
 * Extracts the contents of `styles: [\`…\`]` / `styles: \`…\`` blocks. A regex
 * cannot express nested backticks, so the scan is done by hand from the
 * `styles:` key to the matching bracket.
 */
function inlineStyleLiterals(source) {
    const blocks = []
    const key = /\bstyles\s*:\s*/g
    let match
    while ((match = key.exec(source)) !== null) {
        let index = match.index + match[0].length
        const isArray = source[index] === '['
        if (isArray) index += 1
        while (index < source.length) {
            while (index < source.length && /[\s,]/.test(source[index])) index += 1
            if (source[index] !== '`') break
            const end = source.indexOf('`', index + 1)
            if (end === -1) break
            blocks.push(source.slice(index + 1, end))
            index = end + 1
            if (!isArray) break
        }
    }
    return blocks
}

module.exports = { ownedClassNames }

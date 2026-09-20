/**
 * Tailwind is its own authority: instead of duplicating the utility surface in a list, we ask
 * Tailwind's design system whether a candidate class generates CSS for this project's config.
 * Tailwind v4 loads that design system asynchronously, while ESLint rules are synchronous. A
 * worker owns the async design system and synckit provides the narrow synchronous bridge.
 */
const { createSyncFn } = require('synckit')
const { statSync } = require('node:fs')

/** Marker classes Tailwind reads as variant targets; they legitimately emit no CSS of their own. */
const VARIANT_MARKERS = /^(group|peer)(\/[^\s/]+)?$/

const queryTailwind = createSyncFn(require.resolve('./tailwind-worker.mjs'))

/** @type {Map<string, { classList: string[], classes: Set<string>, dependencies: Map<string, string|null> }>} */
const authorityCache = new Map()

/** @param {string} path */
function fingerprint(path) {
    try {
        const metadata = statSync(path, { bigint: true })
        return `${metadata.mtimeNs}:${metadata.size}`
    } catch {
        return null
    }
}

/** @param {{ dependencies: Map<string, string|null> }} authority */
function isCurrent(authority) {
    for (const [path, previous] of authority.dependencies) {
        if (fingerprint(path) !== previous) return false
    }
    return true
}

/** @param {string} stylesheetPath */
function getAuthority(stylesheetPath) {
    const cached = authorityCache.get(stylesheetPath)
    if (cached && isCurrent(cached)) return cached

    const loaded = /** @type {{ classList: string[], dependencies: [string, string|null][] }} */ (
        queryTailwind({ operation: 'authority', stylesheetPath })
    )
    const authority = {
        classList: loaded.classList,
        classes: new Set(loaded.classList),
        dependencies: new Map(loaded.dependencies),
    }
    authorityCache.set(stylesheetPath, authority)
    return authority
}

/**
 * @param {string} stylesheetPath
 * @returns {{ classList: string[], isClass(className: string): boolean, themeVariableExists(variable: string): boolean }}
 */
function createTailwindAuthority(stylesheetPath) {
    const { classes, classList } = getAuthority(stylesheetPath)

    return {
        classList,
        isClass(className) {
            if (VARIANT_MARKERS.test(className)) return true
            if (classes.has(className)) return true
            return queryTailwind({ operation: 'isClass', stylesheetPath, value: className })
        },
        themeVariableExists(variable) {
            return queryTailwind({ operation: 'isThemeVariable', stylesheetPath, value: variable })
        },
    }
}

/**
 * Every class Tailwind can name for this config — the candidate pool for "did you mean …?".
 * Arbitrary values are unbounded and so are absent, which only costs us suggestions, not validation.
 *
 * @param {string} stylesheetPath
 * @returns {string[]}
 */
function tailwindClassList(stylesheetPath) {
    return createTailwindAuthority(stylesheetPath).classList
}

/**
 * @param {string} stylesheetPath
 * @param {string} className
 */
function isTailwindClass(stylesheetPath, className) {
    return createTailwindAuthority(stylesheetPath).isClass(className)
}

module.exports = { createTailwindAuthority, isTailwindClass, tailwindClassList }

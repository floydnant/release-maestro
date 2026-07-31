/**
 * Tailwind is its own authority: instead of duplicating the utility surface in a list, we ask
 * Tailwind's resolver whether a candidate class would generate CSS for this project's config.
 * That covers arbitrary values, variants, container queries and the plugin utilities declared in
 * `tailwind.config.js` without any of them being restated here.
 */
const { createContext } = require('tailwindcss/lib/lib/setupContextUtils')
const { generateRules } = require('tailwindcss/lib/lib/generateRules')
const resolveConfig = require('tailwindcss/resolveConfig')

/** Marker classes Tailwind reads as variant targets; they legitimately emit no CSS of their own. */
const VARIANT_MARKERS = /^(group|peer)(\/[^\s/]+)?$/

/** @typedef {import('tailwindcss/lib/lib/setupContextUtils').TailwindContext} TailwindContext */

/** @type {Map<string, TailwindContext>} */
const contextCache = new Map()

/**
 * @param {string} configPath
 * @returns {TailwindContext}
 */
function getTailwindContext(configPath) {
    let context = contextCache.get(configPath)
    if (!context) {
        context = createContext(resolveConfig(require(configPath)))
        contextCache.set(configPath, context)
    }
    return context
}

/**
 * @param {string} configPath
 * @param {string} className
 * @returns {boolean}
 */
function isTailwindClass(configPath, className) {
    if (VARIANT_MARKERS.test(className)) return true

    try {
        return generateRules([className], getTailwindContext(configPath)).length > 0
    } catch {
        return false
    }
}

/** @type {Map<string, string[]>} */
const classListCache = new Map()

/** @type {Map<string, ReturnType<typeof resolveConfig>>} */
const resolvedConfigCache = new Map()

/** @param {string} configPath */
function getResolvedConfig(configPath) {
    let config = resolvedConfigCache.get(configPath)
    if (!config) {
        config = resolveConfig(require(configPath))
        resolvedConfigCache.set(configPath, config)
    }
    return config
}

/**
 * Whether `theme(colors.status.info-background)` names something real. Tailwind resolves these only
 * when the stylesheet is compiled, so `generateRules` accepts a misspelled path and the mistake
 * surfaces as a build error instead of an editor diagnostic — this closes that gap.
 *
 * @param {string} configPath
 * @param {string} themePath
 * @returns {boolean}
 */
function themePathExists(configPath, themePath) {
    const segments = themePath
        .split('/')[0] // strip an alpha suffix such as `colors.red.500/50`
        .trim()
        .split('.')
        .filter(Boolean)

    if (segments.length === 0) return false

    /** @type {unknown} */
    let node = getResolvedConfig(configPath).theme
    for (const segment of segments) {
        if (node === null || typeof node !== 'object' || !(segment in node)) return false
        node = /** @type {Record<string, unknown>} */ (node)[segment]
    }
    // A leaf is the value itself; stopping on a branch means the path names a group, not a token.
    return typeof node !== 'object' || Array.isArray(node)
}

/**
 * Every class Tailwind can name for this config — the candidate pool for "did you mean …?".
 * Arbitrary values are unbounded and so are absent, which only costs us suggestions, not validation.
 *
 * @param {string} configPath
 * @returns {string[]}
 */
function tailwindClassList(configPath) {
    let list = classListCache.get(configPath)
    if (!list) {
        list = getTailwindContext(configPath)
            .getClassList()
            .filter(/** @returns {entry is string} */ entry => typeof entry === 'string')
        classListCache.set(configPath, list)
    }
    return list
}

module.exports = { getTailwindContext, isTailwindClass, tailwindClassList, themePathExists }

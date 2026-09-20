/**
 * Tailwind is its own authority: instead of duplicating the utility surface in a list, we ask
 * Tailwind's design system whether a candidate class generates CSS for this project's config.
 * Tailwind v4 loads that design system asynchronously, while ESLint rules are synchronous. A
 * worker owns the async design system and synckit provides the narrow synchronous bridge.
 */
const { createSyncFn } = require('synckit')

/** Marker classes Tailwind reads as variant targets; they legitimately emit no CSS of their own. */
const VARIANT_MARKERS = /^(group|peer)(\/[^\s/]+)?$/

const queryTailwind = createSyncFn(require.resolve('./tailwind-worker.mjs'))

/** @type {Map<string, Set<string>>} */
const classSetCache = new Map()

/**
 * @param {string} stylesheetPath
 * @param {string} className
 * @returns {boolean}
 */
function isTailwindClass(stylesheetPath, className) {
    if (VARIANT_MARKERS.test(className)) return true
    if (getTailwindClassSet(stylesheetPath).has(className)) return true
    return queryTailwind({ operation: 'isClass', stylesheetPath, value: className })
}

/** @type {Map<string, string[]>} */
const classListCache = new Map()

/**
 * Whether a `var(--color-…)` reference names a design token in Tailwind's v4 theme.
 *
 * @param {string} stylesheetPath
 * @param {string} variable
 * @returns {boolean}
 */
function themeVariableExists(stylesheetPath, variable) {
    return queryTailwind({ operation: 'isThemeVariable', stylesheetPath, value: variable })
}

/**
 * Every class Tailwind can name for this config — the candidate pool for "did you mean …?".
 * Arbitrary values are unbounded and so are absent, which only costs us suggestions, not validation.
 *
 * @param {string} stylesheetPath
 * @returns {string[]}
 */
function tailwindClassList(stylesheetPath) {
    let list = classListCache.get(stylesheetPath)
    if (!list) {
        const loaded = /** @type {string[]} */ (queryTailwind({ operation: 'classList', stylesheetPath }))
        classListCache.set(stylesheetPath, loaded)
        list = loaded
    }
    return list
}

/** @param {string} stylesheetPath */
function getTailwindClassSet(stylesheetPath) {
    let classes = classSetCache.get(stylesheetPath)
    if (!classes) {
        classes = new Set(tailwindClassList(stylesheetPath))
        classSetCache.set(stylesheetPath, classes)
    }
    return classes
}

module.exports = { isTailwindClass, tailwindClassList, themeVariableExists }

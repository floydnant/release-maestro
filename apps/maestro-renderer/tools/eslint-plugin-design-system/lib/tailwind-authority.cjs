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

const contextCache = new Map()

function getTailwindContext(configPath) {
    let context = contextCache.get(configPath)
    if (!context) {
        context = createContext(resolveConfig(require(configPath)))
        contextCache.set(configPath, context)
    }
    return context
}

function isTailwindClass(configPath, className) {
    if (VARIANT_MARKERS.test(className)) return true

    try {
        return generateRules([className], getTailwindContext(configPath)).length > 0
    } catch {
        return false
    }
}

module.exports = { getTailwindContext, isTailwindClass }

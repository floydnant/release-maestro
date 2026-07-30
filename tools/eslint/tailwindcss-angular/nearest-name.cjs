'use strict'

/**
 * PROTOTYPE (MAE-105) — nearest-name suggestions.
 *
 * `eslint-plugin-tailwindcss` reports an invalid class but offers no candidate.
 * MAE-100 asks for "the nearest valid class when there is one clear candidate,
 * for example `type-code-sm` for `type-code-sl`" and explicitly forbids
 * automatic replacement, so this only produces a name — the caller surfaces it
 * as an ESLint *suggestion*, which is never applied automatically.
 */

const getClassnamesFromCSS = require('eslint-plugin-tailwindcss/lib/util/cssFiles')

const MAX_DISTANCE = 3
const candidateCache = new Map()

/** Levenshtein distance, abandoned as soon as it cannot beat `limit`. */
function distance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1

    let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
    for (let i = 1; i <= a.length; i++) {
        const current = [i]
        let best = i
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, previous[j - 1] + cost)
            best = Math.min(best, current[j])
        }
        if (best > limit) return limit + 1
        previous = current
    }
    return previous[b.length]
}

/** Every class name the closed world can offer, built once per configuration. */
function candidatesFor(tailwindConfig, cssFiles) {
    const key = `${tailwindConfig}::${JSON.stringify(cssFiles ?? [])}`
    const cached = candidateCache.get(key)
    if (cached) return cached

    const names = new Set()
    try {
        const { createContext } = require('tailwindcss/lib/lib/setupContextUtils')
        const resolveConfig = require('tailwindcss/resolveConfig')
        const context = createContext(resolveConfig(require(tailwindConfig)))
        for (const entry of context.getClassList()) {
            if (typeof entry === 'string') names.add(entry)
        }
    } catch {
        // A prototype without a resolvable config still reports, just without
        // suggestions.
    }
    if (cssFiles) {
        for (const name of getClassnamesFromCSS(cssFiles)) names.add(name)
    }

    const list = [...names]
    candidateCache.set(key, list)
    return list
}

/**
 * Returns the single nearest valid class name, or `null` when there is no clear
 * candidate — either nothing close enough, or a tie between several names.
 */
function nearestClassName(className, { tailwindConfig, cssFiles, owned }) {
    if (!className || !tailwindConfig) return null

    const candidates = candidatesFor(tailwindConfig, cssFiles)
    let best = null
    let bestDistance = MAX_DISTANCE + 1
    let ambiguous = false

    const consider = candidate => {
        const d = distance(className, candidate, Math.min(bestDistance, MAX_DISTANCE))
        if (d > MAX_DISTANCE) return
        if (d < bestDistance) {
            bestDistance = d
            best = candidate
            ambiguous = false
        } else if (d === bestDistance && candidate !== best) ambiguous = true
    }

    for (const candidate of candidates) consider(candidate)
    if (owned) for (const candidate of owned) consider(candidate)

    return ambiguous ? null : best
}

module.exports = { nearestClassName }

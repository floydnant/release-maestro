/**
 * Nearest-name suggestion for an unknown class. MAE-100 asks for a suggestion only when there is one
 * clear candidate and never an automatic correction, so this deliberately returns nothing when the
 * best match is far away or when a second candidate is equally close.
 *
 * Two different mistakes need two different notions of "nearest", and the comparison in MAE-100
 * showed that using only one of them produces actively misleading advice:
 *
 * - A **typo** is near in spelling. `fleex` → `flex`, `type-code-sl` → `type-code-sm`.
 * - A **value outside the project's scale** is near in magnitude. `max-h-72` is one edit from
 *   `max-h-32` and four steps away from it in the scale; the value a human reaches for is
 *   `max-h-64`. Edit distance gets this exactly wrong, so scale proximity is tried first.
 */

/** Beyond this the "suggestion" is noise rather than help. */
const MAX_DISTANCE = 3

/** `max-h-72`, `py-14`, `opacity-80` — a utility prefix carrying a numeric scale value. */
const SCALE_UTILITY = /^(.*[^-])-(\d+(?:\.\d+)?)$/

/** One scale step, e.g. the `sm` of `rounded-sm`. Multi-segment names such as `success-glow` and
 *  directional prefixes such as `rounded-l-sm` are deliberately not one step. */
/** @param {string} prefix */
const singleStepOf = prefix => new RegExp(`^${escapeForRegExp(prefix)}-([^-]+)$`)

/** Scale steps that a bare utility never means: `rounded` is not `rounded-none`. */
const EMPTY_STEPS = new Set(['none', '0', 'px'])

/** @param {string} value */
function escapeForRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * @param {string} a
 * @param {string} b
 * @param {number} limit anything beyond this is abandoned early; the caller only wants near matches
 * @returns {number} the distance, or `limit + 1` when it is provably greater
 */
function editDistance(a, b, limit) {
    if (Math.abs(a.length - b.length) > limit) return limit + 1

    let previous = Array.from({ length: b.length + 1 }, (_, index) => index)

    for (let i = 1; i <= a.length; i++) {
        const current = [i]
        let rowBest = i

        for (let j = 1; j <= b.length; j++) {
            const substitution = previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
            current[j] = Math.min(current[j - 1] + 1, previous[j] + 1, substitution)
            rowBest = Math.min(rowBest, current[j])
        }

        if (rowBest > limit) return limit + 1
        previous = current
    }

    return previous[b.length]
}

/**
 * The value the author asked for is off this utility's scale — offer the closest value that is on
 * it. Ties go to the smaller value, because the alternative is silently proposing more space than
 * was written (`py-14` → `py-12`, not `py-16`).
 *
 * @param {string} prefix
 * @param {number} value
 * @param {string[]} candidates
 * @returns {string|null}
 */
function nearestScaleValue(prefix, value, candidates) {
    const step = singleStepOf(prefix)

    /** @type {string|null} */
    let best = null
    let bestDistance = Infinity
    let bestValue = Infinity

    for (const candidate of candidates) {
        const match = step.exec(candidate)
        if (!match || !/^\d+(?:\.\d+)?$/.test(match[1])) continue

        const candidateValue = Number(match[1])
        const distance = Math.abs(candidateValue - value)
        if (distance < bestDistance || (distance === bestDistance && candidateValue < bestValue)) {
            best = candidate
            bestDistance = distance
            bestValue = candidateValue
        }
    }

    return best
}

/**
 * A bare `rounded` or `shadow` reads as a real utility but emits nothing: this project's Tailwind
 * config *replaces* those scales with token scales that have no `DEFAULT` key. The bare form asks
 * for the modest default, which in a scale starting at `none` is its first real step.
 *
 * @param {string} prefix
 * @param {string[]} candidates
 * @returns {string|null}
 */
function firstScaleStep(prefix, candidates) {
    const step = singleStepOf(prefix)

    let seen = 0
    /** @type {string|null} */
    let first = null

    for (const candidate of candidates) {
        const match = step.exec(candidate)
        if (!match) continue

        seen += 1
        if (first === null && !EMPTY_STEPS.has(match[1])) first = candidate
    }

    // One lonely match is a coincidence, not a scale.
    return seen > 1 ? first : null
}

/**
 * @typedef {object} Suggestion
 * @property {string} name the class to offer instead
 * @property {'offScale'|'bareUtility'|'spelling'} kind which of the two mistakes this was — the
 *   diagnostic says something different for each, because they are different mistakes
 * @property {string} [scale] the utility prefix whose scale was missed, for `offScale`
 */

/**
 * @param {string} unknown the class that failed validation
 * @param {Iterable<string>} candidates every class name that would have been accepted
 * @returns {Suggestion|null} the single closest name, or null when the match is weak or ambiguous
 */
function suggestClassName(unknown, candidates) {
    const pool = Array.isArray(candidates) ? candidates : [...candidates]

    const scaled = SCALE_UTILITY.exec(unknown)
    if (scaled) {
        const onScale = nearestScaleValue(scaled[1], Number(scaled[2]), pool)
        if (onScale) return { name: onScale, kind: 'offScale', scale: scaled[1] }
    } else {
        const firstStep = firstScaleStep(unknown, pool)
        if (firstStep) return { name: firstStep, kind: 'bareUtility' }
    }

    const limit = Math.min(MAX_DISTANCE, Math.max(1, Math.floor(unknown.length / 3)))

    /** @type {string|null} */
    let best = null
    let bestDistance = limit + 1
    let ambiguous = false

    for (const candidate of pool) {
        if (candidate === unknown) continue

        const distance = editDistance(unknown, candidate, limit)
        if (distance > limit) continue

        if (distance < bestDistance) {
            best = candidate
            bestDistance = distance
            ambiguous = false
        } else if (distance === bestDistance && candidate !== best) {
            ambiguous = true
        }
    }

    return ambiguous || best === null ? null : { name: best, kind: 'spelling' }
}

module.exports = { suggestClassName }

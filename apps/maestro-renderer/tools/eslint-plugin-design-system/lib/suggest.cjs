/**
 * Nearest-name suggestion for an unknown class. MAE-100 asks for a suggestion only when there is one
 * clear candidate and never an automatic correction, so this deliberately returns nothing when the
 * best match is far away or when a second candidate is equally close.
 */

/** Beyond this the "suggestion" is noise rather than help. */
const MAX_DISTANCE = 3

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
 * @param {string} unknown the class that failed validation
 * @param {Iterable<string>} candidates every class name that would have been accepted
 * @returns {string|null} the single closest name, or null when the match is weak or ambiguous
 */
function suggestClassName(unknown, candidates) {
    const limit = Math.min(MAX_DISTANCE, Math.max(1, Math.floor(unknown.length / 3)))

    let best = null
    let bestDistance = limit + 1
    let ambiguous = false

    for (const candidate of candidates) {
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

    return ambiguous ? null : best
}

module.exports = { suggestClassName }

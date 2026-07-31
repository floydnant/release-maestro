/**
 * Class-list tokenizing, including the repository's `descriptor | utilities` pipe convention:
 * everything left of the pipe is a semantic descriptor naming the element, everything right of it is
 * a styling class that has to exist. Without a pipe the whole list is styling.
 *
 * MAE-100 fixes the shape: zero or one descriptor, one pipe. Anything else is malformed and is
 * reported rather than guessed at, because a malformed list makes "descriptor or typo?" unanswerable.
 */
const DESCRIPTOR_SEPARATOR = '|'

/** A design-token custom property must be reached through Tailwind's theme, not `var()` directly. */
const BARE_TOKEN_VARIABLE = /var\(\s*(--(?:color|foundation|type)-[\w-]*)/g

/** The validated alternative — but only validated if the path is real, hence `themeReferences`. */
const THEME_REFERENCE = /theme\(\s*([^)]+?)\s*\)/g

/**
 * @typedef {'descriptor'|'styling'|'partial'|'interpolated'} ClassTokenKind
 * @typedef {{ name: string, start: number, end: number, kind: ClassTokenKind }} ClassToken
 * @typedef {'emptyDescriptor'|'multipleDescriptors'|'multiplePipes'} MalformedReason
 */

/**
 * @param {string} value raw attribute value or string-literal contents
 * @param {{ offset?: number, truncatedStart?: boolean, truncatedEnd?: boolean }} context
 *   `offset` is where `value` starts in the file; the truncated flags mark a string that is
 *   concatenated with a runtime expression, so the tokens at that edge are partial.
 * @returns {{ tokens: ClassToken[],
 *             malformed: { reason: MalformedReason, start: number, end: number } | null }}
 */
function tokenizeClassList(value, { offset = 0, truncatedStart = false, truncatedEnd = false } = {}) {
    const raw = [...value.matchAll(/\S+/g)].map(match => ({
        name: match[0],
        start: offset + match.index,
        end: offset + match.index + match[0].length,
        localStart: match.index,
        localEnd: match.index + match[0].length,
    }))

    const separators = raw.filter(token => token.name === DESCRIPTOR_SEPARATOR)
    const separatorIndex = raw.findIndex(token => token.name === DESCRIPTOR_SEPARATOR)

    /** @type {{ reason: MalformedReason, start: number, end: number } | null } */
    let malformed = null
    if (separators.length > 1) {
        malformed = { reason: 'multiplePipes', start: separators[1].start, end: separators[1].end }
    } else if (separatorIndex === 0 && !truncatedStart) {
        malformed = { reason: 'emptyDescriptor', start: separators[0].start, end: separators[0].end }
    } else if (separatorIndex > 1) {
        malformed = { reason: 'multipleDescriptors', start: raw[0].start, end: raw[separatorIndex - 1].end }
    }

    const tokens = raw
        .filter(token => token.name !== DESCRIPTOR_SEPARATOR)
        .map(token => {
            const isDescriptor = separatorIndex !== -1 && raw.indexOf(token) < separatorIndex
            const isPartial =
                (truncatedStart && token.localStart === 0) ||
                (truncatedEnd && token.localEnd === value.length)
            const isInterpolated = token.name.includes('{{') || token.name.includes('}}')

            /** @type {ClassTokenKind} */
            let kind = 'styling'
            if (isDescriptor) kind = 'descriptor'
            else if (isInterpolated) kind = 'interpolated'
            else if (isPartial) kind = 'partial'

            return { name: token.name, start: token.start, end: token.end, kind }
        })

    return { tokens, malformed }
}

/**
 * Finds bare design-token custom properties inside a class token — in practice inside a Tailwind
 * arbitrary value, where a structurally valid outer utility would otherwise hide an unchecked token
 * reference. Component-local custom properties (`--progress-color`) are not design tokens and are
 * intentionally not matched.
 *
 * @param {ClassToken} token
 */
function bareTokenVariables(token) {
    return [...token.name.matchAll(BARE_TOKEN_VARIABLE)].map(match => ({
        variable: match[1],
        start: token.start + match.index,
        end: token.start + match.index + match[0].length,
    }))
}

/**
 * Theme lookups inside a class token, with the position of the path itself for exact underlining.
 *
 * @param {ClassToken} token
 */
function themeReferences(token) {
    return [...token.name.matchAll(THEME_REFERENCE)].map(match => ({
        path: match[1],
        start: token.start + match.index + match[0].indexOf(match[1]),
        end: token.start + match.index + match[0].indexOf(match[1]) + match[1].length,
    }))
}

module.exports = { bareTokenVariables, DESCRIPTOR_SEPARATOR, themeReferences, tokenizeClassList }

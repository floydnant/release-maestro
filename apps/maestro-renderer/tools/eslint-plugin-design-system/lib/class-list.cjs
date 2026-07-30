/**
 * Class-list tokenizing, including the repository's `descriptor | utilities` pipe convention:
 * everything left of the pipe is a semantic descriptor naming the element, everything right of it is
 * a styling class that has to exist. Without a pipe the whole list is styling.
 */
const DESCRIPTOR_SEPARATOR = '|'

/**
 * @param {string} value raw attribute value or string-literal contents
 * @param {{ offset?: number, truncatedStart?: boolean, truncatedEnd?: boolean }} context
 *   `offset` is where `value` starts in the file; the truncated flags mark a string that is
 *   concatenated with a runtime expression, so the tokens at that edge are partial.
 * @returns {{ name: string, start: number, end: number, kind: 'descriptor'|'styling'|'partial'|'interpolated' }[]}
 */
function tokenizeClassList(value, { offset = 0, truncatedStart = false, truncatedEnd = false } = {}) {
    const tokens = [...value.matchAll(/\S+/g)].map(match => ({
        name: match[0],
        start: offset + match.index,
        end: offset + match.index + match[0].length,
        localStart: match.index,
        localEnd: match.index + match[0].length,
    }))

    const separatorIndex = tokens.findIndex(token => token.name === DESCRIPTOR_SEPARATOR)

    return tokens
        .filter(token => token.name !== DESCRIPTOR_SEPARATOR)
        .map((token, index) => {
            const position = separatorIndex === -1 ? index : tokens.indexOf(token)
            const isDescriptor = separatorIndex !== -1 && position < separatorIndex
            const isPartial =
                (truncatedStart && token.localStart === 0) ||
                (truncatedEnd && token.localEnd === value.length)
            const isInterpolated = token.name.includes('{{') || token.name.includes('}}')

            let kind = 'styling'
            if (isDescriptor) kind = 'descriptor'
            else if (isInterpolated) kind = 'interpolated'
            else if (isPartial) kind = 'partial'

            return { name: token.name, start: token.start, end: token.end, kind }
        })
}

module.exports = { DESCRIPTOR_SEPARATOR, tokenizeClassList }

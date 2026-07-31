/**
 * Pulls the statically knowable class lists out of an Angular expression — `[ngClass]` maps,
 * `[class]` strings, concatenations, conditionals — and flags the parts that only exist at runtime.
 */

/** @param {AngularExpression|undefined} node */
function isStringLiteral(node) {
    return node?.type === 'LiteralPrimitive' && typeof node.value === 'string'
}

/**
 * @typedef {object} ClassString
 * @property {string} value
 * @property {number|null} offset where the string contents start in the file, or null when the
 *   parser gave no span and the diagnostic has to fall back to the whole binding
 * @property {boolean} truncatedStart
 * @property {boolean} truncatedEnd
 */

/**
 * @param {AngularExpression} root
 * @returns {{ strings: ClassString[], dynamic: boolean }}
 */
function collectClassStrings(root) {
    /** @type {ClassString[]} */
    const strings = []
    let dynamic = false

    /**
     * @param {AngularExpression|undefined} node
     * @param {boolean} truncatedStart
     * @param {boolean} truncatedEnd
     */
    const visit = (node, truncatedStart, truncatedEnd) => {
        if (!node || typeof node !== 'object') return

        switch (node.type) {
            case 'ASTWithSource':
                return visit(node.ast, truncatedStart, truncatedEnd)

            case 'LiteralPrimitive':
                if (typeof node.value === 'string') {
                    strings.push({
                        value: node.value,
                        // `sourceSpan` covers the quotes, the contents start one character in.
                        offset: node.sourceSpan ? node.sourceSpan.start + 1 : null,
                        truncatedStart,
                        truncatedEnd,
                    })
                }
                return

            case 'Binary':
                if (node.operation === '+') {
                    visit(node.left, truncatedStart, truncatedEnd || !isStringLiteral(node.right))
                    visit(node.right, truncatedStart || !isStringLiteral(node.left), truncatedEnd)
                    return
                }
                dynamic = true
                return

            case 'Conditional':
                visit(node.trueExp, truncatedStart, truncatedEnd)
                visit(node.falseExp, truncatedStart, truncatedEnd)
                return

            case 'LiteralMap':
                node.keys?.forEach(key => {
                    // `{ ...base, 'flex': cond }` — a spread contributes keys that only exist at
                    // runtime, and unlike a written-out key it carries no name to validate.
                    if (key.kind === 'spread') {
                        dynamic = true
                        return
                    }

                    strings.push({
                        value: key.key,
                        offset: key.sourceSpan ? key.sourceSpan.start + (key.quoted ? 1 : 0) : null,
                        truncatedStart: false,
                        truncatedEnd: false,
                    })
                })
                return

            case 'LiteralArray':
                node.expressions?.forEach(expression => visit(expression, truncatedStart, truncatedEnd))
                return

            default:
                dynamic = true
        }
    }

    visit(root, false, false)
    return { strings, dynamic }
}

module.exports = { collectClassStrings }

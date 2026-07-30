/**
 * Pulls the statically knowable class lists out of an Angular expression — `[ngClass]` maps,
 * `[class]` strings, concatenations, conditionals — and flags the parts that only exist at runtime.
 */

function isStringLiteral(node) {
    return node?.type === 'LiteralPrimitive' && typeof node.value === 'string'
}

/**
 * @returns {{ strings: { value: string, offset: number|null, truncatedStart: boolean, truncatedEnd: boolean }[],
 *             dynamic: boolean }}
 */
function collectClassStrings(root) {
    const strings = []
    let dynamic = false

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

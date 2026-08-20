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
 * @typedef {{ reason: string, data?: Record<string, string> }} UnresolvedReason
 */

/**
 * @callback ResolveExpression
 * @param {AngularExpression} node
 * @returns {{ literals: string[] } | UnresolvedReason | null} every class list the expression can
 *   produce; a reason it could not be enumerated; or null when the expression is not addressing a
 *   component member at all. See `member-classes.cjs` — the strings come back to be validated like
 *   any other, so resolving one is not the same as accepting it.
 */

/**
 * @param {AngularExpression} root
 * @param {ResolveExpression} [resolve]
 * @returns {{ strings: ClassString[], dynamic: boolean, reasons: UnresolvedReason[] }}
 *   `dynamic` covers the parts nothing more specific can be said about; `reasons` carries the parts
 *   that can be explained, and the caller reports both.
 */
function collectClassStrings(root, resolve) {
    /** @type {ClassString[]} */
    const strings = []
    /** @type {Map<string, UnresolvedReason>} */
    const reasons = new Map()
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

            case 'Interpolation': {
                // Angular represents `class="{{ member }}"` as an Interpolation rather than as the
                // member expression itself. Walk the alternating static/expression parts so member
                // resolution and ordinary class validation apply here exactly as they do to a
                // property binding. A static part is marked truncated only when an expression
                // touches its edge; whitespace means the neighbouring value starts a new token.
                const segments = node.strings ?? []
                const expressions = node.expressions ?? []

                for (let index = 0; index < segments.length; index += 1) {
                    const segment = segments[index]
                    if (segment) {
                        strings.push({
                            value: segment,
                            offset: null,
                            truncatedStart:
                                (index === 0 && truncatedStart) ||
                                (index > 0 && !/^\s/.test(segment)),
                            truncatedEnd:
                                (index === segments.length - 1 && truncatedEnd) ||
                                (index < expressions.length && !/\s$/.test(segment)),
                        })
                    }

                    const expression = expressions[index]
                    if (!expression) continue

                    const before = segments[index] ?? ''
                    const after = segments[index + 1] ?? ''
                    visit(
                        expression,
                        /\S$/.test(before) || (before === '' && index === 0 && truncatedStart),
                        /^\S/.test(after) ||
                            (after === '' && index === expressions.length - 1 && truncatedEnd),
                    )
                }
                return
            }

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

            default: {
                // A resolved member behaves exactly like a string literal with several possible
                // values — same truncation flags, same validation. It carries no span of its own,
                // because the literals live in the component file, so the diagnostic falls back to
                // the whole binding.
                const resolved = resolve?.(node)
                if (!resolved) {
                    dynamic = true
                    return
                }

                if ('reason' in resolved) {
                    // Keyed so a binding naming the same member twice is explained once.
                    reasons.set(resolved.reason + '\0' + JSON.stringify(resolved.data ?? {}), resolved)
                    return
                }

                for (const value of resolved.literals) {
                    strings.push({ value, offset: null, truncatedStart, truncatedEnd })
                }
            }
        }
    }

    visit(root, false, false)
    return { strings, dynamic, reasons: [...reasons.values()] }
}

module.exports = { collectClassStrings }

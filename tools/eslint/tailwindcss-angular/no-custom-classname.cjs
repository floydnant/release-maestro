'use strict'

/**
 * PROTOTYPE (MAE-105) — thin Angular adapter around
 * `eslint-plugin-tailwindcss`'s `no-custom-classname`.
 *
 * The upstream rule already validates static `class="…"` attributes in Angular
 * templates (it visits `TextAttribute`). It does not know about two things this
 * repository relies on:
 *
 *   1. the `descriptor | utilities` class-list convention — everything left of
 *      the pipe is a semantic descriptor, not a styling class;
 *   2. dynamic class surfaces — `[class]`, `[class.foo]`, `[ngClass]`,
 *      `routerLinkActive`, and `host: { class: '…' }` metadata.
 *
 * Rather than reimplementing validation, this rule reuses the upstream rule as
 * the engine: it builds the upstream visitors and feeds them synthetic
 * `TextAttribute` nodes carrying the class list it extracted, with the location
 * of the real source node.
 */

const upstreamRule = require('eslint-plugin-tailwindcss/lib/rules/no-custom-classname')

const DEFAULT_DESCRIPTOR_SEPARATOR = '|'
const DEFAULT_STATIC_CLASS_ATTRIBUTES = ['class', 'routerLinkActive']
const DEFAULT_DYNAMIC_CLASS_ATTRIBUTES = ['class', 'ngClass']

const upstreamSchema = upstreamRule.meta.schema[0]

/** Splits `"descriptor | utilities"` into the styling half only. */
function stripDescriptors(value, separator) {
    const tokens = value.split(/\s+/).filter(Boolean)
    const separatorIndex = tokens.indexOf(separator)
    if (separatorIndex === -1) return tokens
    return tokens.slice(separatorIndex + 1)
}

/**
 * Class names that are safe to validate from a string literal that took part in
 * a concatenation. `'badge border ' + f()` contributes `badge` and `border`;
 * `'type-' + token` contributes nothing, because `type-` is only a fragment.
 */
function completeTokensOfConcatenatedLiteral(value, { isFirstOperand, isLastOperand }) {
    const tokens = value.split(/\s+/)
    if (!isFirstOperand && tokens.length > 0 && !/^\s/.test(value)) tokens.shift()
    if (!isLastOperand && tokens.length > 0 && !/\s$/.test(value)) tokens.pop()
    return tokens.filter(Boolean)
}

/** Flattens `a + b + c` into its operands, left to right. */
function flattenConcatenation(ast, out = []) {
    if (ast && ast.type === 'Binary' && ast.operation === '+') {
        flattenConcatenation(ast.left, out)
        flattenConcatenation(ast.right, out)
        return out
    }
    out.push(ast)
    return out
}

function unwrap(ast) {
    return ast && ast.type === 'ASTWithSource' ? ast.ast : ast
}

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description:
                'Detect classnames which do not belong to Tailwind CSS, the design-token layer, or authored CSS — Angular template aware.',
        },
        messages: upstreamRule.meta.messages,
        schema: [
            {
                type: 'object',
                properties: {
                    ...upstreamSchema.properties,
                    descriptorSeparator: { type: 'string' },
                    staticClassAttributes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
                    dynamicClassAttributes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
                },
            },
        ],
    },

    create(context) {
        const options = context.options[0] ?? {}
        const separator = options.descriptorSeparator ?? DEFAULT_DESCRIPTOR_SEPARATOR
        const staticAttributes = options.staticClassAttributes ?? DEFAULT_STATIC_CLASS_ATTRIBUTES
        const dynamicAttributes = options.dynamicClassAttributes ?? DEFAULT_DYNAMIC_CLASS_ATTRIBUTES

        // The upstream rule reads the very same `context`, so its own options
        // (config, cssFiles, whitelist, …) keep working untouched.
        const upstream = upstreamRule.create(context)

        /** Hands a class list to the upstream rule as if it were `class="…"`. */
        const validate = (classNames, loc) => {
            if (classNames.length === 0) return
            upstream.TextAttribute({ type: 'TextAttribute', name: 'class', value: classNames.join(' '), loc })
        }

        const attributeName = node => node.keySpan?.toString() ?? node.name

        const validateBindingValue = (ast, node) => {
            const value = unwrap(ast)
            if (!value) return

            switch (value.type) {
                // [class]="'a b'"
                case 'LiteralPrimitive':
                    if (typeof value.value === 'string')
                        validate(stripDescriptors(value.value, separator), node.loc)
                    return

                // [class]="['a', 'b']"
                case 'LiteralArray':
                    value.expressions.forEach(element => validateBindingValue(element, node))
                    return

                // [ngClass]="{ 'a b': cond }"
                case 'LiteralMap':
                    value.keys.forEach(key => {
                        if (typeof key.key !== 'string') return
                        validate(stripDescriptors(key.key, separator), key.loc ?? node.loc)
                    })
                    return

                // [class]="cond ? 'a' : 'b'"
                case 'Conditional':
                    validateBindingValue(value.trueExp, node)
                    validateBindingValue(value.falseExp, node)
                    return

                // [class]="'badge ' + variantClass()"
                case 'Binary': {
                    const operands = flattenConcatenation(value)
                    operands.forEach((operand, index) => {
                        if (operand?.type !== 'LiteralPrimitive' || typeof operand.value !== 'string') return
                        const tokens = completeTokensOfConcatenatedLiteral(operand.value, {
                            isFirstOperand: index === 0,
                            isLastOperand: index === operands.length - 1,
                        })
                        validate(stripDescriptors(tokens.join(' '), separator), node.loc)
                    })
                    return
                }

                default:
                    // Everything else is opaque at lint time — stay silent
                    // rather than guess. Recorded as "unsupported", not "pass".
                    return
            }
        }

        return {
            ...upstream,

            // class="…" and routerLinkActive="…"
            TextAttribute(node) {
                if (!staticAttributes.includes(node.name) || typeof node.value !== 'string') return
                validate(stripDescriptors(node.value, separator), node.loc)
            },

            BoundAttribute(node) {
                // `[attr.class]` sets the same DOM attribute as `[class]`.
                const name = attributeName(node).replace(/^attr\./, '')

                // [class.rounded-l-full]="…"
                if (name.startsWith('class.')) {
                    validate([name.slice('class.'.length)], node.loc)
                    return
                }

                // [class]="…" / [ngClass]="…"
                if (!dynamicAttributes.includes(name)) return
                validateBindingValue(node.value, node)
            },

            // @Component({ host: { class: '…' } })
            Property(node) {
                if (upstream.Property) upstream.Property(node)

                const keyName = node.key?.name ?? node.key?.value
                if (
                    keyName !== 'class' ||
                    node.value?.type !== 'Literal' ||
                    typeof node.value.value !== 'string'
                )
                    return

                const objectExpression = node.parent
                const hostProperty = objectExpression?.parent
                const hostKey = hostProperty?.key?.name ?? hostProperty?.key?.value
                if (hostProperty?.type !== 'Property' || hostKey !== 'host') return

                validate(stripDescriptors(node.value.value, separator), node.loc)
            },
        }
    },
}

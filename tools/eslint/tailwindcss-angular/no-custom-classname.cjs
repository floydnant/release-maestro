'use strict'

/**
 * PROTOTYPE (MAE-105) — Angular adapter around `eslint-plugin-tailwindcss`'s
 * `no-custom-classname`, evaluated against the MAE-100 acceptance corpus.
 *
 * The upstream rule is kept as the *validation engine*: it decides whether a
 * class name exists, using the effective Tailwind configuration plus the global
 * CSS pool. This wrapper adds only what upstream cannot express:
 *
 *   1. the `descriptor | utilities` class-list convention, including malformed
 *      pipe syntax (MAE-100 "zero or one descriptor");
 *   2. Angular class-producing surfaces — `[class]`, `[class.foo]`, `[ngClass]`,
 *      `routerLinkActive`, and `host: { class: '…' }` metadata;
 *   3. rejection of unresolved dynamic class construction, so moving a class
 *      into a binding is not a validation bypass;
 *   4. bare design-token variables inside Tailwind arbitrary values;
 *   5. scope-aware authored CSS — a component's own selectors are valid only
 *      inside that component (see `component-css.cjs`);
 *   6. exact per-token diagnostic locations and nearest-name suggestions.
 */

const upstreamRule = require('eslint-plugin-tailwindcss/lib/rules/no-custom-classname')
const { ownedClassNames } = require('./component-css.cjs')
const { nearestClassName } = require('./nearest-name.cjs')

const DEFAULT_DESCRIPTOR_SEPARATOR = '|'
const DEFAULT_STATIC_CLASS_ATTRIBUTES = ['class', 'routerLinkActive']
const DEFAULT_DYNAMIC_CLASS_ATTRIBUTES = ['class', 'ngClass', 'routerLinkActive']
const DEFAULT_TOKEN_VARIABLE_PREFIXES = ['--color-', '--foundation-', '--type-']

const upstreamSchema = upstreamRule.meta.schema[0]

// ---------------------------------------------------------------------------
// Source locations
// ---------------------------------------------------------------------------

/**
 * Builds a locator over an Angular `ParseSourceSpan`, so a class name found at
 * an index inside that span can be reported at its own location instead of at
 * the whole attribute.
 */
function locatorOf(span) {
    if (!span?.start) return null
    const text = span.toString()
    const { offset, line, col } = span.start

    return (index, length) => {
        let currentLine = line
        let currentColumn = col
        for (let i = 0; i < index; i++) {
            if (text[i] === '\n') {
                currentLine += 1
                currentColumn = 0
            } else currentColumn += 1
        }
        const start = { line: currentLine + 1, column: currentColumn }
        let endLine = currentLine
        let endColumn = currentColumn
        for (let i = index; i < index + length; i++) {
            if (text[i] === '\n') {
                endLine += 1
                endColumn = 0
            } else endColumn += 1
        }
        return {
            loc: { start, end: { line: endLine + 1, column: endColumn } },
            range: [offset + index, offset + index + length],
        }
    }
}

/** Splits a class-list string into `{ name, index }` tokens. */
function tokenize(value) {
    const tokens = []
    const pattern = /\S+/g
    let match
    while ((match = pattern.exec(value)) !== null) tokens.push({ name: match[0], index: match.index })
    return tokens
}

// ---------------------------------------------------------------------------
// Descriptor pipe convention
// ---------------------------------------------------------------------------

/**
 * Applies the `descriptor | utilities` convention to a tokenized class list.
 * Returns the styling tokens, or a `problem` when the syntax is malformed.
 */
function splitOnDescriptor(tokens, separator) {
    const glued = tokens.find(token => token.name !== separator && token.name.includes(separator))
    if (glued) return { problem: 'notSeparated', token: glued }

    const separators = tokens.filter(token => token.name === separator)
    if (separators.length === 0) return { styling: tokens }
    if (separators.length > 1) return { problem: 'multiplePipes', token: separators[1] }

    const pipeIndex = tokens.findIndex(token => token.name === separator)
    if (pipeIndex === 0) return { problem: 'emptyDescriptor', token: separators[0] }
    if (pipeIndex > 1) return { problem: 'multipleDescriptors', token: tokens[1] }

    return { styling: tokens.slice(pipeIndex + 1) }
}

// ---------------------------------------------------------------------------
// Dynamic value flattening
// ---------------------------------------------------------------------------

/**
 * Class names that are safe to validate from a string literal that took part in
 * a concatenation. `'badge border ' + f()` contributes `badge` and `border`;
 * `'type-' + token` contributes nothing, because `type-` is only a fragment.
 */
function completeTokensOfConcatenatedLiteral(value, { isFirstOperand, isLastOperand }) {
    const tokens = tokenize(value)
    if (!isFirstOperand && tokens.length > 0 && !/^\s/.test(value)) tokens.shift()
    if (!isLastOperand && tokens.length > 0 && !/\s$/.test(value)) tokens.pop()
    return tokens
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

/**
 * Finds a bare design-token custom property inside a Tailwind arbitrary value.
 * Component-local custom properties such as `--progress-color` are untouched.
 */
function bareDesignTokenIn(className, prefixes) {
    if (!className.includes('var(--')) return null
    for (const match of className.matchAll(/var\(\s*(--[\w-]+)/g)) {
        if (prefixes.some(prefix => match[1].startsWith(prefix))) return match[1]
    }
    return null
}

// ---------------------------------------------------------------------------
// Rule
// ---------------------------------------------------------------------------

module.exports = {
    meta: {
        type: 'problem',
        hasSuggestions: true,
        docs: {
            description:
                'Detect classnames which do not belong to Tailwind CSS, the design-token layer, or authored CSS — Angular template aware.',
        },
        messages: {
            ...upstreamRule.meta.messages,
            customClassnameWithSuggestion:
                "Classname '{{classname}}' is not a Tailwind CSS class! Did you mean '{{suggestion}}'?",
            replaceClassname: "Replace with '{{suggestion}}'",
            notSeparated:
                "Malformed class list: '{{token}}' glues the descriptor separator '{{separator}}' to a class. Separate it with spaces.",
            multiplePipes:
                "Malformed class list: a class list has at most one descriptor separator '{{separator}}'.",
            emptyDescriptor:
                "Malformed class list: the descriptor separator '{{separator}}' has no descriptor before it. Omit the separator instead.",
            multipleDescriptors:
                "Malformed class list: at most one semantic descriptor may appear before '{{separator}}'.",
            unresolvedClassName:
                'Class names must be statically resolvable. Use a typed or generated API, or add a narrow, explained lint suppression.',
            bareDesignTokenVariable:
                "Classname '{{classname}}' reaches for the bare design token '{{variable}}'. Use Tailwind's theme(...) function or a generated token API.",
        },
        schema: [
            {
                type: 'object',
                properties: {
                    ...upstreamSchema.properties,
                    descriptorSeparator: { type: 'string' },
                    staticClassAttributes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
                    dynamicClassAttributes: { type: 'array', items: { type: 'string' }, uniqueItems: true },
                    designTokenVariablePrefixes: {
                        type: 'array',
                        items: { type: 'string' },
                        uniqueItems: true,
                    },
                },
            },
        ],
    },

    create(context) {
        const options = context.options[0] ?? {}
        const separator = options.descriptorSeparator ?? DEFAULT_DESCRIPTOR_SEPARATOR
        const staticAttributes = options.staticClassAttributes ?? DEFAULT_STATIC_CLASS_ATTRIBUTES
        const dynamicAttributes = options.dynamicClassAttributes ?? DEFAULT_DYNAMIC_CLASS_ATTRIBUTES
        const tokenPrefixes = options.designTokenVariablePrefixes ?? DEFAULT_TOKEN_VARIABLE_PREFIXES

        const settings = context.settings?.tailwindcss ?? {}
        const tailwindConfig = options.config ?? settings.config
        const cssFiles = options.cssFiles ?? settings.cssFiles
        const owned = ownedClassNames(context.filename ?? context.getFilename())

        /**
         * Upstream reports against the global authorities only. A class the
         * *owning* component authored is legitimate here and nowhere else, so it
         * is filtered out at report time rather than widened into `cssFiles`.
         */
        const onUpstreamReport = descriptor => {
            const classname = descriptor.data?.classname
            if (classname && owned.has(classname)) return

            const suggestion = nearestClassName(classname, { tailwindConfig, cssFiles, owned })
            if (!suggestion) {
                context.report(descriptor)
                return
            }

            context.report({
                ...descriptor,
                messageId: 'customClassnameWithSuggestion',
                data: { ...descriptor.data, suggestion },
                // A suggestion is never applied automatically, which keeps the
                // MAE-100 "no automatic correction" contract intact.
                suggest: descriptor.node?.range
                    ? [
                          {
                              messageId: 'replaceClassname',
                              data: { suggestion },
                              fix: fixer => fixer.replaceTextRange(descriptor.node.range, suggestion),
                          },
                      ]
                    : undefined,
            })
        }

        // `context.report` is frozen, so a Proxy trips the invariant check;
        // delegating through the prototype chain shadows it legally.
        const upstreamContext = Object.create(context, {
            report: { value: onUpstreamReport, enumerable: true },
        })

        // The upstream rule reads the very same options (config, cssFiles, …)
        // through this proxy, so its configuration keeps working untouched.
        const upstream = upstreamRule.create(upstreamContext)

        /** Hands one class name to the upstream rule as if it were `class="…"`. */
        const validateToken = (name, position) => {
            const bareToken = bareDesignTokenIn(name, tokenPrefixes)
            if (bareToken) {
                context.report({
                    loc: position.loc,
                    messageId: 'bareDesignTokenVariable',
                    data: { classname: name, variable: bareToken },
                })
                return
            }
            upstream.TextAttribute({
                type: 'TextAttribute',
                name: 'class',
                value: name,
                loc: position.loc,
                range: position.range,
            })
        }

        /**
         * Validates a class-list string: enforces the descriptor convention and
         * then each styling token, reporting at exact token positions when the
         * caller could supply a locator.
         */
        const validateClassList = (value, locate, fallbackLoc) => {
            const at = (index, length) =>
                locate ? locate(index, length) : { loc: fallbackLoc, range: undefined }

            const split = splitOnDescriptor(tokenize(value), separator)
            if (split.problem) {
                context.report({
                    loc: at(split.token.index, split.token.name.length).loc,
                    messageId: split.problem,
                    data: { separator, token: split.token.name },
                })
                return
            }

            for (const token of split.styling)
                validateToken(token.name, at(token.index, token.name.length))
        }

        /**
         * Reports unresolved construction on the *owning element's* opening
         * line. An HTML comment cannot live inside a tag, so reporting deeper
         * inside a multi-line binding would leave no line on which a narrow
         * `eslint-disable-next-line` suppression could be written.
         */
        const reportUnresolved = (node, fallbackLoc) => {
            let owner = node
            while (owner && owner.type !== 'Element' && owner.type !== 'Element$1' && owner.type !== 'Template')
                owner = owner.parent
            const loc = owner?.loc ?? fallbackLoc
            context.report({
                loc: { start: loc.start, end: { line: loc.start.line, column: loc.start.column + 1 } },
                messageId: 'unresolvedClassName',
            })
        }

        const attributeName = node => node.keySpan?.toString() ?? node.name

        /**
         * Walks a binding expression. Every statically enumerable class list is
         * validated; anything that is not statically resolvable is reported
         * rather than silently accepted.
         */
        const validateBindingValue = (ast, node, valueLocator) => {
            const value = unwrap(ast)
            if (!value) return

            switch (value.type) {
                // [class]="'a b'"
                case 'LiteralPrimitive':
                    if (typeof value.value !== 'string') {
                        reportUnresolved(node, node.loc)
                        return
                    }
                    validateClassList(
                        value.value,
                        valueLocator &&
                            ((index, length) => valueLocator(value.span.start + 1 + index, length)),
                        node.loc,
                    )
                    return

                // [class]="['a', 'b']"
                case 'LiteralArray':
                    value.expressions.forEach(element => validateBindingValue(element, node, valueLocator))
                    return

                // [ngClass]="{ 'a b': cond }"
                case 'LiteralMap':
                    value.keys.forEach(key => {
                        // Angular object keys are always static, quoted or not.
                        if (typeof key.key !== 'string') {
                            reportUnresolved(node, key.loc ?? node.loc)
                            return
                        }
                        const keyStart = key.span === undefined ? undefined : key.span.start + (key.quoted ? 1 : 0)
                        validateClassList(
                            key.key,
                            valueLocator &&
                                keyStart !== undefined &&
                                ((offset, length) => valueLocator(keyStart + offset, length)),
                            key.loc ?? node.loc,
                        )
                    })
                    return

                // [class]="cond ? 'a' : 'b'"
                case 'Conditional':
                    validateBindingValue(value.trueExp, node, valueLocator)
                    validateBindingValue(value.falseExp, node, valueLocator)
                    return

                // [class]="'badge ' + variantClass()"
                case 'Binary': {
                    const operands = flattenConcatenation(value)
                    operands.forEach((operand, index) => {
                        if (operand?.type !== 'LiteralPrimitive' || typeof operand.value !== 'string') {
                            reportUnresolved(node, node.loc)
                            return
                        }
                        const tokens = completeTokensOfConcatenatedLiteral(operand.value, {
                            isFirstOperand: index === 0,
                            isLastOperand: index === operands.length - 1,
                        })
                        for (const token of tokens) {
                            const position = valueLocator
                                ? valueLocator(operand.span.start + 1 + token.index, token.name.length)
                                : { loc: node.loc, range: undefined }
                            validateToken(token.name, position)
                        }
                    })
                    return
                }

                default:
                    // Opaque at lint time. MAE-100: moving a class into a binding
                    // must not become a validation bypass.
                    reportUnresolved(node, node.loc)
            }
        }

        return {
            ...upstream,

            // class="…" and routerLinkActive="…"
            TextAttribute(node) {
                if (!staticAttributes.includes(node.name) || typeof node.value !== 'string') return
                validateClassList(node.value, locatorOf(node.valueSpan), node.loc)
            },

            BoundAttribute(node) {
                // `[attr.class]` sets the same DOM attribute as `[class]`.
                const rawName = attributeName(node)
                const name = rawName.replace(/^attr\./, '')

                // [class.rounded-l-full]="…"
                if (name.startsWith('class.')) {
                    const locate = locatorOf(node.keySpan)
                    const prefix = rawName.length - name.length + 'class.'.length
                    const className = name.slice('class.'.length)
                    validateToken(
                        className,
                        locate ? locate(prefix, className.length) : { loc: node.loc, range: undefined },
                    )
                    return
                }

                // [class]="…" / [ngClass]="…" / [routerLinkActive]="…"
                if (!dynamicAttributes.includes(name)) return
                validateBindingValue(node.value, node, locatorOf(node.valueSpan))
            },

            // @Component({ host: { class: '…' } })
            Property(node) {
                if (upstream.Property) upstream.Property(node)

                const keyName = node.key?.name ?? node.key?.value
                if (keyName !== 'class') return

                const objectExpression = node.parent
                const hostProperty = objectExpression?.parent
                const hostKey = hostProperty?.key?.name ?? hostProperty?.key?.value
                if (hostProperty?.type !== 'Property' || hostKey !== 'host') return

                if (node.value?.type !== 'Literal' || typeof node.value.value !== 'string') {
                    reportUnresolved(node.value ?? node, node.value?.loc ?? node.loc)
                    return
                }

                const start = node.value.loc.start
                validateClassList(
                    node.value.value,
                    (index, length) => ({
                        loc: {
                            start: { line: start.line, column: start.column + 1 + index },
                            end: { line: start.line, column: start.column + 1 + index + length },
                        },
                        range: [node.value.range[0] + 1 + index, node.value.range[0] + 1 + index + length],
                    }),
                    node.loc,
                )
            },
        }
    },
}

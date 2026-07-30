/**
 * The component decorator's `host: { class: '...' }` is a styling surface the template AST never
 * sees, so it gets the same existence check from the TypeScript side.
 */
const { createClassChecker, sharedSchema } = require('../lib/class-checker.cjs')
const { bareTokenVariables, themeReferences, tokenizeClassList } = require('../lib/class-list.cjs')

const HOST_DECORATORS = new Set(['Component', 'Directive'])

function propertyNamed(objectExpression, name) {
    return objectExpression.properties?.find(
        property =>
            property.type === 'Property' &&
            ((property.key.type === 'Identifier' && property.key.name === name) ||
                (property.key.type === 'Literal' && property.key.value === name)),
    )
}

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Every styling class in component host metadata must resolve to CSS',
        },
        schema: [sharedSchema],
        messages: {
            unknownClass:
                '`{{className}}` produces no CSS: Tailwind generates nothing for it and no stylesheet declares it.',
            unknownClassWithSuggestion:
                '`{{className}}` produces no CSS: Tailwind generates nothing for it and no stylesheet declares it. Did you mean `{{suggestion}}`?',
            emptyDescriptor: 'A `|` needs a semantic descriptor before it, or no pipe at all.',
            multipleDescriptors: 'A class list carries at most one semantic descriptor before the `|`.',
            multiplePipes: 'A class list carries at most one `|` separating the descriptor from styling.',
            bareTokenVariable:
                '`{{variable}}` is a design token: reach it through `theme(...)` rather than a bare `var()`.',
            unknownThemePath: '`{{themePath}}` is not a path in the Tailwind theme.',
        },
    },

    create(context) {
        const options = context.options[0] ?? {}
        const sourceCode = context.sourceCode ?? context.getSourceCode()
        const { isThemePath, isValid, suggest } = createClassChecker(options, {
            cwd: context.cwd,
            filePath: context.filename,
        })

        const locFor = (start, end) => ({
            start: sourceCode.getLocFromIndex(start),
            end: sourceCode.getLocFromIndex(end),
        })

        return {
            'Decorator > CallExpression'(node) {
                if (node.callee.type !== 'Identifier' || !HOST_DECORATORS.has(node.callee.name)) return

                const metadata = node.arguments[0]
                if (metadata?.type !== 'ObjectExpression') return

                const host = propertyNamed(metadata, 'host')
                if (host?.value.type !== 'ObjectExpression') return

                const classProperty = propertyNamed(host.value, 'class')
                const classValue = classProperty?.value
                if (classValue?.type !== 'Literal' || typeof classValue.value !== 'string') return

                // +1 to step past the opening quote of the literal.
                const valueStart = classValue.range[0] + 1

                const { tokens, malformed } = tokenizeClassList(classValue.value, { offset: valueStart })

                if (malformed) {
                    context.report({
                        messageId: malformed.reason,
                        loc: locFor(malformed.start, malformed.end),
                    })
                }

                for (const token of tokens) {
                    for (const bare of bareTokenVariables(token)) {
                        context.report({
                            messageId: 'bareTokenVariable',
                            data: { variable: bare.variable },
                            loc: locFor(bare.start, bare.end),
                        })
                    }

                    for (const reference of themeReferences(token)) {
                        if (isThemePath(reference.path)) continue
                        context.report({
                            messageId: 'unknownThemePath',
                            data: { themePath: reference.path },
                            loc: locFor(reference.start, reference.end),
                        })
                    }

                    if (token.kind !== 'styling' || isValid(token.name)) continue

                    const suggestion = suggest(token.name)
                    context.report({
                        messageId: suggestion ? 'unknownClassWithSuggestion' : 'unknownClass',
                        data: { className: token.name, suggestion },
                        loc: locFor(token.start, token.end),
                    })
                }
            },
        }
    },
}

/**
 * The component decorator's `host: { class: '...' }` is a styling surface the template AST never
 * sees, so it gets the same existence check from the TypeScript side.
 */
const { createClassChecker, sharedSchema } = require('../lib/class-checker.cjs')
const { tokenizeClassList } = require('../lib/class-list.cjs')

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
        },
    },

    create(context) {
        const options = context.options[0] ?? {}
        const sourceCode = context.sourceCode ?? context.getSourceCode()
        const isKnownClass = createClassChecker(options, { cwd: context.cwd, filePath: context.filename })

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

                for (const token of tokenizeClassList(classValue.value, { offset: valueStart })) {
                    if (token.kind !== 'styling' || isKnownClass(token.name)) continue

                    context.report({
                        messageId: 'unknownClass',
                        data: { className: token.name },
                        loc: {
                            start: sourceCode.getLocFromIndex(token.start),
                            end: sourceCode.getLocFromIndex(token.end),
                        },
                    })
                }
            },
        }
    },
}

/**
 * Validates that every styling class in an Angular template resolves to CSS — a Tailwind utility for
 * this project's config, a class declared in the global stylesheets, or one declared by the
 * component's own styles. Semantic descriptors left of the `|` are names, not styling, and are left
 * alone.
 */
const { createClassChecker, sharedSchema } = require('../lib/class-checker.cjs')
const { tokenizeClassList } = require('../lib/class-list.cjs')
const { collectClassStrings } = require('../lib/expression-classes.cjs')

/** `BindingType.Class`, i.e. `[class.foo]`. */
const CLASS_BINDING = 2
const CLASS_ATTRIBUTES = new Set(['class', 'ngClass', 'routerLinkActive'])

module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Every styling class in an Angular template must resolve to CSS',
        },
        schema: [sharedSchema],
        messages: {
            unknownClass:
                '`{{className}}` produces no CSS: Tailwind generates nothing for it and no stylesheet declares it.',
            dynamicClassList: 'This class list is computed at runtime and cannot be validated statically.',
            partialClass:
                '`{{className}}` is concatenated with a runtime value and cannot be validated statically.',
        },
    },

    create(context) {
        const options = context.options[0] ?? {}
        const sourceCode = context.sourceCode ?? context.getSourceCode()
        const isKnownClass = createClassChecker(options, { cwd: context.cwd, filePath: context.filename })

        const locFor = (start, end) => {
            try {
                return { start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(end) }
            } catch {
                return undefined
            }
        }

        const reportUnknown = (className, loc) => {
            if (isKnownClass(className)) return
            context.report({ messageId: 'unknownClass', data: { className }, loc })
        }

        const checkClassList = (value, { offset, truncatedStart, truncatedEnd, fallbackLoc }) => {
            for (const token of tokenizeClassList(value, {
                offset: offset ?? 0,
                truncatedStart,
                truncatedEnd,
            })) {
                if (token.kind === 'descriptor' || token.kind === 'interpolated') continue

                const loc =
                    offset === null || offset === undefined ? fallbackLoc : locFor(token.start, token.end)

                if (token.kind === 'partial') {
                    if (options.reportDynamic) {
                        context.report({ messageId: 'partialClass', data: { className: token.name }, loc })
                    }
                    continue
                }

                reportUnknown(token.name, loc)
            }
        }

        const checkExpression = node => {
            const fallbackLoc = locFor(node.sourceSpan.start.offset, node.sourceSpan.end.offset)
            const { strings, dynamic } = collectClassStrings(node.value)

            for (const literal of strings) {
                checkClassList(literal.value, {
                    offset: literal.offset,
                    truncatedStart: literal.truncatedStart,
                    truncatedEnd: literal.truncatedEnd,
                    fallbackLoc,
                })
            }

            if (dynamic && options.reportDynamic) {
                context.report({ messageId: 'dynamicClassList', loc: fallbackLoc })
            }
        }

        return {
            TextAttribute(node) {
                if (!CLASS_ATTRIBUTES.has(node.name) || !node.valueSpan) return

                checkClassList(node.value, {
                    offset: node.valueSpan.start.offset,
                    fallbackLoc: locFor(node.sourceSpan.start.offset, node.sourceSpan.end.offset),
                })
            },

            BoundAttribute(node) {
                if (node.__originalType === CLASS_BINDING) {
                    reportUnknown(node.name, locFor(node.keySpan.start.offset, node.keySpan.end.offset))
                    return
                }

                if (CLASS_ATTRIBUTES.has(node.name)) checkExpression(node)
            },
        }
    },
}

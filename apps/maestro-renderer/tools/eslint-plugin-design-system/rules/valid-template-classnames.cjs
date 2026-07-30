/**
 * Validates that every styling class in an Angular template resolves to CSS — a Tailwind utility for
 * this project's config, a class declared in the global stylesheets, or one declared by the
 * component's own styles. Semantic descriptors left of the `|` are names, not styling, and are left
 * alone.
 */
const { createClassChecker, sharedSchema } = require('../lib/class-checker.cjs')
const { bareTokenVariables, themeReferences, tokenizeClassList } = require('../lib/class-list.cjs')
const { collectClassStrings } = require('../lib/expression-classes.cjs')

/** `BindingType.Class`, i.e. `[class.foo]`. */
const CLASS_BINDING = 2
const CLASS_ATTRIBUTES = new Set(['class', 'ngClass', 'routerLinkActive'])

const malformedMessageIds = {
    emptyDescriptor: 'emptyDescriptor',
    multipleDescriptors: 'multipleDescriptors',
    multiplePipes: 'multiplePipes',
}

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
            unknownClassWithSuggestion:
                '`{{className}}` produces no CSS: Tailwind generates nothing for it and no stylesheet declares it. Did you mean `{{suggestion}}`?',
            dynamicClassList: 'This class list is computed at runtime and cannot be validated statically.',
            partialClass:
                '`{{className}}` is concatenated with a runtime value and cannot be validated statically.',
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
        const reportDynamic = options.reportDynamic ?? true
        const sourceCode = context.sourceCode ?? context.getSourceCode()
        const { isThemePath, isValid, suggest } = createClassChecker(options, {
            cwd: context.cwd,
            filePath: context.filename,
        })

        const locFor = (start, end) => {
            try {
                return { start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(end) }
            } catch {
                return undefined
            }
        }

        const reportUnknown = (className, loc) => {
            if (isValid(className)) return

            const suggestion = suggest(className)
            context.report({
                messageId: suggestion ? 'unknownClassWithSuggestion' : 'unknownClass',
                data: { className, suggestion },
                loc,
            })
        }

        const checkClassList = (value, { offset, truncatedStart, truncatedEnd, fallbackLoc }) => {
            const positioned = offset !== null && offset !== undefined
            const { tokens, malformed } = tokenizeClassList(value, {
                offset: offset ?? 0,
                truncatedStart,
                truncatedEnd,
            })

            if (malformed) {
                context.report({
                    messageId: malformedMessageIds[malformed.reason],
                    loc: positioned ? locFor(malformed.start, malformed.end) : fallbackLoc,
                })
            }

            for (const token of tokens) {
                const loc = positioned ? locFor(token.start, token.end) : fallbackLoc

                // A descriptor is not styling, but an arbitrary value hiding in one still is.
                for (const bare of bareTokenVariables(token)) {
                    context.report({
                        messageId: 'bareTokenVariable',
                        data: { variable: bare.variable },
                        loc: positioned ? locFor(bare.start, bare.end) : fallbackLoc,
                    })
                }

                for (const reference of themeReferences(token)) {
                    if (isThemePath(reference.path)) continue
                    context.report({
                        messageId: 'unknownThemePath',
                        data: { themePath: reference.path },
                        loc: positioned ? locFor(reference.start, reference.end) : fallbackLoc,
                    })
                }

                if (token.kind === 'descriptor' || token.kind === 'interpolated') continue

                if (token.kind === 'partial') {
                    if (reportDynamic) {
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

            if (dynamic && reportDynamic) {
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

/**
 * Validates that every styling class in an Angular template resolves to CSS — a Tailwind utility for
 * this project's config, a class declared in the global stylesheets, or one declared by the
 * component's own styles. Semantic descriptors left of the `|` are names, not styling, and are left
 * alone.
 */
const { createClassChecker, sharedSchema } = require('../lib/class-checker.cjs')
const { CLASS_MESSAGES, describeUnknownClass, TEMPLATE_MESSAGES } = require('../lib/diagnostics.cjs')
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

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Every styling class in an Angular template must resolve to CSS',
        },
        schema: [sharedSchema],
        messages: { ...CLASS_MESSAGES, ...TEMPLATE_MESSAGES },
    },

    create(context) {
        const options = context.options[0] ?? {}
        const reportDynamic = options.reportDynamic ?? true
        const sourceCode = context.sourceCode ?? context.getSourceCode()
        const { isThemePath, isTypedApiExpression, isValid, suggest } = createClassChecker(options, {
            cwd: context.cwd,
            filePath: context.filename,
        })

        /**
         * An index the parser reported but the source map cannot place is not a reason to lose the
         * diagnostic — the finding is still real, it just loses its underline.
         *
         * @type {import('eslint').AST.SourceLocation}
         */
        const WHOLE_FILE = { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } }

        /**
         * @param {number} start
         * @param {number} end
         * @returns {import('eslint').AST.SourceLocation}
         */
        const locFor = (start, end) => {
            try {
                return { start: sourceCode.getLocFromIndex(start), end: sourceCode.getLocFromIndex(end) }
            } catch {
                return WHOLE_FILE
            }
        }

        /**
         * @param {string} className
         * @param {import('eslint').AST.SourceLocation} loc
         */
        const reportUnknown = (className, loc) => {
            if (isValid(className)) return

            context.report({ ...describeUnknownClass(className, suggest(className)), loc })
        }

        /**
         * @param {string} value
         * @param {{ offset?: number|null, truncatedStart?: boolean, truncatedEnd?: boolean,
         *           fallbackLoc: import('eslint').AST.SourceLocation }} placement
         */
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

        /** @param {AngularBoundAttribute} node */
        const checkExpression = node => {
            const fallbackLoc = locFor(node.sourceSpan.start.offset, node.sourceSpan.end.offset)

            // MAE-100 accepts typed/generated APIs for dynamic token selection. The generated
            // module's TypeScript union already constrains what the expression can produce.
            if (isTypedApiExpression(node.value)) return

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
            /** @param {AngularTextAttribute} node */
            TextAttribute(node) {
                if (!CLASS_ATTRIBUTES.has(node.name) || !node.valueSpan) return

                checkClassList(node.value, {
                    offset: node.valueSpan.start.offset,
                    fallbackLoc: locFor(node.sourceSpan.start.offset, node.sourceSpan.end.offset),
                })
            },

            /** @param {AngularBoundAttribute} node */
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

/**
 * Validates that every styling class in an Angular template resolves to CSS — a Tailwind utility for
 * this project's config, a class declared in the global stylesheets, or one declared by the
 * component's own styles. Semantic descriptors left of the `|` are names, not styling, and are left
 * alone.
 */
const { createClassChecker, sharedSchema } = require('../lib/class-checker.cjs')
const { CLASS_MESSAGES, describeUnknownClass, TEMPLATE_MESSAGES } = require('../lib/diagnostics.cjs')
const { bareTokenVariables, themeReferences, tokenizeClassList } = require('../lib/class-list.cjs')
const { componentFileFor } = require('../lib/css-classes.cjs')
const { collectClassStrings } = require('../lib/expression-classes.cjs')
const { createMemberResolver } = require('../lib/member-classes.cjs')

/** `BindingType.Class`, i.e. `[class.foo]`. */
const CLASS_BINDING = 2
/** Names classes to apply on a route match — a list of styling, never a place to name an element. */
const ROUTER_LINK_ACTIVE = 'routerLinkActive'
const CLASS_ATTRIBUTES = new Set(['class', 'ngClass', ROUTER_LINK_ACTIVE])

/**
 * The template AST fields that bind a name for the markup below them: `@for` items and their
 * context variables, `<ng-template let-…>`, `#refs`, and the `as` alias on `@if`. `@let` carries
 * its name on the node itself and is handled beside these.
 */
const VARIABLE_FIELDS = ['item', 'contextVariables', 'variables', 'references', 'expressionAlias']

/**
 * Every name the template itself binds. Angular resolves these ahead of the component's members and
 * the expression AST does not mark which is which, so a name bound anywhere in the file is off
 * limits for member resolution — over-broad by design, and the cost of being wrong is only that an
 * expression stays unresolved.
 *
 * @param {object} ast the parsed template
 * @returns {Set<string>}
 */
function boundNames(ast) {
    /** @type {Set<string>} */
    const names = new Set()

    /** @param {unknown} node */
    const visit = node => {
        if (!node || typeof node !== 'object') return
        if (Array.isArray(node)) return node.forEach(visit)

        const record = /** @type {Record<string, any>} */ (node)
        if (record.type === 'LetDeclaration' && typeof record.name === 'string') names.add(record.name)

        for (const field of VARIABLE_FIELDS) {
            for (const variable of [record[field]].flat()) {
                if (variable && typeof variable.name === 'string') names.add(variable.name)
            }
        }

        for (const [key, value] of Object.entries(record)) {
            if (key === 'parent' || key.endsWith('Span')) continue
            visit(value)
        }
    }

    visit(ast)
    return names
}

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
        const { isThemePath, isValid, suggest } = createClassChecker(options, {
            cwd: context.cwd,
            filePath: context.filename,
        })
        const resolveMember = createMemberResolver(
            componentFileFor(context.filename),
            boundNames(sourceCode.ast),
            { resolveTypes: options.resolveTypes, tsconfig: options.tsconfig },
        )

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
         * @param {{ inDescriptorPosition?: boolean }} [placement]
         */
        const reportUnknown = (className, loc, placement) => {
            if (isValid(className)) return

            context.report({ ...describeUnknownClass(className, suggest(className), placement), loc })
        }

        /**
         * @param {string} value
         * @param {{ offset?: number|null, truncatedStart?: boolean, truncatedEnd?: boolean,
         *           fallbackLoc: import('eslint').AST.SourceLocation,
         *           descriptorsApply?: boolean }} placement
         *   `descriptorsApply` is false for surfaces where the convention has no meaning, so the
         *   diagnostic does not ask "descriptor?" somewhere a descriptor could never belong.
         */
        const checkClassList = (
            value,
            { offset, truncatedStart, truncatedEnd, fallbackLoc, descriptorsApply = true },
        ) => {
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

                reportUnknown(token.name, loc, {
                    inDescriptorPosition: descriptorsApply && token.inDescriptorPosition,
                })
            }
        }

        /** @param {AngularBoundAttribute} node */
        const checkExpression = node => {
            const fallbackLoc = locFor(node.sourceSpan.start.offset, node.sourceSpan.end.offset)

            const { strings, dynamic, reasons } = collectClassStrings(node.value, resolveMember)

            for (const literal of strings) {
                checkClassList(literal.value, {
                    offset: literal.offset,
                    truncatedStart: literal.truncatedStart,
                    truncatedEnd: literal.truncatedEnd,
                    fallbackLoc,
                    descriptorsApply: node.name !== ROUTER_LINK_ACTIVE,
                })
            }

            if (!reportDynamic) return

            // A binding can fail in more than one way at once — a spread beside an unresolvable
            // member — and each half is reported, because fixing one does not reveal the other.
            for (const { reason, data } of reasons) {
                context.report({ messageId: reason, data, loc: fallbackLoc })
            }
            if (dynamic) context.report({ messageId: 'dynamicClassList', loc: fallbackLoc })
        }

        return {
            /** @param {AngularTextAttribute} node */
            TextAttribute(node) {
                if (!CLASS_ATTRIBUTES.has(node.name) || !node.valueSpan) return

                checkClassList(node.value, {
                    offset: node.valueSpan.start.offset,
                    fallbackLoc: locFor(node.sourceSpan.start.offset, node.sourceSpan.end.offset),
                    descriptorsApply: node.name !== ROUTER_LINK_ACTIVE,
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

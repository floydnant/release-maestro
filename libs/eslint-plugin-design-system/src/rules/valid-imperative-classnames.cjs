/**
 * Validate class names applied through TypeScript. Literal arguments take the cheap syntax path;
 * variables and calls use the parser's TypeChecker and remain valid only when their type is a
 * closed string-literal union. The same Tailwind and stylesheet authorities decide validity here
 * as in templates and host metadata.
 */
const { createClassChecker, sharedSchema } = require('../lib/class-checker.cjs')
const { bareTokenVariables, themeReferences, tokenizeClassList } = require('../lib/class-list.cjs')
const { CLASS_MESSAGES, describeUnknownClass } = require('../lib/diagnostics.cjs')
const { stringLiteralsOf } = require('../lib/string-literal-types.cjs')

const CLASS_LIST_MUTATIONS = new Set(['add', 'remove', 'toggle', 'replace'])
const RENDERER_MUTATIONS = new Set(['addClass', 'removeClass'])

/**
 * @param {import('estree').Node | undefined} node
 * @returns {string | undefined}
 */
function literalString(node) {
    if (node?.type === 'Literal' && typeof node.value === 'string') return node.value
    if (node?.type === 'TemplateLiteral' && node.expressions.length === 0) {
        return node.quasis[0].value.cooked ?? undefined
    }
    return undefined
}

/**
 * @param {import('estree').MemberExpression} node
 * @returns {string | undefined}
 */
function memberName(node) {
    if (!node.computed && node.property.type === 'Identifier') return node.property.name
    return literalString(node.property)
}

/** @type {import('eslint').Rule.RuleModule} */
module.exports = {
    meta: {
        type: 'problem',
        docs: {
            description: 'Every imperatively applied class must be a valid, closed vocabulary',
        },
        schema: [sharedSchema],
        messages: {
            ...CLASS_MESSAGES,
            dynamicClass:
                'Imperative class value is typed `{{type}}`, which is not a closed set of class names. Narrow it to a string-literal union, or suppress with a reason.',
            untypedClass:
                'Imperative class value cannot be enumerated without TypeScript type information. Use a literal, enable typed parsing, or suppress with a reason.',
        },
    },
    create(context) {
        const options = context.options[0] ?? {}
        const sourceCode = context.sourceCode
        const services = sourceCode.parserServices
        const checker = services?.program?.getTypeChecker()
        const { isThemePath, isValid, suggest } = createClassChecker(options, {
            cwd: context.cwd,
            filePath: context.filename,
        })
        const hostBindings = new Set(['HostBinding'])
        const angularNamespaces = new Set()
        const rendererTypes = new Set()
        const injectFunctions = new Set()

        /** @param {import('estree').Node | undefined} node */
        const unwrapExpression = node => (node?.type === 'ChainExpression' ? node.expression : node)

        /** @param {any} annotation TypeScript-ESTree annotation node. */
        const isRendererType = annotation => {
            const type = annotation?.type === 'TSTypeAnnotation' ? annotation.typeAnnotation : annotation
            if (type?.type !== 'TSTypeReference') return false
            const name = type.typeName
            return (
                (name.type === 'Identifier' && rendererTypes.has(name.name)) ||
                (name.type === 'TSQualifiedName' &&
                    name.left.type === 'Identifier' &&
                    angularNamespaces.has(name.left.name) &&
                    name.right.type === 'Identifier' &&
                    name.right.name === 'Renderer2')
            )
        }

        /** @param {import('estree').Node | undefined} node */
        const isRendererConstructor = node =>
            (node?.type === 'Identifier' && rendererTypes.has(node.name)) ||
            (node?.type === 'MemberExpression' &&
                node.object.type === 'Identifier' &&
                angularNamespaces.has(node.object.name) &&
                memberName(node) === 'Renderer2')

        /** @param {import('estree').Identifier} identifier */
        const resolveVariable = identifier => {
            /** @type {import('eslint').Scope.Scope | null} */
            let scope = sourceCode.getScope(identifier)
            while (scope) {
                const variable = scope.set.get(identifier.name)
                if (variable) return variable
                scope = scope.upper
            }
            return undefined
        }

        /**
         * @param {any} reference TypeScript-ESTree node with parent links.
         * @param {string} name
         */
        const classMemberIsRenderer = (reference, name) => {
            let owner = reference.parent
            while (owner && owner.type !== 'ClassDeclaration' && owner.type !== 'ClassExpression') {
                owner = owner.parent
            }
            if (!owner) return false
            for (const element of owner.body.body) {
                if (
                    element.type === 'PropertyDefinition' &&
                    element.key.type === 'Identifier' &&
                    element.key.name === name &&
                    (isRendererType(element.typeAnnotation) ||
                        (element.value && isRendererExpression(element.value, new Set())))
                ) {
                    return true
                }
                if (element.type !== 'MethodDefinition' || element.kind !== 'constructor') continue
                for (const parameter of element.value.params) {
                    if (parameter.type !== 'TSParameterProperty') continue
                    const declared = parameter.parameter
                    if (
                        declared.type === 'Identifier' &&
                        declared.name === name &&
                        isRendererType(declared.typeAnnotation)
                    ) {
                        return true
                    }
                }
            }
            return false
        }

        /**
         * @param {import('estree').Node | undefined} node
         * @param {Set<unknown>} seen
         * @returns {boolean}
         */
        function isRendererExpression(node, seen) {
            const expression = unwrapExpression(node)
            if (!expression) return false
            if (expression.type === 'Identifier') {
                const variable = resolveVariable(expression)
                if (!variable || seen.has(variable)) return false
                seen.add(variable)
                return variable.defs.some(definition => {
                    const declared = /** @type {any} */ (definition.name)
                    if (isRendererType(declared.typeAnnotation)) return true
                    return (
                        definition.type === 'Variable' &&
                        definition.node.type === 'VariableDeclarator' &&
                        isRendererExpression(definition.node.init ?? undefined, seen)
                    )
                })
            }
            if (expression.type === 'MemberExpression') {
                const name = memberName(expression)
                return (
                    expression.object.type === 'ThisExpression' &&
                    !!name &&
                    classMemberIsRenderer(expression, name)
                )
            }
            if (expression.type !== 'CallExpression') return false
            const callee = unwrapExpression(expression.callee)
            const isInject =
                (callee?.type === 'Identifier' && injectFunctions.has(callee.name)) ||
                (callee?.type === 'MemberExpression' &&
                    callee.object.type === 'Identifier' &&
                    angularNamespaces.has(callee.object.name) &&
                    memberName(callee) === 'inject')
            const injected = expression.arguments[0]
            return isInject && injected?.type !== 'SpreadElement' && isRendererConstructor(injected)
        }

        /** @param {import('estree').Node} node */
        const fallbackLoc = node => node.loc ?? { start: { line: 1, column: 0 }, end: { line: 1, column: 0 } }

        /** @param {number} start @param {number} end */
        const locFor = (start, end) => ({
            start: sourceCode.getLocFromIndex(start),
            end: sourceCode.getLocFromIndex(end),
        })

        /**
         * Map a boundary in a literal's cooked value back to its raw source offset.
         *
         * @param {import('estree').Node} node
         * @param {number} boundary
         */
        const literalSourceOffset = (node, boundary) => {
            if (!node.range) return null
            const raw = sourceCode.text.slice(node.range[0] + 1, node.range[1] - 1)
            let cookedOffset = 0
            let rawOffset = 0

            while (rawOffset < raw.length && cookedOffset < boundary) {
                if (raw[rawOffset] !== '\\') {
                    rawOffset += 1
                    cookedOffset += 1
                    continue
                }

                const escaped = raw[rawOffset + 1]
                if (escaped === '\r' || escaped === '\n' || escaped === '\u2028' || escaped === '\u2029') {
                    rawOffset += escaped === '\r' && raw[rawOffset + 2] === '\n' ? 3 : 2
                    continue
                }
                if (escaped === 'x' && /^[0-9a-fA-F]{2}/.test(raw.slice(rawOffset + 2))) {
                    rawOffset += 4
                    cookedOffset += 1
                    continue
                }
                if (escaped === 'u' && raw[rawOffset + 2] === '{') {
                    const close = raw.indexOf('}', rawOffset + 3)
                    if (close !== -1) {
                        const codePoint = Number.parseInt(raw.slice(rawOffset + 3, close), 16)
                        rawOffset = close + 1
                        cookedOffset += codePoint > 0xffff ? 2 : 1
                        continue
                    }
                }
                if (escaped === 'u' && /^[0-9a-fA-F]{4}/.test(raw.slice(rawOffset + 2))) {
                    rawOffset += 6
                    cookedOffset += 1
                    continue
                }

                rawOffset += 2
                cookedOffset += 1
            }

            return node.range[0] + 1 + rawOffset
        }

        /**
         * @param {import('estree').Node} node
         * @param {number} start
         * @param {number} end
         */
        const literalLocFor = (node, start, end) => {
            const sourceStart = literalSourceOffset(node, start)
            const sourceEnd = literalSourceOffset(node, end)
            return sourceStart === null || sourceEnd === null
                ? fallbackLoc(node)
                : locFor(sourceStart, sourceEnd)
        }

        /**
         * @param {string} className
         * @param {import('eslint').AST.SourceLocation} loc
         */
        const checkClassName = (className, loc) => {
            const token = {
                name: className,
                start: 0,
                end: className.length,
                kind: /** @type {const} */ ('styling'),
                inDescriptorPosition: false,
            }
            for (const bare of bareTokenVariables(token)) {
                context.report({ messageId: 'bareTokenVariable', data: { variable: bare.variable }, loc })
            }
            for (const reference of themeReferences(token)) {
                if (!isThemePath(reference.path)) {
                    context.report({
                        messageId: 'unknownThemePath',
                        data: { themePath: reference.path },
                        loc,
                    })
                }
            }
            if (!isValid(className)) {
                context.report({ ...describeUnknownClass(className, suggest(className)), loc })
            }
        }

        /**
         * @param {string} value
         * @param {import('eslint').AST.SourceLocation} fallback
         * @param {((start: number, end: number) => import('eslint').AST.SourceLocation)|null} [locate]
         */
        const checkClassList = (value, fallback, locate = null) => {
            const { tokens, malformed } = tokenizeClassList(value)
            if (malformed) {
                context.report({
                    messageId: malformed.reason,
                    loc: locate ? locate(malformed.start, malformed.end) : fallback,
                })
            }
            for (const token of tokens) {
                if (token.kind === 'styling') {
                    checkClassName(token.name, locate ? locate(token.start, token.end) : fallback)
                }
            }
        }

        /**
         * @param {import('estree').Node} node
         * @param {boolean} [elements]
         * @returns {{ literals: string[] } | { type: string } | null}
         */
        const typedStrings = (node, elements = false) => {
            if (!services?.getTypeAtLocation || !checker) return null
            /** @type {import('typescript').Type} */
            const type = services.getTypeAtLocation(node)
            if (process.env.CI && elements) {
                const tsNode = services.esTreeNodeToTSNodeMap?.get(node)
                const checkerType = tsNode ? checker.getTypeAtLocation(tsNode) : undefined
                /** @type {import('typescript').Type[]} */
                const debugTypeArguments = checker.getTypeArguments(type)
                console.error(
                    '[DEBUG-mae108]',
                    JSON.stringify({
                        source: sourceCode.getText(node),
                        serviceType: checker.typeToString(type),
                        checkerType: checkerType ? checker.typeToString(checkerType) : null,
                        sameType: checkerType === type,
                        isArray: checker.isArrayType(type),
                        isTuple: checker.isTupleType(type),
                        typeArguments: debugTypeArguments.map(argument => checker.typeToString(argument)),
                        numberIndex: type.getNumberIndexType()
                            ? checker.typeToString(type.getNumberIndexType())
                            : null,
                        symbol: type.symbol?.name ?? null,
                        flags: type.flags,
                    }),
                )
            }
            /** @type {import('typescript').Type[]} */
            const checkedTypes = elements
                ? (type.isUnion() ? type.types : [type]).flatMap(part =>
                      checker.isArrayType(part) || checker.isTupleType(part)
                          ? checker.getTypeArguments(part)
                          : (part.getNumberIndexType() ?? []),
                  )
                : [type]
            const literalGroups = checkedTypes.map(stringLiteralsOf)
            if (checkedTypes.length > 0 && literalGroups.every(literals => literals !== null)) {
                return { literals: literalGroups.flat() }
            }
            const displayedTypes = checkedTypes.length > 0 ? checkedTypes : [type]
            return { type: displayedTypes.map(checkedType => checker.typeToString(checkedType)).join(' | ') }
        }

        /**
         * @param {import('estree').Node} node
         * @param {'list'|'token'} shape
         * @param {boolean} [syntaxLiteral]
         * @param {boolean} [elements]
         */
        const checkExpression = (node, shape, syntaxLiteral = true, elements = false) => {
            const literal = syntaxLiteral ? literalString(node) : undefined
            const resolved = literal === undefined ? typedStrings(node, elements) : { literals: [literal] }
            const fallback = fallbackLoc(node)

            if (!resolved) {
                context.report({ node, messageId: 'untypedClass' })
                return
            }
            if ('type' in resolved) {
                context.report({ node, messageId: 'dynamicClass', data: { type: resolved.type } })
                return
            }
            for (const value of resolved.literals) {
                /** @type {((start: number, end: number) => import('eslint').AST.SourceLocation)|null} */
                const locate = literal === undefined ? null : (start, end) => literalLocFor(node, start, end)
                if (shape === 'list') checkClassList(value, fallback, locate)
                else {
                    checkClassName(value, locate ? locate(0, value.length) : fallback)
                }
            }
        }

        return {
            /** @param {import('estree').Program} program */
            Program(program) {
                // Imports are hoisted, even when written after the decorated class.
                for (const node of program.body) {
                    if (node.type !== 'ImportDeclaration' || node.source.value !== '@angular/core') continue
                    for (const specifier of node.specifiers) {
                        if (specifier.type === 'ImportNamespaceSpecifier') {
                            angularNamespaces.add(specifier.local.name)
                        } else if (specifier.type === 'ImportSpecifier') {
                            const imported =
                                specifier.imported.type === 'Identifier'
                                    ? specifier.imported.name
                                    : specifier.imported.value
                            if (imported === 'HostBinding') hostBindings.add(specifier.local.name)
                            if (imported === 'Renderer2') rendererTypes.add(specifier.local.name)
                            if (imported === 'inject') injectFunctions.add(specifier.local.name)
                        }
                    }
                }
            },
            /** @param {import('estree').CallExpression} node */
            'Decorator > CallExpression'(node) {
                const callee = node.callee
                const isHostBinding =
                    (callee.type === 'Identifier' && hostBindings.has(callee.name)) ||
                    (callee.type === 'MemberExpression' &&
                        callee.object.type === 'Identifier' &&
                        angularNamespaces.has(callee.object.name) &&
                        memberName(callee) === 'HostBinding')
                if (!isHostBinding) return

                const binding = literalString(node.arguments[0])
                const decorated = /** @type {any} */ (node).parent?.parent
                const implicitBinding =
                    node.arguments.length === 0 && decorated && 'key' in decorated
                        ? decorated.key.type === 'Identifier'
                            ? decorated.key.name
                            : literalString(decorated.key)
                        : undefined
                const target = binding ?? implicitBinding

                if (target?.startsWith('class.')) {
                    const bindingNode = node.arguments[0]
                    if (!bindingNode || bindingNode.type === 'SpreadElement') return
                    const className = target.slice('class.'.length)
                    checkClassName(
                        className,
                        literalLocFor(bindingNode, 'class.'.length, target.length),
                    )
                } else if ((target === 'class' || target === 'className') && decorated?.key) {
                    // The member name's type describes every value Angular can apply, including
                    // later assignments and getter returns. An initializer alone would be weaker.
                    checkExpression(decorated.key, 'list', false)
                }
            },
            /** @param {import('estree').CallExpression} node */
            CallExpression(node) {
                const callee = node.callee
                if (callee.type !== 'MemberExpression') return
                const method = memberName(callee)
                if (!method) return

                const classList =
                    callee.object.type === 'MemberExpression' && memberName(callee.object) === 'classList'
                if (classList && CLASS_LIST_MUTATIONS.has(method)) {
                    const argumentsToCheck =
                        method === 'add' || method === 'remove'
                            ? node.arguments
                            : method === 'replace'
                              ? node.arguments.slice(0, 2)
                              : node.arguments.slice(0, 1)
                    for (const argument of argumentsToCheck) {
                        checkExpression(
                            argument.type === 'SpreadElement' ? argument.argument : argument,
                            'token',
                            true,
                            argument.type === 'SpreadElement',
                        )
                    }
                    return
                }

                const rendererMutation =
                    RENDERER_MUTATIONS.has(method) && isRendererExpression(callee.object, new Set())
                const classArgument = rendererMutation ? node.arguments[1] : undefined
                if (classArgument) {
                    checkExpression(
                        classArgument.type === 'SpreadElement' ? classArgument.argument : classArgument,
                        'token',
                    )
                }
            },
        }
    },
}

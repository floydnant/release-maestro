/**
 * Keep class application on the template and host-metadata surfaces the class validators inspect.
 * Resolve Renderer2 from its Angular import and typed injection sites so unrelated APIs with the
 * same method names remain available. Aliases and optional chaining must not hide a mutation.
 */
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
            description: 'Apply classes through validated templates and host metadata only',
        },
        schema: [],
        messages: {
            hostBinding:
                'Apply classes through host metadata instead of @HostBinding. Use host: { class: "…" } or host: { "[class.foo]": "condition" }.',
            mutation:
                'Apply classes through a template binding or host metadata instead of {{method}}. These surfaces validate class names.',
        },
    },
    create(context) {
        const sourceCode = context.sourceCode
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
                const binding = literalString(node.arguments[0])
                const decorated = /** @type {any} */ (node).parent?.parent
                const implicitBinding =
                    node.arguments.length === 0 &&
                    decorated &&
                    'key' in decorated &&
                    decorated.key.type === 'Identifier'
                        ? decorated.key.name
                        : undefined
                if (
                    isHostBinding &&
                    (binding === 'class' ||
                        binding === 'className' ||
                        binding?.startsWith('class.') ||
                        implicitBinding === 'class' ||
                        implicitBinding === 'className')
                ) {
                    context.report({
                        node: node.arguments[0] ?? decorated.key,
                        messageId: 'hostBinding',
                    })
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
                const rendererMutation =
                    RENDERER_MUTATIONS.has(method) && isRendererExpression(callee.object, new Set())
                if (rendererMutation || (classList && CLASS_LIST_MUTATIONS.has(method))) {
                    context.report({ node: callee.property, messageId: 'mutation', data: { method } })
                }
            },
        }
    },
}

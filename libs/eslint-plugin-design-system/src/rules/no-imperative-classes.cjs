/**
 * Keep class application on the template and host-metadata surfaces the class validators inspect.
 * Match API spelling, not receiver types: injection, aliases and optional chaining must not hide a
 * mutation. A different API with the same spelling can use a narrow, explained ESLint suppression.
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
        const hostBindings = new Set(['HostBinding'])
        const angularNamespaces = new Set()

        return {
            /** @param {import('estree').ImportDeclaration} node */
            ImportDeclaration(node) {
                if (node.source.value !== '@angular/core') return
                for (const specifier of node.specifiers) {
                    if (specifier.type === 'ImportNamespaceSpecifier') {
                        angularNamespaces.add(specifier.local.name)
                    } else if (
                        specifier.type === 'ImportSpecifier' &&
                        (specifier.imported.type === 'Identifier'
                            ? specifier.imported.name
                            : specifier.imported.value) === 'HostBinding'
                    ) {
                        hostBindings.add(specifier.local.name)
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
                if (isHostBinding && (binding === 'class' || binding?.startsWith('class.'))) {
                    context.report({ node: node.arguments[0], messageId: 'hostBinding' })
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
                if (RENDERER_MUTATIONS.has(method) || (classList && CLASS_LIST_MUTATIONS.has(method))) {
                    context.report({ node: callee.property, messageId: 'mutation', data: { method } })
                }
            },
        }
    },
}

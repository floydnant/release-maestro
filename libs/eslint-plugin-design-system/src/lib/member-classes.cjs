/**
 * Resolves a template expression to the class lists it can actually produce, for the one case where
 * that is knowable without a type checker: the expression names a member of the component that owns
 * this template, and that member returns nothing but string literals.
 *
 * This is deliberately not the check MAE-100 removed. That one read the *export names* out of a
 * configured generated file and trusted any expression whose root identifier matched one of them —
 * so a same-named local helper passed, and nothing established that the values were class names.
 * Here:
 *
 * - the member is resolved by **declaration site** — the component file the template already maps to
 *   — so a name is never trusted for its spelling;
 * - the answer is the **literal strings themselves**, which the caller validates against the same
 *   authorities as any hand-written class list, so nothing is trusted for its shape;
 * - anything not enumerable is `null`, and the caller reports it exactly as before.
 *
 * What it does not do is cross a module boundary: a value imported from elsewhere, a base-class
 * member, a call chain, a mutable `signal()` — all unresolvable. Widening that needs a
 * `TypeChecker`, which needs a program, which is a cost measured and deferred in MAE-111.
 */
const ts = require('typescript')
const { componentSourceFile, decoratedClasses } = require('./component-metadata.cjs')

/**
 * `computed()` and nothing else. Its value is exactly what its callback returns, which is the
 * property being relied on here — `signal()` and `linkedSignal()` are writable, so their initial
 * value says nothing about what the template will render.
 */
const DERIVED_FACTORY = 'computed'
const ANGULAR_CORE = '@angular/core'

/**
 * @typedef {object} ResolvedMember
 * @property {boolean} invoked whether the template has to call it — a method and a `computed` are
 *   read through `()`, a plain string property without. A template that gets this wrong is not
 *   describing this member, so the mismatch is a reason to give up rather than to guess.
 * @property {string[]} literals every string the member can produce
 */

/**
 * Keyed on the parse it was built from rather than on an mtime of its own: `componentSourceFile`
 * already invalidates by mtime, so a source that is identical is a source that has not changed.
 *
 * @type {Map<string, { source: ts.SourceFile, members: Map<string, ResolvedMember|null> }>}
 */
const memberCache = new Map()

/**
 * Whether `name` is imported from `@angular/core` in this file. Import-site resolution, so a local
 * helper that happens to be called `computed` is not mistaken for Angular's.
 *
 * @param {ts.SourceFile} source
 * @param {string} name
 * @returns {boolean}
 */
function importedFromAngularCore(source, name) {
    for (const statement of source.statements) {
        if (!ts.isImportDeclaration(statement)) continue
        if (!ts.isStringLiteralLike(statement.moduleSpecifier)) continue
        if (statement.moduleSpecifier.text !== ANGULAR_CORE) continue

        const bindings = statement.importClause?.namedBindings
        if (!bindings || !ts.isNamedImports(bindings)) continue
        // `import { computed as c }` binds `c`; the local name is what the initializer would use.
        if (bindings.elements.some(element => element.name.text === name)) return true
    }
    return false
}

/**
 * Every string an expression can evaluate to, or null once any branch stops being a literal.
 *
 * @param {ts.Expression|undefined} node
 * @returns {string[]|null}
 */
function literalValues(node) {
    if (!node) return null
    if (ts.isStringLiteralLike(node)) return [node.text]
    if (ts.isParenthesizedExpression(node)) return literalValues(node.expression)

    if (ts.isConditionalExpression(node)) {
        const whenTrue = literalValues(node.whenTrue)
        const whenFalse = literalValues(node.whenFalse)
        return whenTrue && whenFalse ? [...whenTrue, ...whenFalse] : null
    }

    return null
}

/**
 * Every string a function body can return.
 *
 * A body that can reach its end without returning is not a concern here: `noImplicitReturns` and
 * `noFallthroughCasesInSwitch` are on workspace-wide, so a function with a `return` in it returns on
 * every path — which is what lets an exhaustive `switch` with no `default` clause resolve.
 *
 * @param {ts.ConciseBody|undefined} body
 * @returns {string[]|null}
 */
function returnedLiterals(body) {
    if (!body) return null
    if (!ts.isBlock(body)) return literalValues(body)

    /** @type {string[]} */
    const literals = []
    let enumerable = true

    /** @param {ts.Node} node */
    const visit = node => {
        // A nested function's returns are its own.
        if (ts.isFunctionLike(node)) return

        if (ts.isReturnStatement(node)) {
            const values = literalValues(node.expression)
            if (values) literals.push(...values)
            else enumerable = false
            return
        }

        ts.forEachChild(node, visit)
    }

    ts.forEachChild(body, visit)
    return enumerable && literals.length > 0 ? literals : null
}

/**
 * @param {ts.SourceFile} source
 * @param {ts.ClassElement} member
 * @returns {ResolvedMember|null}
 */
function resolveMember(source, member) {
    if (ts.isMethodDeclaration(member)) {
        // Arguments are ignored on purpose: the answer is every class list the method can return for
        // any input, which is the conservative reading and the only one available without types.
        const literals = returnedLiterals(member.body)
        return literals && { invoked: true, literals }
    }

    if (ts.isGetAccessor(member)) {
        const literals = returnedLiterals(member.body)
        return literals && { invoked: false, literals }
    }

    if (!ts.isPropertyDeclaration(member) || !member.initializer) return null

    const initializer = member.initializer

    const constant = literalValues(initializer)
    if (constant) return { invoked: false, literals: constant }

    if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        const literals = returnedLiterals(initializer.body)
        return literals && { invoked: true, literals }
    }

    if (
        ts.isCallExpression(initializer) &&
        ts.isIdentifier(initializer.expression) &&
        initializer.expression.text === DERIVED_FACTORY &&
        importedFromAngularCore(source, DERIVED_FACTORY)
    ) {
        const callback = initializer.arguments[0]
        if (!callback || !(ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) return null
        const literals = returnedLiterals(callback.body)
        return literals && { invoked: true, literals }
    }

    return null
}

/**
 * Every resolvable member of every component in the file, by name. A name declared by more than one
 * component in the same file resolves to nothing: the template maps to the file, and picking one of
 * two answers would be a guess.
 *
 * @param {string} tsPath
 * @returns {Map<string, ResolvedMember|null>}
 */
function resolvableMembers(tsPath) {
    const source = componentSourceFile(tsPath)
    if (!source) return new Map()

    const cached = memberCache.get(tsPath)
    if (cached && cached.source === source) return cached.members

    /** @type {Map<string, ResolvedMember|null>} */
    const members = new Map()

    for (const declaration of decoratedClasses(source)) {
        for (const member of declaration.members) {
            if (!member.name || !ts.isIdentifier(member.name)) continue
            const name = member.name.text
            // Declared twice across the file's components — ambiguous, and stays ambiguous even if
            // the second declaration is unresolvable.
            members.set(name, members.has(name) ? null : resolveMember(source, member))
        }
    }

    memberCache.set(tsPath, { source, members })
    return members
}

/**
 * The member an expression names, for the two shapes that address the component directly:
 * `member()` and `member`. A chain (`obj.member()`, `member().foo`) is not one of them — the rule
 * cannot see what the rest of the chain does, so the root resolving proves nothing.
 *
 * @param {AngularExpression} node
 * @returns {{ name: string, invoked: boolean }|null}
 */
function addressedMember(node) {
    if (node.type === 'Call') {
        const receiver = node.receiver
        if (!receiver || receiver.type !== 'PropertyRead') return null
        if (receiver.receiver?.type !== 'ImplicitReceiver') return null
        return receiver.name ? { name: receiver.name, invoked: true } : null
    }

    if (node.type === 'PropertyRead') {
        if (node.receiver?.type !== 'ImplicitReceiver') return null
        return node.name ? { name: node.name, invoked: false } : null
    }

    return null
}

/**
 * @param {string|null} componentFile the component the template belongs to
 * @param {Set<string>} shadowed names the template itself binds — `@for` items, `@let`, `as`
 *   aliases, template references. Angular resolves those before the component's own members, and
 *   the expression AST does not distinguish them, so a name the template binds anywhere is never
 *   resolved against the component.
 * @returns {(node: AngularExpression) => string[]|null}
 */
function createMemberResolver(componentFile, shadowed) {
    if (!componentFile) return () => null

    return node => {
        const addressed = addressedMember(node)
        if (!addressed || shadowed.has(addressed.name)) return null

        const member = resolvableMembers(componentFile).get(addressed.name)
        if (!member || member.invoked !== addressed.invoked) return null

        return member.literals
    }
}

module.exports = { createMemberResolver }

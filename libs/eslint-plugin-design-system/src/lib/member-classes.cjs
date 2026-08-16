/**
 * Resolves a template expression to the class lists it can actually produce, when the expression
 * names a member of the component that owns this template.
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
 * - anything not enumerable is reported, with the reason it could not be enumerated.
 *
 * Two tiers answer that question, in cost order:
 *
 * 1. **Syntactic.** One AST walk over the component file, which is already parsed for its
 *    `@Component` metadata. Free, and enough for a vocabulary written out inline.
 * 2. **Typed.** A `TypeChecker`, reached only when the first tier could not enumerate a member the
 *    component genuinely declares. This is what sees through `as const`, a union alias, an imported
 *    vocabulary, a `signal<'a'|'b'>()`, or an inherited member. Off unless `resolveTypes` is set;
 *    see `type-program.cjs` for what it costs.
 *
 * Whatever the tier, failing to enumerate is not the end of it: the resolver says *why*, so the
 * diagnostic can name the one edit that would fix it instead of asking for a suppression.
 */
const ts = require('typescript')
const { componentSourceFile, decoratedClasses } = require('./component-metadata.cjs')
const { programFor } = require('./type-program.cjs')

/**
 * `computed()` and nothing else. Its value is exactly what its callback returns, which is the
 * property being relied on here — `signal()` and `linkedSignal()` are writable, so their initial
 * value says nothing about what the template will render. The typed tier has no such problem: a
 * `WritableSignal<'a'|'b'>` constrains every write, so its *type* is the closed set even though its
 * initializer is not.
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
 * @typedef {{ literals: string[] }} Enumerated
 * @typedef {{ reason: string, data?: Record<string, string> }} Unresolved
 * @typedef {Enumerated | Unresolved | null} Resolution `null` means the expression is not addressing
 *   a component member at all, and the caller has nothing more specific to say than "runtime-built".
 */

/**
 * Keyed on the parse it was built from rather than on an mtime of its own: `componentSourceFile`
 * already invalidates by mtime, so a source that is identical is a source that has not changed.
 *
 * @type {Map<string, { source: ts.SourceFile, entry: ComponentMembers }>}
 */
const memberCache = new Map()

/**
 * @typedef {object} ComponentMembers
 * @property {Map<string, ResolvedMember|null>} members every name any component in the file declares,
 *   mapped to what it resolves to — `null` when the name is declared but not enumerable, and absent
 *   from the map entirely when no component declares it.
 * @property {string} componentName what to call the component in a diagnostic.
 * @property {boolean} inherits whether any component in the file extends something, which is the only
 *   way a member the file does not declare can still exist.
 */

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
    // `'flex' as const` and `'flex' satisfies ClassList` are the same string at runtime.
    if (ts.isAsExpression(node) || ts.isSatisfiesExpression(node)) return literalValues(node.expression)

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
 * @returns {ComponentMembers}
 */
function componentMembers(tsPath) {
    const source = componentSourceFile(tsPath)
    if (!source) return { members: new Map(), componentName: 'the component', inherits: false }

    const cached = memberCache.get(tsPath)
    if (cached && cached.source === source) return cached.entry

    /** @type {Map<string, ResolvedMember|null>} */
    const members = new Map()
    const classes = decoratedClasses(source)
    let inherits = false

    for (const declaration of classes) {
        if (declaration.heritageClauses?.length) inherits = true

        for (const member of declaration.members) {
            if (!member.name || !ts.isIdentifier(member.name)) continue
            const name = member.name.text
            // Declared twice across the file's components — ambiguous, and stays ambiguous even if
            // the second declaration is unresolvable.
            members.set(name, members.has(name) ? null : resolveMember(source, member))
        }
    }

    const entry = {
        members,
        componentName: classes.find(declaration => declaration.name)?.name?.text ?? 'the component',
        inherits,
    }
    memberCache.set(tsPath, { source, entry })
    return entry
}

// --- the typed tier ------------------------------------------------------------------------------

/**
 * Every string a type can be, or null the moment one of its parts is not a string literal. A union
 * of literals is the shape being looked for; anything wider — `string`, a template literal type, a
 * union with a non-literal in it — is not a closed vocabulary.
 *
 * @param {ts.Type} type
 * @returns {string[]|null}
 */
function stringLiteralsOf(type) {
    const parts = type.isUnion() ? type.types : [type]

    /** @type {string[]} */
    const literals = []
    for (const part of parts) {
        if (!part.isStringLiteral()) return null
        literals.push(part.value)
    }
    return literals.length > 0 ? literals : null
}

/**
 * @typedef {{ kind: 'literals', invoked: boolean, literals: string[] }
 *   | { kind: 'wider', invoked: boolean, type: string }
 *   | { kind: 'missing' }
 *   | { kind: 'ambiguous' }} TypedAnswer
 */

/**
 * What the checker says a member is. Reached only when the syntactic tier could not answer, so the
 * program is built on the first template that needs it and never for one that does not.
 *
 * @param {string} componentFile
 * @param {string} name
 * @param {string|undefined} tsconfig
 * @returns {TypedAnswer|null} null when no program covers the file, which is not a finding — it is
 *   the rule being unable to look, and the caller falls back to what the syntax showed.
 */
function typedMember(componentFile, name, tsconfig) {
    const built = programFor(componentFile, tsconfig)
    if (!built) return null

    const source = built.program.getSourceFile(componentFile)
    if (!source) return null

    const { checker } = built

    /** @type {{ declaration: ts.ClassDeclaration, property: ts.Symbol }[]} */
    const matches = []

    for (const declaration of decoratedClasses(source)) {
        if (!declaration.name) continue
        const symbol = checker.getSymbolAtLocation(declaration.name)
        if (!symbol) continue

        // The *instance* type, so an inherited member is found the same way the template would find
        // it — which is the main thing this tier buys over the AST walk.
        const property = checker.getPropertyOfType(checker.getDeclaredTypeOfSymbol(symbol), name)
        if (property) matches.push({ declaration, property })
    }

    if (matches.length === 0) return { kind: 'missing' }
    if (matches.length > 1) return { kind: 'ambiguous' }

    const { declaration, property } = matches[0]
    const declared = checker.getTypeOfSymbolAtLocation(property, declaration)

    // A method, an arrow property, and a `Signal<T>` are all "read through `()`" — one call
    // signature, and the value is what it returns. Overloads contribute every return type.
    const signatures = declared.getCallSignatures()
    const invoked = signatures.length > 0

    if (!invoked) {
        const literals = stringLiteralsOf(declared)
        return literals
            ? { kind: 'literals', invoked, literals }
            : { kind: 'wider', invoked, type: checker.typeToString(declared) }
    }

    /** @type {string[]} */
    const literals = []
    for (const signature of signatures) {
        const values = stringLiteralsOf(checker.getReturnTypeOfSignature(signature))
        if (!values) {
            const returned = checker.getReturnTypeOfSignature(signatures[0])
            return { kind: 'wider', invoked, type: checker.typeToString(returned) }
        }
        literals.push(...values)
    }
    return { kind: 'literals', invoked, literals }
}

// --- what the template addressed -----------------------------------------------------------------

/**
 * @typedef {{ kind: 'member', name: string, invoked: boolean }
 *   | { kind: 'chain' }
 *   | { kind: 'other' }} Addressed
 */

/**
 * What an expression is reaching for. Only the two shapes that address the component directly —
 * `member()` and `member` — can resolve; a chain (`obj.member()`, `member().foo`, `list[i]`) is
 * called out separately, because "give the whole class list its own member" is a real instruction
 * and "runtime-built class list" is not.
 *
 * @param {AngularExpression} node
 * @returns {Addressed}
 */
function addressedMember(node) {
    if (node.type === 'Call' || node.type === 'SafeCall') {
        const receiver = node.receiver
        if (!receiver) return { kind: 'other' }
        if (receiver.type !== 'PropertyRead' && receiver.type !== 'SafePropertyRead') {
            return { kind: 'chain' }
        }
        if (receiver.receiver?.type !== 'ImplicitReceiver') return { kind: 'chain' }
        return receiver.name ? { kind: 'member', name: receiver.name, invoked: true } : { kind: 'other' }
    }

    if (node.type === 'PropertyRead' || node.type === 'SafePropertyRead') {
        if (node.receiver?.type !== 'ImplicitReceiver') return { kind: 'chain' }
        return node.name ? { kind: 'member', name: node.name, invoked: false } : { kind: 'other' }
    }

    if (node.type === 'KeyedRead' || node.type === 'SafeKeyedRead') return { kind: 'chain' }

    return { kind: 'other' }
}

/**
 * How a member is written when the template gets its call shape wrong, phrased so the message can
 * quote the fix rather than describe it.
 *
 * @param {string} name
 * @param {boolean} declaredInvoked
 */
const shapeMismatch = (name, declaredInvoked) => ({
    reason: 'memberCallShape',
    data: {
        name,
        declared: declaredInvoked ? 'a method or a signal' : 'a plain value',
        read: declaredInvoked ? 'a property' : 'a call',
        fix: declaredInvoked ? `${name}()` : name,
    },
})

/**
 * @param {string|null} componentFile the component the template belongs to
 * @param {Set<string>} shadowed names the template itself binds — `@for` items, `@let`, `as`
 *   aliases, template references. Angular resolves those before the component's own members, and
 *   the expression AST does not distinguish them, so a name the template binds anywhere is never
 *   resolved against the component.
 * @param {{ resolveTypes?: boolean, tsconfig?: string }} [options]
 * @returns {(node: AngularExpression) => Resolution}
 */
function createMemberResolver(componentFile, shadowed, options = {}) {
    if (!componentFile) return () => null
    const file = componentFile

    // Annotated rather than inferred: without a contextual type, TypeScript unions the branches'
    // object literals and every `data` grows the other branches' keys as `undefined`.
    /** @type {(node: AngularExpression) => Resolution} */
    const resolve = node => {
        const addressed = addressedMember(node)
        if (addressed.kind === 'other') return null
        if (addressed.kind === 'chain') return { reason: 'chainedMember' }

        const { name, invoked } = addressed
        const { members, componentName, inherits } = componentMembers(file)

        // Ahead of everything else: Angular resolves a template's own bindings before the
        // component's members, so a shadowed name is not this member however well it would resolve.
        if (shadowed.has(name)) {
            return { reason: 'shadowedMember', data: { name, component: componentName } }
        }

        // Tier 1: the vocabulary is written out in the component, and no program is needed.
        const syntactic = members.get(name)
        if (syntactic && syntactic.invoked === invoked) return { literals: syntactic.literals }

        const declaredHere = members.has(name)

        // Tier 2: only worth a program when the name could still be a member — either the file
        // declares it and the syntax was not enumerable, or a base class might.
        const typed =
            options.resolveTypes && (declaredHere || inherits)
                ? typedMember(file, name, options.tsconfig)
                : null

        if (typed) {
            switch (typed.kind) {
                case 'literals':
                    return typed.invoked === invoked
                        ? { literals: typed.literals }
                        : shapeMismatch(name, typed.invoked)
                case 'wider':
                    return typed.invoked === invoked
                        ? { reason: 'widerMember', data: { name, type: typed.type } }
                        : shapeMismatch(name, typed.invoked)
                case 'ambiguous':
                    return { reason: 'ambiguousMember', data: { name, component: componentName } }
                case 'missing':
                    return { reason: 'unknownMember', data: { name, component: componentName } }
            }
        }

        if (!declaredHere) return { reason: 'unknownMember', data: { name, component: componentName } }
        if (syntactic) return shapeMismatch(name, syntactic.invoked)

        return { reason: 'unenumerableMember', data: { name, component: componentName } }
    }

    return resolve
}

module.exports = { createMemberResolver }

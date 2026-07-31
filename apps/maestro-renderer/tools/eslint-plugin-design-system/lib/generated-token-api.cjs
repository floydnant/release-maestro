/**
 * Harvested from the MAE-107 prototype.
 *
 * MAE-100 accepts "typed/generated APIs for legitimate dynamic token selection". A class expression
 * rooted in something the generated design-token module exports is exactly that: the TypeScript
 * union on the generated signature already decides which token names are legal, so re-deciding it
 * here would only duplicate an authority. Everything else that is built at runtime stays
 * unresolvable and is reported.
 *
 * The check is deliberately shallow — the *root* identifier of a call or property chain, nothing
 * else. It cannot see through a component method that wraps the generated call, which is why the
 * renderer still carries suppressions for its three closed-vocabulary helpers.
 */
const fs = require('node:fs')
const path = require('node:path')
const ts = require('typescript')

const DEFAULT_GENERATED_TOKEN_API = 'apps/maestro-renderer/src/app/shared/design-tokens.generated.ts'

const exportCache = new Map()

/** Every value the generated module exports, read from the TypeScript AST rather than by regex. */
function generatedApiNames(generatedFile) {
    const resolved = path.resolve(generatedFile)

    let stat
    try {
        stat = fs.statSync(resolved)
    } catch {
        return new Set()
    }

    const cached = exportCache.get(resolved)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.names

    const source = ts.createSourceFile(
        resolved,
        fs.readFileSync(resolved, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    )

    const names = new Set()
    for (const statement of source.statements) {
        const exported = ts
            .getModifiers(statement)
            ?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
        if (!exported) continue

        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) names.add(declaration.name.text)
            }
        } else if (ts.isFunctionDeclaration(statement) && statement.name) {
            names.add(statement.name.text)
        }
    }

    exportCache.set(resolved, { mtimeMs: stat.mtimeMs, names })
    return names
}

/**
 * The identifier an Angular expression is rooted in, or null when it is not a simple chain.
 * `semanticColor(segment.color)` roots in `semanticColor`; `a() + b()` roots in nothing.
 */
function rootIdentifier(node) {
    let current = node

    while (current) {
        switch (current.type) {
            case 'ASTWithSource':
                current = current.ast
                break
            case 'Call':
            case 'SafeCall':
                current = current.receiver
                break
            case 'KeyedRead':
            case 'SafeKeyedRead':
                current = current.receiver
                break
            case 'PropertyRead':
            case 'SafePropertyRead': {
                const receiver = current.receiver?.type
                if (receiver === 'ImplicitReceiver' || receiver === 'ThisReceiver') return current.name
                current = current.receiver
                break
            }
            default:
                return null
        }
    }

    return null
}

/** Whether an otherwise unresolvable class expression goes through the generated token API. */
function isTypedTokenApi(node, generatedFile) {
    const root = rootIdentifier(node)
    return root !== null && generatedApiNames(generatedFile).has(root)
}

module.exports = { DEFAULT_GENERATED_TOKEN_API, generatedApiNames, isTypedTokenApi, rootIdentifier }

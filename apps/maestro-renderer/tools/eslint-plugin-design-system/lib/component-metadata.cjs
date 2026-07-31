/**
 * Harvested from the MAE-107 prototype: read the `@Component` decorator with the TypeScript
 * compiler API instead of guessing at it with regexes.
 *
 * The MAE-106 prototype matched `styleUrls?\s*:\s*(…)` in the raw source, which is right for the
 * shapes the renderer happens to use and quietly wrong for the rest — a `styles:` array holding a
 * string that mentions a backtick, a `styleUrl` in a commented-out block, a decorator on a nested
 * class. TypeScript is already a dependency, the parse is cached by mtime, and the result is exact.
 */
const fs = require('node:fs')
const ts = require('typescript')

const DECORATORS = new Set(['Component', 'Directive'])

const metadataCache = new Map()

function stringLiteralValue(node) {
    if (!node) return null
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    return null
}

function stringLiteralValues(node) {
    if (!node) return []
    const single = stringLiteralValue(node)
    if (single !== null) return [single]
    if (!ts.isArrayLiteralExpression(node)) return []
    return node.elements.map(stringLiteralValue).filter(value => value !== null)
}

function propertyValue(metadata, name) {
    for (const property of metadata.properties) {
        if (!ts.isPropertyAssignment(property)) continue
        const key = ts.isStringLiteralLike(property.name)
            ? property.name.text
            : ts.isIdentifier(property.name)
              ? property.name.text
              : null
        if (key === name) return property.initializer
    }
    return null
}

/**
 * @returns {{ styleUrls: string[], inlineStyles: string[], templateUrls: string[] }} the styling
 *   surfaces every `@Component`/`@Directive` in the file declares, paths left relative to the file.
 */
function readComponentMetadata(tsPath) {
    let stat
    try {
        stat = fs.statSync(tsPath)
    } catch {
        return { styleUrls: [], inlineStyles: [], templateUrls: [] }
    }

    const cached = metadataCache.get(tsPath)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.metadata

    const source = ts.createSourceFile(
        tsPath,
        fs.readFileSync(tsPath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    )

    const metadata = { styleUrls: [], inlineStyles: [], templateUrls: [] }

    const visit = node => {
        if (ts.isClassDeclaration(node)) {
            for (const decorator of ts.getDecorators(node) ?? []) {
                const call = decorator.expression
                if (!ts.isCallExpression(call)) continue
                if (!ts.isIdentifier(call.expression) || !DECORATORS.has(call.expression.text)) continue

                const argument = call.arguments[0]
                if (!argument || !ts.isObjectLiteralExpression(argument)) continue

                metadata.styleUrls.push(
                    ...stringLiteralValues(propertyValue(argument, 'styleUrl')),
                    ...stringLiteralValues(propertyValue(argument, 'styleUrls')),
                )
                metadata.inlineStyles.push(...stringLiteralValues(propertyValue(argument, 'styles')))
                metadata.templateUrls.push(...stringLiteralValues(propertyValue(argument, 'templateUrl')))
            }
        }
        ts.forEachChild(node, visit)
    }

    visit(source)

    metadataCache.set(tsPath, { mtimeMs: stat.mtimeMs, metadata })
    return metadata
}

module.exports = { readComponentMetadata }

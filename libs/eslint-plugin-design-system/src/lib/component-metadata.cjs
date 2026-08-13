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

/** @typedef {{ styleUrls: string[], inlineStyles: string[], templateUrls: string[] }} ComponentMetadata */

/** @type {Map<string, { mtimeMs: number, metadata: ComponentMetadata }>} */
const metadataCache = new Map()

/** @type {Map<string, { mtimeMs: number, source: ts.SourceFile }>} */
const sourceCache = new Map()

/**
 * The parsed component file, shared by everything here that needs its AST. One `createSourceFile`
 * per component per lint run: the decorator read and the member resolution in `member-classes.cjs`
 * both want the same tree, and parsing the renderer's largest component twice costs ~17ms for
 * nothing.
 *
 * @param {string} tsPath
 * @returns {ts.SourceFile|null} null when the file cannot be read at all
 */
function componentSourceFile(tsPath) {
    let stat
    try {
        stat = fs.statSync(tsPath)
    } catch {
        return null
    }

    const cached = sourceCache.get(tsPath)
    if (cached && cached.mtimeMs === stat.mtimeMs) return cached.source

    const source = ts.createSourceFile(
        tsPath,
        fs.readFileSync(tsPath, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    )
    sourceCache.set(tsPath, { mtimeMs: stat.mtimeMs, source })
    return source
}

/**
 * The classes in a file that carry `@Component` or `@Directive`. A template resolves against these
 * and nothing else — a plain exported class in the same file is not what the template sees.
 *
 * @param {ts.SourceFile} source
 * @returns {ts.ClassDeclaration[]}
 */
function decoratedClasses(source) {
    /** @type {ts.ClassDeclaration[]} */
    const classes = []

    /** @param {ts.Node} node */
    const visit = node => {
        if (ts.isClassDeclaration(node) && componentDecorators(node).length > 0) classes.push(node)
        ts.forEachChild(node, visit)
    }

    visit(source)
    return classes
}

/**
 * @param {ts.ClassDeclaration} node
 * @returns {ts.ObjectLiteralExpression[]} the metadata object of every `@Component`/`@Directive` on
 *   the class
 */
function componentDecorators(node) {
    /** @type {ts.ObjectLiteralExpression[]} */
    const metadata = []

    for (const decorator of ts.getDecorators(node) ?? []) {
        const call = decorator.expression
        if (!ts.isCallExpression(call)) continue
        if (!ts.isIdentifier(call.expression) || !DECORATORS.has(call.expression.text)) continue

        const argument = call.arguments[0]
        if (argument && ts.isObjectLiteralExpression(argument)) metadata.push(argument)
    }

    return metadata
}

/**
 * @param {ts.Node | undefined} node
 * @returns {string|null}
 */
function stringLiteralValue(node) {
    if (!node) return null
    if (ts.isStringLiteralLike(node)) return node.text
    if (ts.isNoSubstitutionTemplateLiteral(node)) return node.text
    return null
}

/**
 * @param {ts.Node | null | undefined} node
 * @returns {string[]}
 */
function stringLiteralValues(node) {
    if (!node) return []
    const single = stringLiteralValue(node)
    if (single !== null) return [single]
    if (!ts.isArrayLiteralExpression(node)) return []
    return node.elements
        .map(stringLiteralValue)
        .filter(/** @returns {value is string} */ value => value !== null)
}

/**
 * @param {ts.ObjectLiteralExpression} metadata
 * @param {string} name
 * @returns {ts.Expression | null}
 */
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
 * @param {string} tsPath
 * @returns {ComponentMetadata} the styling surfaces every `@Component`/`@Directive` in the file
 *   declares, paths left relative to the file.
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

    const source = componentSourceFile(tsPath)

    /** @type {ComponentMetadata} */
    const metadata = { styleUrls: [], inlineStyles: [], templateUrls: [] }

    for (const declaration of source ? decoratedClasses(source) : []) {
        for (const argument of componentDecorators(declaration)) {
            metadata.styleUrls.push(
                ...stringLiteralValues(propertyValue(argument, 'styleUrl')),
                ...stringLiteralValues(propertyValue(argument, 'styleUrls')),
            )
            metadata.inlineStyles.push(...stringLiteralValues(propertyValue(argument, 'styles')))
            metadata.templateUrls.push(...stringLiteralValues(propertyValue(argument, 'templateUrl')))
        }
    }

    metadataCache.set(tsPath, { mtimeMs: stat.mtimeMs, metadata })
    return metadata
}

module.exports = { componentSourceFile, decoratedClasses, readComponentMetadata }

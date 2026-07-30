/**
 * PROTOTYPE (MAE-107) — standalone Angular/Tailwind class scanner.
 *
 * Answers one question: can a standalone scanner reject class names that neither Tailwind nor the
 * project's own CSS can produce, without maintaining a hand-written allowlist?
 *
 * The authority for "this class exists" is derived, never authored:
 *   1. Tailwind itself — every collected candidate is fed back through Tailwind's JIT compiler and
 *      only the candidates that emit CSS are considered real utilities.
 *   2. Global authored CSS — `src/styles.css` and the generated design-token stylesheet.
 *   3. Component-scoped CSS — the styles a component actually owns, valid only in its own template.
 *
 * Rules reported (see MAE-100's shared corpus):
 *   unknown-class            a class no authority can produce
 *   malformed-descriptor     the `descriptor | styling` convention is used incorrectly
 *   unresolved-class-expression  a class name built at runtime from something untyped
 *   bare-design-token        a design-token custom property used outside `theme(...)`
 *   invalid-suppression      a suppression comment without an explanation
 *
 * See class-scan.NOTES.md for the evaluation notes.
 */

const fs = require('node:fs')
const path = require('node:path')
const postcss = require('postcss')
const selectorParser = require('postcss-selector-parser')
const tailwindcss = require('tailwindcss')
const ts = require('typescript')
const { parseTemplate } = require('@angular/compiler')

const projectRoot = path.resolve(__dirname, '..')
const sourceRoot = path.join(projectRoot, 'src/app')
const tailwindConfigPath = path.join(projectRoot, 'tailwind.config.js')
const generatedTokenApiFile = path.join(sourceRoot, 'shared/design-tokens.generated.ts')

/**
 * The development-only specimen page renders the tokens themselves, so it is allowed to reach for
 * bare custom properties. MAE-100 exempts it together with the generated token infrastructure.
 */
const specimenRoot = path.join(sourceRoot, 'pages/design-system')

const globalStyleFiles = [
    path.join(projectRoot, 'src/styles.css'),
    path.join(projectRoot, 'src/styles/design-tokens.generated.css'),
]

/** Namespaces owned by the generated design-token infrastructure. */
const tokenNamespacePattern = /var\(\s*--(?:color|foundation|type)-[\w-]*/g

/** A suppression must say why it exists; a bare marker is itself a finding. */
const suppressionPattern = /class-scan-disable-next-line\s*:?\s*(.*?)\s*(?:-->|\*\/)?\s*$/

/**
 * Classes Tailwind knows but never emits CSS for, so a round-trip through the compiler cannot prove
 * they exist. Kept deliberately tiny: this is not a design-system allowlist.
 */
const markerClasses = new Set(['group', 'peer', 'dark'])

/** Classes owned by frameworks that ship their own CSS at runtime. */
const externalPrefixes = ['cdk-', 'ng-', 'mat-']

/** Separates semantic descriptors from styling classes: `class="card__header | flex gap-2"`. */
const descriptorSeparator = '|'

const isIgnoredClass = name =>
    markerClasses.has(name) ||
    /^(?:group|peer)\//.test(name) ||
    externalPrefixes.some(prefix => name.startsWith(prefix))

const lineStarts = source => {
    const starts = [0]
    for (let index = 0; index < source.length; index++) {
        if (source[index] === '\n') starts.push(index + 1)
    }
    return starts
}

const positionAt = (starts, offset) => {
    let low = 0
    let high = starts.length - 1
    while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (starts[middle] <= offset) low = middle
        else high = middle - 1
    }
    return { line: low + 1, column: offset - starts[low] + 1 }
}

/**
 * Splits a static class attribute into semantic descriptors (before the pipe) and styling classes,
 * and reports misuse of the convention: more than one separator, an empty descriptor, or more than
 * one descriptor before the pipe.
 */
const splitClassAttribute = value => {
    const pipeIndex = value.indexOf(descriptorSeparator)
    if (pipeIndex === -1) {
        return { descriptors: '', styling: value, descriptorOffset: 0, stylingOffset: 0, problems: [] }
    }

    const descriptors = value.slice(0, pipeIndex)
    const problems = []
    const secondPipe = value.indexOf(descriptorSeparator, pipeIndex + 1)
    if (secondPipe !== -1) {
        problems.push({ offset: secondPipe, message: 'more than one `|` separator' })
    }

    const named = tokenize(descriptors)
    if (named.length === 0) {
        problems.push({ offset: pipeIndex, message: 'empty descriptor before `|`' })
    } else if (named.length > 1) {
        problems.push({
            offset: named[1].offset,
            message: `${named.length} descriptors before \`|\`, expected one`,
        })
    }

    return {
        descriptors,
        styling: value.slice(pipeIndex + 1),
        descriptorOffset: 0,
        stylingOffset: pipeIndex + 1,
        problems,
    }
}

/** Yields `{ name, offset }` for each whitespace-delimited token of a class string. */
const tokenize = (value, baseOffset = 0) => {
    const tokens = []
    const pattern = /\S+/g
    let match
    while ((match = pattern.exec(value)) !== null) {
        tokens.push({ name: match[0], offset: baseOffset + match.index })
    }
    return tokens
}

// --- class sources -------------------------------------------------------------------------------

/**
 * Class names as authored, not as escaped in CSS. Tailwind escapes arbitrary values aggressively
 * (`.bg-\[color-mix\(in_srgb\2c …\)\]`), so the selector parser does the decoding.
 */
const classNamesFromSelector = selector => {
    const names = []
    try {
        selectorParser(root => root.walkClasses(node => names.push(node.value))).processSync(selector)
    } catch {
        return names
    }
    return names
}

/** Every class selector declared by a stylesheet, including inside `@layer` and media queries. */
const declaredClasses = css => {
    const names = new Set()
    postcss.parse(css).walkRules(rule => {
        for (const name of classNamesFromSelector(rule.selector)) names.add(name)
    })
    return names
}

/**
 * Asks Tailwind which of the candidates it can actually build. Candidates are handed to the JIT
 * compiler as raw content in a single pass; whatever comes back as a selector exists.
 */
const resolveTailwindClasses = async candidates => {
    const raw = [...candidates].join(' ')
    if (!raw) return new Set()

    delete require.cache[require.resolve(tailwindConfigPath)]
    const baseConfig = require(tailwindConfigPath)
    const config = {
        ...baseConfig,
        content: [{ raw, extension: 'html' }],
        corePlugins: { ...baseConfig.corePlugins, preflight: false },
    }

    const result = await postcss([tailwindcss(config)]).process(
        '@tailwind components;\n@tailwind utilities;',
        { from: undefined },
    )

    const emitted = new Set()
    result.root.walkRules(rule => {
        for (const name of classNamesFromSelector(rule.selector)) emitted.add(name)
    })
    return emitted
}

// --- template extraction -------------------------------------------------------------------------

/**
 * Turns one authored class string into descriptors and styling classes. Descriptors are exempt from
 * existence checks — they are named by MAE-104's convention, not by Tailwind or the design system —
 * but the convention's own syntax is validated.
 *
 * `trimStart`/`trimEnd` drop the tokens that touch a dynamic fragment in a concatenation —
 * `'badge ' + variant()` proves `badge` but says nothing about what `variant()` appends. A trimmed
 * fragment is only part of a class string, so descriptor syntax is not judged on it.
 */
const classifyLiteral = (raw, base, { trimStart, trimEnd } = {}) => {
    const { descriptors: descriptorPart, styling, stylingOffset, problems } = splitClassAttribute(raw)
    const descriptors = tokenize(descriptorPart, base)
    const classes = tokenize(styling, base + stylingOffset)

    if (trimEnd && !/\s$/.test(raw)) {
        if (classes.length) classes.pop()
        else descriptors.pop()
    }
    if (trimStart && !/^\s/.test(raw)) {
        if (descriptors.length) descriptors.shift()
        else classes.shift()
    }

    const partial = Boolean(trimStart || trimEnd)
    if (partial) return { classes, descriptors, problems: [] }

    const located = problems.map(problem => ({ ...problem, offset: base + problem.offset }))
    // With several separators there is no telling which half is which, so report the syntax error
    // alone rather than cascading a pile of "unknown class" findings out of it.
    const ambiguousSplit = problems.some(problem => problem.message.includes('more than one'))
    return {
        classes: ambiguousSplit ? [] : classes,
        descriptors: ambiguousSplit ? [] : descriptors,
        problems: located,
    }
}

/**
 * Names exported by the generated design-token module. A dynamic class expression that goes through
 * one of these is a legitimate typed token selection, not an unresolvable string build.
 */
let generatedApiNamesCache = null
const generatedApiNames = () => {
    if (generatedApiNamesCache) return generatedApiNamesCache
    generatedApiNamesCache = new Set()
    if (!fs.existsSync(generatedTokenApiFile)) return generatedApiNamesCache

    const source = ts.createSourceFile(
        generatedTokenApiFile,
        fs.readFileSync(generatedTokenApiFile, 'utf8'),
        ts.ScriptTarget.Latest,
        true,
    )
    for (const statement of source.statements) {
        const exported = ts
            .getModifiers(statement)
            ?.some(modifier => modifier.kind === ts.SyntaxKind.ExportKeyword)
        if (!exported) continue
        if (ts.isVariableStatement(statement)) {
            for (const declaration of statement.declarationList.declarations) {
                if (ts.isIdentifier(declaration.name)) generatedApiNamesCache.add(declaration.name.text)
            }
        } else if (ts.isFunctionDeclaration(statement) && statement.name) {
            generatedApiNamesCache.add(statement.name.text)
        }
    }
    return generatedApiNamesCache
}

/** The identifier a call or property read is rooted in, or null when it is not a simple chain. */
const rootIdentifier = ast => {
    let node = ast
    while (node) {
        const kind = node.constructor?.name
        if (kind === 'Call' || kind === 'SafeCall') node = node.receiver
        else if (kind === 'PropertyRead' || kind === 'SafePropertyRead') {
            const receiverKind = node.receiver?.constructor?.name
            if (receiverKind === 'ImplicitReceiver' || receiverKind === 'ThisReceiver') return node.name
            node = node.receiver
        } else if (kind === 'KeyedRead') node = node.receiver
        else return null
    }
    return null
}

/** Dynamic class selection routed through the generated, typed token API is allowed to be opaque. */
const isTypedTokenApi = ast => {
    const root = rootIdentifier(ast)
    return root !== null && generatedApiNames().has(root)
}

/**
 * Walks a binding expression and reports the class tokens it can prove, plus the fragments it
 * cannot. Tokens glued to a dynamic fragment (`'badge ' + variant()`) are dropped rather than
 * guessed at.
 */
const expressionClasses = (ast, base, context = {}) => {
    const found = []
    const descriptors = []
    const unresolved = []
    const problems = []
    const kind = ast?.constructor?.name

    const merge = nested => {
        found.push(...nested.found)
        descriptors.push(...nested.descriptors)
        unresolved.push(...nested.unresolved)
        problems.push(...(nested.problems ?? []))
    }

    if (kind === 'LiteralPrimitive' && typeof ast.value === 'string') {
        const literal = classifyLiteral(ast.value, base + ast.span.start + 1, context)
        found.push(...literal.classes)
        descriptors.push(...literal.descriptors)
        problems.push(...literal.problems)
        return { found, descriptors, unresolved, problems }
    }

    if (kind === 'LiteralMap') {
        for (const key of ast.keys) {
            const literal = classifyLiteral(key.key, base + key.span.start + (key.quoted ? 1 : 0))
            found.push(...literal.classes)
            descriptors.push(...literal.descriptors)
            problems.push(...literal.problems)
        }
        return { found, descriptors, unresolved, problems }
    }

    if (kind === 'LiteralArray') {
        for (const element of ast.expressions) merge(expressionClasses(element, base, {}))
        return { found, descriptors, unresolved, problems }
    }

    if (kind === 'Conditional') {
        for (const branch of [ast.trueExp, ast.falseExp]) merge(expressionClasses(branch, base, {}))
        return { found, descriptors, unresolved, problems }
    }

    if (kind === 'Binary' && ast.operation === '+') {
        merge(expressionClasses(ast.left, base, { ...context, trimEnd: true }))
        merge(expressionClasses(ast.right, base, { ...context, trimStart: true }))
        return { found, descriptors, unresolved, problems }
    }

    if (kind === 'Interpolation') {
        for (let index = 0; index < ast.strings.length; index++) {
            // Interpolated strings carry no per-part offset; anchor everything to the expression.
            const literal = classifyLiteral(ast.strings[index], base + ast.span.start, {
                trimEnd: index < ast.strings.length - 1,
                trimStart: index > 0,
            })
            const anchor = token => ({ ...token, offset: base + ast.span.start })
            found.push(...literal.classes.map(anchor))
            descriptors.push(...literal.descriptors.map(anchor))
        }
        for (const expression of ast.expressions) {
            if (isTypedTokenApi(expression)) continue
            unresolved.push({ offset: base + ast.span.start })
        }
        return { found, descriptors, unresolved, problems }
    }

    if (isTypedTokenApi(ast)) return { found, descriptors, unresolved, problems }

    unresolved.push({ offset: base + (ast?.span?.start ?? 0) })
    return { found, descriptors, unresolved, problems }
}

const walkTemplateNodes = (nodes, visit) => {
    for (const node of nodes ?? []) {
        visit(node)
        for (const key of ['children', 'branches', 'cases', 'groups']) walkTemplateNodes(node[key], visit)
        for (const key of ['empty', 'placeholder', 'loading', 'error']) {
            if (node[key]) walkTemplateNodes([node[key]], visit)
        }
    }
}

/** Attributes whose plain string value is a class list. */
const classAttributes = new Set(['class', 'routerlinkactive'])

/**
 * Collects every class token a template asserts, from static attributes, `[class.foo]`, `[class]`,
 * `[ngClass]` and `[routerLinkActive]`.
 */
const collectTemplateClasses = (template, templateFile) => {
    const parsed = parseTemplate(template, templateFile, { preserveWhitespaces: true })
    const classes = []
    const descriptors = []
    const unresolved = []
    const problems = []

    const visit = node => {
        // Findings anchor on the class token, but a suppression sits above the element that owns it.
        const elementOffset = node.startSourceSpan?.start?.offset ?? node.sourceSpan?.start?.offset

        const pushAttributeValue = (rawValue, valueOffset, origin) => {
            const literal = classifyLiteral(rawValue, valueOffset)
            for (const token of literal.descriptors) descriptors.push({ ...token, origin, elementOffset })
            for (const token of literal.classes) classes.push({ ...token, origin, elementOffset })
            for (const problem of literal.problems) problems.push({ ...problem, origin, elementOffset })
        }

        for (const attribute of node.attributes ?? []) {
            if (!classAttributes.has(attribute.name.toLowerCase())) continue
            const span = attribute.valueSpan ?? attribute.sourceSpan
            pushAttributeValue(attribute.value, span.start.offset, `[static] ${attribute.name}`)
        }

        for (const input of node.inputs ?? []) {
            const source = input.value
            const ast = source?.ast
            if (!ast) continue
            const base = source.sourceSpan.start - ast.span.start

            // `[class.foo]="expr"` — the class name is the binding name itself.
            if (input.type === 2) {
                classes.push({
                    name: input.name,
                    offset: input.sourceSpan.start.offset,
                    origin: '[class.*]',
                    elementOffset,
                })
                continue
            }

            const name = input.name.toLowerCase()
            if (name !== 'class' && name !== 'ngclass' && name !== 'routerlinkactive') continue

            const result = expressionClasses(ast, base, {})
            const origin = `[${input.name}]`
            for (const token of result.found) classes.push({ ...token, origin, elementOffset })
            for (const token of result.descriptors) descriptors.push({ ...token, origin, elementOffset })
            for (const item of result.unresolved) unresolved.push({ ...item, origin, elementOffset })
            for (const problem of result.problems) problems.push({ ...problem, origin, elementOffset })
        }
    }

    walkTemplateNodes(parsed.nodes, visit)

    // `*ngIf` desugars into a template node that carries the element's attributes as well, so the
    // same source position arrives twice.
    const distinct = entries => {
        const seen = new Set()
        return entries.filter(entry => {
            const key = `${entry.offset}:${entry.name ?? entry.message ?? ''}`
            if (seen.has(key)) return false
            seen.add(key)
            return true
        })
    }

    return {
        classes: distinct(classes),
        descriptors: distinct(descriptors),
        unresolved: distinct(unresolved),
        problems: distinct(problems),
        errors: parsed.errors ?? [],
    }
}

// --- component discovery -------------------------------------------------------------------------

const listFiles = (directory, predicate, found = []) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, entry.name)
        if (entry.isDirectory()) listFiles(file, predicate, found)
        else if (predicate(entry.name)) found.push(file)
    }
    return found
}

const stringLiteralValue = node =>
    ts.isStringLiteralLike(node) || ts.isNoSubstitutionTemplateLiteral(node) ? node.text : null

const arrayStringValues = node =>
    ts.isArrayLiteralExpression(node)
        ? node.elements.map(stringLiteralValue).filter(value => value !== null)
        : []

/**
 * Reads the @Component metadata a scanner needs: the template (inline or referenced), the styles the
 * component owns, and host class metadata.
 */
const readComponentUnits = tsFile => {
    const source = ts.createSourceFile(tsFile, fs.readFileSync(tsFile, 'utf8'), ts.ScriptTarget.Latest, true)
    const directory = path.dirname(tsFile)
    const units = []

    const visit = node => {
        if (ts.isClassDeclaration(node)) {
            for (const decorator of ts.getDecorators(node) ?? []) {
                const call = decorator.expression
                if (!ts.isCallExpression(call)) continue
                if (!ts.isIdentifier(call.expression) || call.expression.text !== 'Component') continue

                const metadata = call.arguments[0]
                if (!metadata || !ts.isObjectLiteralExpression(metadata)) continue

                const unit = {
                    tsFile,
                    className: node.name?.text ?? '(anonymous)',
                    template: null,
                    styles: [],
                    hostEntries: [],
                }

                for (const property of metadata.properties) {
                    if (!ts.isPropertyAssignment(property)) continue
                    const key = property.name.getText(source)
                    const value = property.initializer

                    if (key === 'template') {
                        const text = stringLiteralValue(value)
                        if (text !== null) {
                            unit.template = { file: tsFile, source: text, offset: value.getStart() + 1 }
                        }
                    } else if (key === 'templateUrl') {
                        const relative = stringLiteralValue(value)
                        if (relative) {
                            const file = path.resolve(directory, relative)
                            unit.template = { file, source: fs.readFileSync(file, 'utf8'), offset: 0 }
                        }
                    } else if (key === 'styles') {
                        const inline = stringLiteralValue(value)
                        if (inline !== null) {
                            unit.styles.push({ file: tsFile, source: inline, offset: value.getStart() + 1 })
                        }
                        if (ts.isArrayLiteralExpression(value)) {
                            for (const element of value.elements) {
                                const text = stringLiteralValue(element)
                                if (text === null) continue
                                unit.styles.push({
                                    file: tsFile,
                                    source: text,
                                    offset: element.getStart() + 1,
                                })
                            }
                        }
                    } else if (key === 'styleUrl' || key === 'styleUrls') {
                        const single = stringLiteralValue(value)
                        const relatives = single ? [single] : arrayStringValues(value)
                        for (const relative of relatives) {
                            const file = path.resolve(directory, relative)
                            unit.styles.push({ file, source: fs.readFileSync(file, 'utf8'), offset: 0 })
                        }
                    } else if (key === 'host' && ts.isObjectLiteralExpression(value)) {
                        for (const entry of value.properties) {
                            if (!ts.isPropertyAssignment(entry)) continue
                            const entryKey = ts.isStringLiteralLike(entry.name)
                                ? entry.name.text
                                : entry.name.getText(source)
                            unit.hostEntries.push({
                                key: entryKey,
                                value: stringLiteralValue(entry.initializer),
                                offset: entry.initializer.getStart() + 1,
                            })
                        }
                    }
                }

                units.push(unit)
            }
        }
        ts.forEachChild(node, visit)
    }

    visit(source)
    return units
}

/** Host metadata is a class surface too: `host: { class: 'icon | inline-flex' }`. */
const collectHostClasses = unit => {
    const classes = []
    const descriptors = []
    const problems = []

    for (const entry of unit.hostEntries) {
        const bindingMatch = /^\[class\.(.+)]$/.exec(entry.key)
        if (bindingMatch) {
            classes.push({ name: bindingMatch[1], offset: entry.offset, origin: 'host [class.*]' })
            continue
        }
        if (entry.key !== 'class' || entry.value === null) continue

        const literal = classifyLiteral(entry.value, entry.offset)
        for (const token of literal.descriptors) descriptors.push({ ...token, origin: 'host class' })
        for (const token of literal.classes) classes.push({ ...token, origin: 'host class' })
        for (const problem of literal.problems) problems.push({ ...problem, origin: 'host class' })
    }

    return { classes, descriptors, problems }
}

// --- design-token namespace ------------------------------------------------------------------------

/**
 * Bare design-token custom properties bypass the configured Tailwind namespace. Product styling is
 * expected to reach tokens through `theme(...)` (or a generated API), so the token stays a single
 * source of truth. Returns `{ token, offset }` for every bypass in a source string.
 */
const bareTokenReferences = source => {
    const references = []
    tokenNamespacePattern.lastIndex = 0
    let match
    while ((match = tokenNamespacePattern.exec(source)) !== null) {
        references.push({ token: match[0].slice(match[0].indexOf('--')), offset: match.index })
    }
    return references
}

/** Generated infrastructure and the development-only specimen may use bare tokens. */
const isTokenNamespaceExempt = file =>
    /\.generated\.[a-z]+$/.test(file) || file.startsWith(specimenRoot + path.sep)

// --- suppressions ----------------------------------------------------------------------------------

/**
 * A suppression is deliberately narrow: an explained comment that covers the next line only, and by
 * extension the element that starts on it. There is no file-level or glob-level ignore.
 */
const readSuppressions = source => {
    const allowed = new Map()
    const invalid = []
    source.split('\n').forEach((text, index) => {
        const match = suppressionPattern.exec(text)
        if (!match) return
        const reason = match[1].trim()
        if (reason) allowed.set(index + 2, reason)
        else invalid.push({ line: index + 1 })
    })
    return { allowed, invalid }
}

// --- scan ----------------------------------------------------------------------------------------

const editDistance = (a, b) => {
    const previous = Array.from({ length: b.length + 1 }, (_, index) => index)
    for (let i = 1; i <= a.length; i++) {
        let diagonal = previous[0]
        previous[0] = i
        for (let j = 1; j <= b.length; j++) {
            const current = previous[j]
            previous[j] = Math.min(
                previous[j] + 1,
                previous[j - 1] + 1,
                diagonal + (a[i - 1] === b[j - 1] ? 0 : 1),
            )
            diagonal = current
        }
    }
    return previous[b.length]
}

/**
 * The nearest known class name, but only when there is exactly one. An ambiguous tie is worse than
 * silence: the scanner reports, it never guesses at a correction.
 */
const suggest = (name, known) => {
    const limit = Math.min(3, Math.ceil(name.length / 3) + 1)
    let best = null
    let bestDistance = limit
    let ambiguous = false
    for (const candidate of known) {
        const distance = editDistance(name, candidate)
        if (distance >= bestDistance) {
            if (best !== null && distance === bestDistance && candidate !== best) ambiguous = true
            continue
        }
        best = candidate
        bestDistance = distance
        ambiguous = false
    }
    return ambiguous ? null : best
}

const isKnownClass = (name, { tailwindClasses, globalClasses, ownClasses }) =>
    tailwindClasses.has(name) ||
    globalClasses.has(name) ||
    (ownClasses?.has(name) ?? false) ||
    isIgnoredClass(name)

const gatherUnits = () => {
    const tsFiles = listFiles(sourceRoot, name => name.endsWith('.ts') && !name.endsWith('.spec.ts'))
    const units = tsFiles.flatMap(readComponentUnits).filter(unit => unit.template)

    // Templates nobody claims still get scanned, using their sibling stylesheet.
    const claimed = new Set(units.map(unit => unit.template.file))
    for (const html of listFiles(sourceRoot, name => name.endsWith('.html'))) {
        if (claimed.has(html)) continue
        const sibling = html.replace(/\.html$/, '.css')
        units.push({
            tsFile: html,
            className: '(orphan template)',
            template: { file: html, source: fs.readFileSync(html, 'utf8'), offset: 0 },
            styles: fs.existsSync(sibling)
                ? [{ file: sibling, source: fs.readFileSync(sibling, 'utf8'), offset: 0 }]
                : [],
            hostEntries: [],
        })
    }

    return units
}

const scan = async () => {
    const started = process.hrtime.bigint()
    const units = gatherUnits()

    const globalClasses = new Set()
    for (const file of globalStyleFiles) {
        for (const name of declaredClasses(fs.readFileSync(file, 'utf8'))) globalClasses.add(name)
    }

    const findings = []
    const scanned = []
    let descriptorCount = 0
    let checkedCount = 0

    for (const unit of units) {
        const template = collectTemplateClasses(unit.template.source, unit.template.file)
        const host = collectHostClasses(unit)
        const ownClasses = new Set()
        for (const style of unit.styles) {
            for (const name of declaredClasses(style.source)) ownClasses.add(name)
        }

        const inTemplate = entry => ({ ...entry, file: unit.template.file, base: unit.template.offset })
        const inClass = entry => ({ ...entry, file: unit.tsFile, base: 0, elementOffset: undefined })

        const bareTokens = []
        for (const style of unit.styles) {
            if (isTokenNamespaceExempt(style.file)) continue
            for (const reference of bareTokenReferences(style.source)) {
                bareTokens.push({
                    ...reference,
                    file: style.file,
                    base: style.offset,
                    origin: 'component styles',
                })
            }
        }

        scanned.push({
            unit,
            errors: template.errors,
            ownClasses,
            entries: [...template.classes.map(inTemplate), ...host.classes.map(inClass)],
            unresolved: template.unresolved.map(inTemplate),
            problems: [...template.problems.map(inTemplate), ...host.problems.map(inClass)],
            bareTokens,
        })

        descriptorCount += template.descriptors.length + host.descriptors.length
    }

    const candidates = new Set()
    for (const group of scanned) {
        for (const entry of group.entries) candidates.add(entry.name)
    }

    const tailwindClasses = await resolveTailwindClasses(candidates)
    const fileCache = new Map()
    const contextFor = file => {
        if (!fileCache.has(file)) {
            const source = fs.readFileSync(file, 'utf8')
            fileCache.set(file, { starts: lineStarts(source), ...readSuppressions(source) })
        }
        return fileCache.get(file)
    }

    // Every scanned file is read up front so an unexplained suppression is reported even when the
    // file has nothing else wrong with it.
    for (const group of scanned) {
        contextFor(group.unit.template.file)
        contextFor(group.unit.tsFile)
        for (const style of group.unit.styles) contextFor(style.file)
    }

    let suppressedCount = 0
    const report = (entry, finding) => {
        const context = contextFor(entry.file)
        const position = positionAt(context.starts, entry.base + entry.offset)
        const elementLine =
            entry.elementOffset === undefined
                ? position.line
                : positionAt(context.starts, entry.base + entry.elementOffset).line

        if (context.allowed.has(position.line) || context.allowed.has(elementLine)) {
            suppressedCount++
            return
        }

        findings.push({
            file: path.relative(projectRoot, entry.file),
            line: position.line,
            column: position.column,
            origin: entry.origin,
            ...finding,
        })
    }

    for (const group of scanned) {
        for (const entry of group.entries) {
            checkedCount++
            const known = isKnownClass(entry.name, {
                tailwindClasses,
                globalClasses,
                ownClasses: group.ownClasses,
            })
            if (!known) {
                report(entry, {
                    rule: 'unknown-class',
                    className: entry.name,
                    message: `unknown class \`${entry.name}\``,
                    suggestion: suggest(entry.name, [
                        ...tailwindClasses,
                        ...globalClasses,
                        ...group.ownClasses,
                    ]),
                })
            }

            // An arbitrary value is real CSS, so it can smuggle a token past the Tailwind namespace.
            for (const reference of bareTokenReferences(entry.name)) {
                report(entry, {
                    rule: 'bare-design-token',
                    message:
                        `\`${reference.token}\` used bare inside an arbitrary value; ` +
                        'reach the token through the Tailwind theme instead',
                })
            }
        }

        for (const entry of group.problems) {
            report(entry, { rule: 'malformed-descriptor', message: entry.message })
        }

        for (const entry of group.bareTokens) {
            report(entry, {
                rule: 'bare-design-token',
                message:
                    `\`${entry.token}\` used bare in product styles; ` +
                    'consume the token through `theme(...)` instead',
            })
        }

        for (const entry of group.unresolved) {
            report(entry, {
                rule: 'unresolved-class-expression',
                message:
                    'class name is built at runtime and cannot be checked; ' +
                    'use the generated token API or add an explained suppression',
            })
        }
    }

    for (const [file, context] of fileCache) {
        for (const entry of context.invalid) {
            findings.push({
                file: path.relative(projectRoot, file),
                line: entry.line,
                column: 1,
                origin: 'suppression',
                rule: 'invalid-suppression',
                message: 'suppression comment must explain why the check is waived',
            })
        }
    }

    findings.sort(
        (a, b) =>
            a.file.localeCompare(b.file) ||
            a.line - b.line ||
            a.column - b.column ||
            a.rule.localeCompare(b.rule),
    )

    const byRule = {}
    for (const finding of findings) byRule[finding.rule] = (byRule[finding.rule] ?? 0) + 1

    return {
        findings,
        byRule,
        stats: {
            components: units.length,
            classesChecked: checkedCount,
            uniqueClasses: candidates.size,
            descriptorsSkipped: descriptorCount,
            suppressed: suppressedCount,
            tailwindClasses: tailwindClasses.size,
            globalClasses: globalClasses.size,
            durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        },
    }
}

const formatReport = ({ findings, byRule, stats }, { severity } = {}) => {
    const label = severity === 'warn' ? 'warning' : 'error'
    const lines = findings.map(finding => {
        const suggestion = finding.suggestion ? ` (did you mean \`${finding.suggestion}\`?)` : ''
        return (
            `${finding.file}:${finding.line}:${finding.column}  ${label}  ${finding.message}` +
            `${suggestion}  [${finding.rule}${finding.origin ? `, ${finding.origin}` : ''}]`
        )
    })

    const ruleSummary = Object.entries(byRule)
        .map(([rule, count]) => `${count} ${rule}`)
        .join(', ')

    lines.push(
        '',
        `[class-scan] ${stats.components} components, ${stats.classesChecked} class usages ` +
            `(${stats.uniqueClasses} unique), ${stats.descriptorsSkipped} descriptors skipped, ` +
            `${stats.suppressed} suppressed, ` +
            `${findings.length} findings${ruleSummary ? ` (${ruleSummary})` : ''} ` +
            `in ${stats.durationMs.toFixed(0)}ms`,
    )
    return lines.join('\n')
}

if (require.main === module) {
    const args = process.argv.slice(2)
    const command = args[0] ?? 'scan'
    const asJson = args.includes('--json')
    const severityArg = args.find(arg => arg.startsWith('--severity='))
    const severity = severityArg ? severityArg.slice('--severity='.length) : 'error'

    if (command !== 'scan' || !['warn', 'error'].includes(severity)) {
        console.error('Usage: node tools/class-scan.cjs scan [--json] [--severity=warn|error]')
        process.exitCode = 1
    } else {
        scan()
            .then(result => {
                console.log(asJson ? JSON.stringify(result, null, 2) : formatReport(result, { severity }))
                if (result.findings.length && severity === 'error') process.exitCode = 1
            })
            .catch(error => {
                console.error('[class-scan] failed')
                console.error(error)
                process.exitCode = 1
            })
    }
}

module.exports = {
    bareTokenReferences,
    classNamesFromSelector,
    collectHostClasses,
    collectTemplateClasses,
    declaredClasses,
    isIgnoredClass,
    isKnownClass,
    isTokenNamespaceExempt,
    lineStarts,
    positionAt,
    readComponentUnits,
    readSuppressions,
    resolveTailwindClasses,
    scan,
    splitClassAttribute,
    suggest,
}

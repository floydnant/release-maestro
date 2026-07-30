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
const globalStyleFiles = [
    path.join(projectRoot, 'src/styles.css'),
    path.join(projectRoot, 'src/styles/design-tokens.generated.css'),
]

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
 * Splits a static class attribute into semantic descriptors (before the pipe) and styling classes.
 * Descriptors are exempt from existence checks — they are named by MAE-104's convention, not by
 * Tailwind or the design system.
 */
const splitClassAttribute = value => {
    const pipeIndex = value.indexOf(descriptorSeparator)
    if (pipeIndex === -1) return { descriptors: '', styling: value, descriptorOffset: 0, stylingOffset: 0 }
    return {
        descriptors: value.slice(0, pipeIndex),
        styling: value.slice(pipeIndex + 1),
        descriptorOffset: 0,
        stylingOffset: pipeIndex + 1,
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
    delete require.cache[require.resolve(tailwindConfigPath)]
    const baseConfig = require(tailwindConfigPath)
    const config = {
        ...baseConfig,
        content: [{ raw: [...candidates].join(' '), extension: 'html' }],
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
 * Turns one authored class string into descriptors and styling classes. `trimStart`/`trimEnd` drop
 * the tokens that touch a dynamic fragment in a concatenation — `'badge ' + variant()` proves
 * `badge` but says nothing about what `variant()` appends.
 */
const classifyLiteral = (raw, base, { trimStart, trimEnd } = {}) => {
    const { descriptors: descriptorPart, styling, stylingOffset } = splitClassAttribute(raw)
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

    return { classes, descriptors }
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
    const kind = ast?.constructor?.name

    const merge = nested => {
        found.push(...nested.found)
        descriptors.push(...nested.descriptors)
        unresolved.push(...nested.unresolved)
    }

    if (kind === 'LiteralPrimitive' && typeof ast.value === 'string') {
        const literal = classifyLiteral(ast.value, base + ast.span.start + 1, context)
        found.push(...literal.classes)
        descriptors.push(...literal.descriptors)
        return { found, descriptors, unresolved }
    }

    if (kind === 'LiteralMap') {
        for (const key of ast.keys) {
            const literal = classifyLiteral(key.key, base + key.span.start + (key.quoted ? 1 : 0))
            found.push(...literal.classes)
            descriptors.push(...literal.descriptors)
        }
        return { found, descriptors, unresolved }
    }

    if (kind === 'LiteralArray') {
        for (const element of ast.expressions) merge(expressionClasses(element, base, {}))
        return { found, descriptors, unresolved }
    }

    if (kind === 'Conditional') {
        for (const branch of [ast.trueExp, ast.falseExp]) merge(expressionClasses(branch, base, {}))
        return { found, descriptors, unresolved }
    }

    if (kind === 'Binary' && ast.operation === '+') {
        merge(expressionClasses(ast.left, base, { ...context, trimEnd: true }))
        merge(expressionClasses(ast.right, base, { ...context, trimStart: true }))
        return { found, descriptors, unresolved }
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
        unresolved.push({ offset: base + ast.span.start })
        return { found, descriptors, unresolved }
    }

    unresolved.push({ offset: base + (ast?.span?.start ?? 0) })
    return { found, descriptors, unresolved }
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

    const pushAttributeValue = (rawValue, valueOffset, origin) => {
        const literal = classifyLiteral(rawValue, valueOffset)
        for (const token of literal.descriptors) descriptors.push({ ...token, origin })
        for (const token of literal.classes) classes.push({ ...token, origin })
    }

    const visit = node => {
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
                })
                continue
            }

            const name = input.name.toLowerCase()
            if (name !== 'class' && name !== 'ngclass' && name !== 'routerlinkactive') continue

            const result = expressionClasses(ast, base, {})
            for (const token of result.found) classes.push({ ...token, origin: `[${input.name}]` })
            for (const token of result.descriptors) descriptors.push({ ...token, origin: `[${input.name}]` })
            for (const item of result.unresolved) {
                unresolved.push({ ...item, origin: `[${input.name}]` })
            }
        }
    }

    walkTemplateNodes(parsed.nodes, visit)
    return { classes, descriptors, unresolved, errors: parsed.errors ?? [] }
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
                    styleSources: [],
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
                        if (inline !== null) unit.styleSources.push(inline)
                        unit.styleSources.push(...arrayStringValues(value))
                    } else if (key === 'styleUrl' || key === 'styleUrls') {
                        const single = stringLiteralValue(value)
                        const relatives = single ? [single] : arrayStringValues(value)
                        for (const relative of relatives) {
                            unit.styleSources.push(fs.readFileSync(path.resolve(directory, relative), 'utf8'))
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
    }

    return { classes, descriptors }
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

const suggest = (name, known) => {
    let best = null
    let bestDistance = Math.min(3, Math.ceil(name.length / 3) + 1)
    for (const candidate of known) {
        const distance = editDistance(name, candidate)
        if (distance < bestDistance) {
            best = candidate
            bestDistance = distance
        }
    }
    return best
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
            styleSources: fs.existsSync(sibling) ? [fs.readFileSync(sibling, 'utf8')] : [],
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
    const unresolvedBindings = []
    const scanned = []
    let descriptorCount = 0
    let checkedCount = 0

    for (const unit of units) {
        const { classes, descriptors, unresolved, errors } = collectTemplateClasses(
            unit.template.source,
            unit.template.file,
        )
        const host = collectHostClasses(unit)
        const ownClasses = new Set()
        for (const styles of unit.styleSources) {
            for (const name of declaredClasses(styles)) ownClasses.add(name)
        }

        scanned.push({
            unit,
            errors,
            ownClasses,
            entries: [
                ...classes.map(entry => ({ ...entry, file: unit.template.file, base: unit.template.offset })),
                ...host.classes.map(entry => ({ ...entry, file: unit.tsFile, base: 0 })),
            ],
            unresolved: unresolved.map(entry => ({
                ...entry,
                file: unit.template.file,
                base: unit.template.offset,
            })),
        })

        descriptorCount += descriptors.length + host.descriptors.length
    }

    const candidates = new Set()
    for (const group of scanned) {
        for (const entry of group.entries) candidates.add(entry.name)
    }

    const tailwindClasses = await resolveTailwindClasses(candidates)
    const sourceCache = new Map()
    const positionsFor = file => {
        if (!sourceCache.has(file)) sourceCache.set(file, lineStarts(fs.readFileSync(file, 'utf8')))
        return sourceCache.get(file)
    }

    for (const group of scanned) {
        for (const entry of group.entries) {
            checkedCount++
            const known = isKnownClass(entry.name, {
                tailwindClasses,
                globalClasses,
                ownClasses: group.ownClasses,
            })
            if (known) continue

            const position = positionAt(positionsFor(entry.file), entry.base + entry.offset)
            findings.push({
                file: path.relative(projectRoot, entry.file),
                line: position.line,
                column: position.column,
                className: entry.name,
                origin: entry.origin,
                suggestion: suggest(entry.name, [...tailwindClasses, ...globalClasses, ...group.ownClasses]),
            })
        }

        for (const entry of group.unresolved) {
            const position = positionAt(positionsFor(entry.file), entry.base + entry.offset)
            unresolvedBindings.push({
                file: path.relative(projectRoot, entry.file),
                line: position.line,
                column: position.column,
                origin: entry.origin,
            })
        }
    }

    findings.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column)

    return {
        findings,
        unresolvedBindings,
        stats: {
            components: units.length,
            classesChecked: checkedCount,
            uniqueClasses: candidates.size,
            descriptorsSkipped: descriptorCount,
            tailwindClasses: tailwindClasses.size,
            globalClasses: globalClasses.size,
            durationMs: Number(process.hrtime.bigint() - started) / 1e6,
        },
    }
}

const formatReport = ({ findings, unresolvedBindings, stats }, { verbose }) => {
    const lines = []
    for (const finding of findings) {
        const suggestion = finding.suggestion ? ` (did you mean \`${finding.suggestion}\`?)` : ''
        lines.push(
            `${finding.file}:${finding.line}:${finding.column}  unknown class \`${finding.className}\`` +
                `${suggestion}  [${finding.origin}]`,
        )
    }

    if (verbose) {
        for (const binding of unresolvedBindings) {
            lines.push(
                `${binding.file}:${binding.line}:${binding.column}  unresolved dynamic class expression ` +
                    `[${binding.origin}]`,
            )
        }
    }

    lines.push(
        '',
        `[class-scan] ${stats.components} components, ${stats.classesChecked} class usages ` +
            `(${stats.uniqueClasses} unique), ${stats.descriptorsSkipped} descriptors skipped, ` +
            `${unresolvedBindings.length} dynamic expressions unresolved, ` +
            `${findings.length} unknown classes in ${stats.durationMs.toFixed(0)}ms`,
    )
    return lines.join('\n')
}

if (require.main === module) {
    const args = process.argv.slice(2)
    const command = args[0] ?? 'scan'
    const asJson = args.includes('--json')
    const verbose = args.includes('--verbose')

    if (command !== 'scan') {
        console.error('Usage: node tools/class-scan.cjs scan [--json] [--verbose]')
        process.exitCode = 1
    } else {
        scan()
            .then(result => {
                console.log(asJson ? JSON.stringify(result, null, 2) : formatReport(result, { verbose }))
                if (result.findings.length) process.exitCode = 1
            })
            .catch(error => {
                console.error('[class-scan] failed')
                console.error(error)
                process.exitCode = 1
            })
    }
}

module.exports = {
    classNamesFromSelector,
    collectHostClasses,
    collectTemplateClasses,
    declaredClasses,
    isIgnoredClass,
    isKnownClass,
    readComponentUnits,
    resolveTailwindClasses,
    scan,
    splitClassAttribute,
    suggest,
}

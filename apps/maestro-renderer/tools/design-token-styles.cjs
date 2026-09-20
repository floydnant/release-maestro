const postcss = require('postcss')
const valueParser = require('postcss-value-parser')
const ts = require('typescript')

const tokenPrefix = /^--(?:color|foundation|type)-/
const red = message => `\u001B[31m${message}\u001B[39m`

// Read declarations from the expected generated output, never from product CSS overrides.
const tokenPolicy = (css, tailwind) => {
    const tokens = new Set()
    postcss.parse(css).walkDecls(declaration => {
        if (tokenPrefix.test(declaration.prop)) tokens.add(declaration.prop)
    })
    const replacements = new Map()
    const namespaces = {
        colors: 'color',
        spacing: 'spacing',
        borderRadius: 'radius',
        opacity: 'opacity',
        boxShadow: 'shadow',
        transitionDuration: 'duration',
        transitionTimingFunction: 'ease',
    }
    const visit = (value, segments = []) => {
        if (typeof value === 'string') {
            const match = /^var\((--[^)]+)\)$/.exec(value)
            if (match) {
                const [group, ...path] = segments
                const namespace = namespaces[group]
                if (namespace) replacements.set(match[1], `var(--${namespace}-${path.join('-')})`)
            }
        } else if (value && typeof value === 'object') {
            for (const [key, child] of Object.entries(value)) visit(child, [...segments, key])
        }
    }
    visit(tailwind)
    for (const [name, value] of Object.entries(tailwind.fontSize ?? {})) {
        if (!Array.isArray(value)) continue
        const size = /^var\((--[^)]+)\)$/.exec(value[0])?.[1]
        if (size) replacements.set(size, `var(--text-${name})`)
        for (const [property, suffix] of [
            ['lineHeight', 'line-height'],
            ['letterSpacing', 'letter-spacing'],
        ]) {
            const token = /^var\((--[^)]+)\)$/.exec(value[1]?.[property])?.[1]
            if (token) replacements.set(token, `var(--text-${name}--${suffix})`)
        }
    }
    return { tokens, replacements }
}

const allowsBareTokens = file =>
    file === 'src/styles/design-tokens.generated.css' ||
    file === 'src/styles.css' ||
    file.startsWith('src/app/pages/design-system/')

// TypeScript cooks string escapes before Angular sees CSS. Preserve a source offset for every
// cooked UTF-16 code unit so diagnostics still point into the original .ts file.
const literalOffsets = (literal, sourceFile) => {
    const start = literal.getStart(sourceFile) + 1
    const raw = sourceFile.text.slice(start, literal.end - 1)
    const offsets = []
    for (let index = 0; index < raw.length;) {
        const escape = /^(?:\\(?:u\{[\da-fA-F]+\}|u[\da-fA-F]{4}|x[\da-fA-F]{2}|\r\n|[\s\S])|\r\n)/.exec(
            raw.slice(index),
        )?.[0]
        const width = escape?.length ?? 1
        const continuation = escape?.startsWith('\\\n') || escape?.startsWith('\\\r')
        const codePoint = escape?.match(/^\\u\{([\da-fA-F]+)\}$/)
        const cookedWidth = continuation ? 0 : codePoint && parseInt(codePoint[1], 16) > 0xffff ? 2 : 1
        for (let unit = 0; unit < cookedWidth; unit++) offsets.push(start + index)
        index += width
    }
    offsets.push(literal.end - 1)
    return offsets
}

const scanStyleSource = ({ file, source, policy }) => {
    const diagnostics = []
    const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const report = (offset, rule, message) => {
        const { line, character } = sourceFile.getLineAndCharacterOfPosition(offset)
        diagnostics.push({ file, line: line + 1, column: character + 1, rule, message })
    }
    const scanCss = (css, sourceOffset) => {
        let root
        try {
            root = postcss.parse(css, { from: file })
        } catch (error) {
            if (!(error instanceof postcss.CssSyntaxError)) throw error
            const offset = error.input?.offset ?? 0
            report(sourceOffset(offset), 'css-syntax', error.reason)
            return
        }
        const scanValue = (value, offset) => {
            valueParser(value).walk(node => {
                if (node.type !== 'function' || !/^[vV][aA][rR]$/.test(node.value)) return
                const name = node.nodes.find(part => part.type !== 'space' && part.type !== 'comment')
                if (name?.type !== 'word' || !tokenPrefix.test(name.value)) return
                const position = sourceOffset(offset + node.sourceIndex)
                if (!policy.tokens.has(name.value)) {
                    report(
                        position,
                        'unknown-token',
                        `Unknown design token ${name.value}; use a declared token.`,
                    )
                } else if (
                    !allowsBareTokens(file) &&
                    policy.replacements.get(name.value) !== `var(${name.value})`
                ) {
                    const replacement = policy.replacements.get(name.value)
                    report(
                        position,
                        'bare-design-token',
                        replacement
                            ? `Use ${replacement} instead of var(${name.value}).`
                            : `Use a semantic token instead of var(${name.value}).`,
                    )
                }
            })
        }
        root.walkDecls(declaration => {
            const value = declaration.raws.value?.raw ?? declaration.value
            scanValue(
                value,
                declaration.source.start.offset + declaration.prop.length + declaration.raws.between.length,
            )
        })
        root.walkAtRules(rule => {
            scanValue(
                rule.raws.params?.raw ?? rule.params,
                rule.source.start.offset + 1 + rule.name.length + (rule.raws.afterName ?? '').length,
            )
        })
    }
    if (file.endsWith('.css')) {
        scanCss(source, offset => offset)
        return diagnostics
    }

    const componentImports = new Set()
    const namespaces = new Set()
    for (const statement of sourceFile.statements) {
        if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.text !== '@angular/core') continue
        const bindings = statement.importClause?.namedBindings
        if (bindings && ts.isNamedImports(bindings)) {
            for (const binding of bindings.elements) {
                if ((binding.propertyName ?? binding.name).text === 'Component')
                    componentImports.add(binding.name.text)
            }
        } else if (bindings && ts.isNamespaceImport(bindings)) namespaces.add(bindings.name.text)
    }
    const scanLiteral = expression => {
        if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) {
            const offsets = literalOffsets(expression, sourceFile)
            scanCss(expression.text, offset => offsets[offset])
        } else {
            report(
                expression.getStart(sourceFile),
                'dynamic-styles',
                'Use literal component styles so design-tokens-check can validate them.',
            )
        }
    }
    const reportDynamicMetadata = expression =>
        report(
            expression.getStart(sourceFile),
            'dynamic-styles',
            'Use literal component metadata without spreads or dynamic keys so design-tokens-check can validate styles.',
        )
    const visit = node => {
        if (ts.isDecorator(node) && ts.isCallExpression(node.expression)) {
            const call = node.expression
            const callee = call.expression
            const isComponent =
                (ts.isIdentifier(callee) && componentImports.has(callee.text)) ||
                (ts.isPropertyAccessExpression(callee) &&
                    ts.isIdentifier(callee.expression) &&
                    namespaces.has(callee.expression.text) &&
                    callee.name.text === 'Component')
            const metadata = call.arguments[0]
            if (isComponent && metadata && !ts.isObjectLiteralExpression(metadata)) {
                reportDynamicMetadata(metadata)
            } else if (isComponent && metadata) {
                for (const property of metadata.properties) {
                    if (ts.isSpreadAssignment(property)) {
                        reportDynamicMetadata(property)
                        continue
                    }
                    const name = property.name
                    const computed = name && ts.isComputedPropertyName(name)
                    const propertyName = computed ? name.expression : name
                    if (
                        computed &&
                        !ts.isStringLiteralLike(propertyName) &&
                        !ts.isNumericLiteral(propertyName)
                    ) {
                        reportDynamicMetadata(property)
                        continue
                    }
                    if (!propertyName || propertyName.text !== 'styles') continue
                    if (ts.isShorthandPropertyAssignment(property)) {
                        scanLiteral(property.name)
                        continue
                    }
                    if (!ts.isPropertyAssignment(property)) {
                        reportDynamicMetadata(property)
                        continue
                    }
                    if (ts.isArrayLiteralExpression(property.initializer))
                        property.initializer.elements.forEach(scanLiteral)
                    else scanLiteral(property.initializer)
                }
            }
        }
        ts.forEachChild(node, visit)
    }
    visit(sourceFile)
    return diagnostics
}

const reportStyleDiagnostics = (diagnostics, write) => {
    for (const { file, line, column, rule, message } of diagnostics) {
        write(red(`${file}:${line}:${column}: error [${rule}] ${message}`))
    }
    if (diagnostics.length) throw new Error(`${diagnostics.length} stylesheet token violations`)
}

module.exports = { tokenPolicy, scanStyleSource, reportStyleDiagnostics }

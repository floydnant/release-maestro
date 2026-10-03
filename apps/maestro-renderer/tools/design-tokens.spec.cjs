const { checkGenerated, flatten, generate, normalizeLineEndings, resolveValue } = require('./design-tokens.cjs')

const foundations = {
    color: {
        ink: { 100: '#ffffff', 900: '#000000' },
    },
}

it('resolves aliases and emits deterministic output', () => {
    const input = {
        foundations,
        semantic: {
            color: {
                content: { primary: '{color.ink.100}' },
                background: { canvas: '{color.ink.900}' },
            },
            typography: {},
        },
        contrastPairs: [['content.primary', 'background.canvas']],
    }

    expect(generate(input)).toEqual(generate(input))
    expect(generate(input).css).toMatch(/--color-content-primary: var\(--foundation-color-ink-100\)/)
    expect(generate(input).electronTs).toMatch(/nativeWindowBackgroundColor = '#000000'/)
})

it('rejects missing aliases', () => {
    expect(() => resolveValue('{color.ink.500}', foundations)).toThrow(/Missing token/)
})

it('rejects circular aliases', () => {
    const circular = { color: { a: '{color.b}', b: '{color.a}' } }
    expect(() => resolveValue('{color.a}', circular)).toThrow(/Circular token alias/)
})

it('accepts contrast pairs above the project minimum but below WCAG AA', () => {
    expect(() =>
        generate({
            foundations: {
                color: { ink: { 500: '#777777', 900: '#111111' } },
            },
            semantic: {
                color: {
                    content: { muted: '{color.ink.500}' },
                    background: { canvas: '{color.ink.900}' },
                },
                typography: {},
            },
            contrastPairs: [['content.muted', 'background.canvas']],
        }),
    ).not.toThrow()
})

it('rejects contrast pairs below the project minimum', () => {
    expect(() =>
        generate({
            foundations: {
                color: { ink: { 500: '#555555', 900: '#111111' } },
            },
            semantic: {
                color: {
                    content: { muted: '{color.ink.500}' },
                    background: { canvas: '{color.ink.900}' },
                },
                typography: {},
            },
            contrastPairs: [['content.muted', 'background.canvas']],
        }),
    ).toThrow('Project contrast minimum failed for content.muted on background.canvas')
})

it('rejects duplicate flattened paths', () => {
    expect(() => flatten({ primary: '#ffffff' }, ['color'], { 'color.primary': '#000000' })).toThrow(
        /Duplicate token/,
    )
})

it('normalizes Windows line endings for generated file checks', () => {
    expect(normalizeLineEndings('alpha\r\nbeta\r\n')).toBe('alpha\nbeta\n')
})

const fs = require('node:fs')
const path = require('node:path')
const postcss = require('postcss')
const ts = require('typescript')
const vm = require('node:vm')
const { tokenPolicy, scanStyleSource, reportStyleDiagnostics } = require('./design-token-styles.cjs')
const tokenSources = {
    foundations: require('../design-tokens/foundations.json'),
    semantic: require('../design-tokens/semantic.dark.json'),
    contrastPairs: [],
}
const output = generate(tokenSources)
const policy = tokenPolicy(output.css)
const componentFile = 'src/app/example.component.css'
const scan = (source, file = componentFile) => scanStyleSource({ file, source, policy })
const component = styles =>
    `import { Component } from '@angular/core';\n@Component({ styles: ${styles} })\nclass Example {}`

it('generates matching typography declaration, alias, class, and helper names', () => {
    expect(output.css).toContain(
        '--type-body-md-letter-spacing: var(--foundation-typography-letter-spacing-normal)',
    )
    expect(output.css).toContain('--foundation-typography-letter-spacing-normal:')
    expect(scan(output.css, 'src/styles/design-tokens.generated.css')).toEqual([])
})

it('uses the same camelCase normalization in declarations, aliases, Tailwind and generated helpers', () => {
    const generated = generate({
        foundations: {
            color: { deepBlue: '#000000' },
            typography: { fontStretch: { semiExpanded: '112.5%' } },
        },
        semantic: {
            color: { background: { canvas: '{color.deepBlue}' }, focusRing: '{color.deepBlue}' },
            typography: {
                bodyCompact: {
                    family: 'sans-serif',
                    size: '12px',
                    weight: '400',
                    lineHeight: '1.5',
                    letterSpacing: '0',
                },
            },
        },
        contrastPairs: [],
    })
    const exports = {}
    const { outputText } = ts.transpileModule(generated.ts, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    })
    vm.runInNewContext(outputText, { exports })
    expect(generated.css).toContain('--foundation-typography-font-stretch-semi-expanded: 112.5%')
    expect(generated.css).toContain('--color-focus-ring: var(--foundation-color-deep-blue)')
    expect(generated.css).toContain('--color-focus-ring: var(--foundation-color-deep-blue)')
    expect(generated.css).toContain('--type-body-compact-size: 12px')
    expect(generated.css).toContain('font-size: var(--type-body-compact-size)')
    expect(generated.css).toContain('--text-bodyCompact: var(--type-body-compact-size)')
    expect(exports.foundationToken('typography.fontStretch.semiExpanded')).toBe(
        'var(--foundation-typography-font-stretch-semi-expanded)',
    )
    expect(exports.semanticColor('focusRing')).toBe('var(--color-focus-ring)')
})

it.each(['VAR', 'VaR', 'vAr'])('checks %s functions without changing custom-property case', name => {
    const findings = scan(`.x {
    color: ${name}(--color-content-primary);
    background: ${name}(--color-content-Primary);
    border-color: ${name}(--color-missing);
}`)
    expect(findings.map(({ rule }) => rule)).toEqual(['unknown-token', 'unknown-token'])
    expect(findings[0].message).toContain('--color-content-Primary')
})

it('reports every nested token reference with exact positions and concrete replacements', () => {
    expect(
        scan(
            '.x {\n  transition: var(--foundation-motion-duration-fast) var(--foundation-motion-easing-standard);\n}',
        ),
    ).toEqual([
        {
            file: componentFile,
            line: 2,
            column: 15,
            rule: 'bare-design-token',
            message: 'Use var(--duration-fast) instead of var(--foundation-motion-duration-fast).',
        },
        {
            file: componentFile,
            line: 2,
            column: 54,
            rule: 'bare-design-token',
            message: 'Use var(--ease-standard) instead of var(--foundation-motion-easing-standard).',
        },
    ])
    expect(
        scan(
            '.x { color: color-mix(in srgb, var(--local, var(--color-content-primary)) 40%, transparent); }',
        ),
    ).toHaveLength(0)
})

it.each(['--color-nope', '--foundation-nope', '--type-nope'])(
    'reports unknown token %s even with a fallback',
    token => {
        expect(scan(`.x { color: var(${token}, red); }`)).toEqual([
            expect.objectContaining({
                line: 1,
                column: 13,
                rule: 'unknown-token',
                message: `Unknown design token ${token}; use a declared token.`,
            }),
        ])
    },
)

it.each([
    'src/styles.css',
    'src/styles/design-tokens.generated.css',
    'src/app/pages/design-system/design-system.component.css',
])('exempts %s from access policy but checks existence', file => {
    expect(scan('.x { color: var(--color-content-primary); }', file)).toEqual([])
    expect(scan('.x { color: var(--color-missing); }', file)).toEqual([
        expect.objectContaining({ file, line: 1, column: 13, rule: 'unknown-token' }),
    ])
})

it('does not broaden exemptions to similarly named product files', () => {
    for (const file of [
        'src/app/styles.css',
        'src/app/fake.generated.css',
        'src/app/pages/design-system-other/example.css',
    ]) {
        expect(scan('.x { color: var(--foundation-color-neutral-500); }', file)).toHaveLength(1)
    }
})

it('leaves local variables, comments, strings, and Tailwind theme variables untouched', () => {
    expect(
        scan(`/* var(--color-missing) */
.x {
    --progress-color: red;
    color: var(--progress-color);
    content: 'var(--foundation-missing)';
    background: url("data:text/plain,var(--type-missing)");
    transition-duration: var(--duration-fast);
    /* color: var(--color-missing); */
}`),
    ).toEqual([])
})

it('keeps raw comment offsets and scans at-rule parameters', () => {
    const source =
        '.x { color: /* comment */ var(--color-missing); }\n@supports (color: var(--color-missing)) {}'
    expect(scan(source).map(({ line, column }) => ({ line, column }))).toEqual([
        { line: 1, column: 27 },
        { line: 2, column: 19 },
    ])
})

it('requires semantic tokens when a foundation token is not exposed in Tailwind', () => {
    expect(scan('.x { color: var(--foundation-color-neutral-500); }')[0].message).toBe(
        'Use a semantic token instead of var(--foundation-color-neutral-500).',
    )
})

it('suggests Tailwind v4 theme variables', () => {
    expect(policy.replacements.get('--foundation-motion-duration-fast')).toBe('var(--duration-fast)')
    expect(policy.replacements.get('--foundation-motion-easing-standard')).toBe('var(--ease-standard)')
    expect(policy.replacements.get('--color-content-primary')).toBe('var(--color-content-primary)')
})

it('finds scalar, array, aliased, namespace-imported and quoted inline styles', () => {
    const examples = [
        component('`\n.x { color: var(--foundation-color-neutral-500); }\n`'),
        component('[".x { color: var(--foundation-color-neutral-500); }"]'),
        component('".x { color: var(--foundation-color-neutral-500); }"')
            .replace('Component }', 'Component as View }')
            .replace('@Component', '@View'),
        component('".x { color: var(--foundation-color-neutral-500); }"')
            .replace('{ Component }', '* as ng')
            .replace('@Component', '@ng.Component')
            .replace('styles:', "'styles':"),
    ]
    for (const source of examples) {
        const [diagnostic] = scan(source, 'src/app/example.component.ts')
        const before = source.slice(0, source.indexOf('var(')).split('\n')
        expect(diagnostic).toMatchObject({
            line: before.length,
            column: before.at(-1).length + 1,
            rule: 'bare-design-token',
        })
    }
})

it('maps escaped newlines, quotes, unicode and line continuations back to TypeScript source', () => {
    const source = component(
        String.raw`".x {\ncontent: '\u{1f680}\x61\u0062';\ncolor: var(--foundation-color-neutral-500); }"`,
    )
    expect(scan(source, 'src/app/example.component.ts')).toEqual([
        expect.objectContaining({ line: 2, column: source.split('\n')[1].indexOf('var(') + 1 }),
    ])
    const continued = component('".x { \\\ncolor: var(--foundation-color-neutral-500); }"')
    expect(scan(continued, 'src/app/example.component.ts')[0]).toMatchObject({ line: 3, column: 8 })
})

it('reports CRLF inline positions in the original file', () => {
    const source = component('`\n.x {\n  color: var(--color-missing);\n}\n`').replaceAll('\n', '\r\n')
    expect(scan(source, 'src/app/example.component.ts')[0]).toMatchObject({ line: 4, column: 10 })
})

it('ignores unrelated styles properties, comments, templates, and runtime token strings', () => {
    const source = `import { Component } from '@angular/core';
// styles: '.x { color: var(--color-missing); }'
const styles = '.x { color: var(--color-missing); }';
const object = { styles: '.x { color: var(--color-missing); }' };
@Component({ template: '<p>var(--color-missing)</p>' })
class Example { value = 'var(--color-missing)'; }
`
    expect(scan(source, 'src/app/example.component.ts')).toEqual([])
})

it('reports dynamic component styles instead of silently skipping validation', () => {
    expect(scan(component('`a { color: ${color}; }`'), 'src/app/example.component.ts')[0]).toMatchObject({
        rule: 'dynamic-styles',
        line: 2,
        column: 22,
    })
})

it('checks unknown tokens in exempt inline specimen styles', () => {
    expect(
        scan(
            component('`.x { color: var(--color-missing); }`'),
            'src/app/pages/design-system/example.component.ts',
        )[0],
    ).toMatchObject({ rule: 'unknown-token' })
})

it('reports malformed CSS with its source position', () => {
    expect(scan('.x {\n color red;\n}')[0]).toMatchObject({ rule: 'css-syntax', line: 2, column: 2 })
})

it('reports stylesheet findings as errors and fails the check', () => {
    const findings = scan('.x { color: var(--color-missing); }')
    const write = jest.fn()
    expect(() => reportStyleDiagnostics(findings, write)).toThrow('1 stylesheet token violations')
    expect(write).toHaveBeenCalledWith(
        expect.stringContaining(`${componentFile}:1:13: error [unknown-token]`),
    )
    expect(write.mock.calls[0][0]).toMatch(/^\u001B\[31m.*\u001B\[39m$/)
    expect(() => reportStyleDiagnostics([], write)).not.toThrow()
})

it('leaves generated and global style token references resolvable', () => {
    const globalCss = fs.readFileSync(path.join(__dirname, '../src/styles.css'), 'utf8')
    expect(scan(globalCss, 'src/styles.css')).toEqual([])
})

it('preserves at-rule comment positions and recognizes computed inline style keys', () => {
    const source = '@supports (color: /* comment */ var(--color-missing)) {}'
    expect(scan(source)[0]).toMatchObject({ line: 1, column: source.indexOf('var(') + 1 })
    const inline = component('`.x { color: var(--color-missing); }`').replace('styles:', "['styles']:")
    expect(scan(inline, 'src/app/example.component.ts')[0]).toMatchObject({ rule: 'unknown-token' })
})

it('reports shorthand component styles as dynamic', () => {
    const source = component('styles').replace('styles: styles', 'styles')
    expect(scan(source, 'src/app/example.component.ts')[0]).toMatchObject({ rule: 'dynamic-styles' })
})

it.each([
    'metadata',
    'createMetadata()',
    '{ ...metadata }',
    "{ ...{ styles: '.x { color: var(--color-missing); }' } }",
    "{ [styleKey]: '.x { color: var(--color-missing); }' }",
    "{ ['sty' + 'les']: '.x { color: var(--color-missing); }' }",
    "{ get styles() { return '.x { color: var(--color-missing); }'; } }",
])('reports metadata it cannot inspect: %s', metadata => {
    const source = `import { Component } from '@angular/core';\n@Component(${metadata})\nclass Example {}`
    expect(scan(source, 'src/app/example.component.ts')).toEqual([
        expect.objectContaining({
            rule: 'dynamic-styles',
            line: 2,
            column: metadata.startsWith('{') ? 14 : 12,
        }),
    ])
})

it('continues checking literal styles alongside unresolved metadata spreads', () => {
    const source = component('`.x { color: var(--color-missing); }`').replace(
        '{ styles:',
        '{ ...metadata, styles:',
    )
    expect(scan(source, 'src/app/example.component.ts').map(({ rule }) => rule)).toEqual([
        'dynamic-styles',
        'unknown-token',
    ])
})

const { execFileSync } = require('node:child_process')
const stylesheetPath = path.resolve(__dirname, '../src/styles.css')

it('compiles token scales and typography utilities without a compatibility config', () => {
    const css = fs.readFileSync(stylesheetPath, 'utf8')
    expect(css).not.toContain('@config')
    // Tailwind registers Node loader hooks. Run it outside Jest's sandboxed module loader.
    const candidates = [
        'p-1.5', 'bg-background-surface', 'shadow-sm', 'opacity-30', 'opacity-20',
        'duration-fast', 'ease-standard', 'text-body-md', 'type-body-md', 'hover:type-body-md',
        'rounded', 'shadow', 'p-7', 'max-h-72', 'rounded-2xl', 'shadow-xl',
    ]
    const result = JSON.parse(execFileSync(process.execPath, ['-e', `
        const fs = require('node:fs')
        const path = require('node:path')
        const { __unstable__loadDesignSystem, compile } = require('@tailwindcss/node')
        ;(async () => {
            const stylesheet = process.argv[1]
            const names = JSON.parse(process.argv[2])
            const css = fs.readFileSync(stylesheet, 'utf8')
            const options = { base: path.dirname(stylesheet), onDependency() {} }
            const designSystem = await __unstable__loadDesignSystem(css, options)
            const compiler = await compile(css, options)
            const typography = compiler.build([])
            console.log(JSON.stringify({ rules: designSystem.candidatesToCss(names), typography, compiled: compiler.build(names) }))
        })().catch(error => { console.error(error); process.exitCode = 1 })
    `, stylesheetPath, JSON.stringify(candidates)], { encoding: 'utf8' }))
    const rule = name => result.rules[candidates.indexOf(name)]
    expect(rule('p-1.5')).toContain('padding: var(--foundation-spacing-1-5)')
    expect(rule('bg-background-surface')).toContain('background-color: var(--color-background-surface)')
    expect(rule('shadow-sm')).toContain('--tw-shadow: var(--foundation-shadow-sm)')
    expect(rule('opacity-30')).toContain('opacity: var(--foundation-opacity-30)')
    expect(rule('opacity-20')).toContain('opacity: 20%')
    expect(rule('duration-fast')).toContain('transition-duration: var(--foundation-motion-duration-fast)')
    expect(rule('ease-standard')).toContain('var(--ease-standard)')
    expect(rule('text-body-md')).toContain('font-size: var(--type-body-md-size)')
    expect(rule('type-body-md')).toContain('font-weight: var(--type-body-md-weight)')
    expect(rule('hover:type-body-md')).toContain('font-family: var(--type-body-md-family)')
    for (const name of ['rounded', 'shadow', 'p-7', 'max-h-72', 'rounded-2xl', 'shadow-xl']) {
        expect(rule(name)).toBeNull()
    }
    expect(result.compiled).toContain('--duration-fast: var(--foundation-motion-duration-fast)')
    expect(result.compiled).toContain('--spacing-1_5: var(--foundation-spacing-1-5)')
    // The specimen constructs these class names at runtime, so source scanning cannot find them.
    for (const name of Object.keys(tokenSources.semantic.typography)) {
        expect(result.typography).toContain(`.type-${name} {`)
    }
})

it('publishes every source scale and resets only the replaced scales', () => {
    const root = postcss.parse(output.css)
    const theme = new Map()
    root.walkAtRules('theme', rule => rule.walkDecls(declaration => theme.set(declaration.prop, declaration.value)))
    for (const [group, namespace] of [
        ['spacing', 'spacing'], ['radius', 'radius'], ['shadow', 'shadow'], ['opacity', 'opacity'],
    ]) {
        expect(theme.get(`--${namespace}-*`)).toBe('initial')
        for (const name of Object.keys(tokenSources.foundations[group])) {
            expect(theme.get(`--${namespace}-${name.replace(/\./g, '_')}`)).toMatch(/^var\(--foundation-/)
        }
    }
    expect(theme.get('--spacing')).toBe('initial')
    expect(theme.has('--color-*')).toBe(false)
    expect(theme.has('--text-*')).toBe(false)
    for (const name of Object.keys(tokenSources.semantic.typography)) {
        expect(theme.get(`--text-${name}`)).toContain('-size)')
        expect(theme.get(`--text-${name}--line-height`)).toContain('-line-height)')
        expect(theme.get(`--text-${name}--letter-spacing`)).toContain('-letter-spacing)')
        expect(output.css).toContain(`@utility type-${name}`)
    }
})

it('detects stale generated CSS and accepts the current artifacts', () => {
    expect(() => checkGenerated()).not.toThrow()
    const generatedPath = path.resolve(__dirname, '../src/styles/design-tokens.generated.css')
    const read = fs.readFileSync
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation((file, ...args) =>
        file === generatedPath ? '/* stale */' : read(file, ...args),
    )
    try {
        expect(() => checkGenerated()).toThrow('Generated design tokens are stale: src/styles/design-tokens.generated.css')
    } finally {
        spy.mockRestore()
    }
})

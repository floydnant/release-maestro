const { flatten, generate, normalizeLineEndings, resolveValue } = require('./design-tokens.cjs')

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

it('rejects contrast pairs below WCAG AA', () => {
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
    ).toThrow('WCAG AA contrast failed for content.muted on background.canvas')
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
const tailwindcss = require('tailwindcss')
const ts = require('typescript')
const vm = require('node:vm')
const { tokenPolicy, scanStyleSource, reportStyleDiagnostics } = require('./design-token-styles.cjs')
const tokenSources = {
    foundations: require('../design-tokens/foundations.json'),
    semantic: require('../design-tokens/semantic.dark.json'),
    contrastPairs: [],
}
const output = generate(tokenSources)
const policy = tokenPolicy(output.css, JSON.parse(output.tailwind))
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
    expect(JSON.parse(generated.tailwind).colors.focusRing).toBe('var(--color-focus-ring)')
    expect(generated.css).toContain('--type-body-compact-size: 12px')
    expect(generated.css).toContain('font-size: var(--type-body-compact-size)')
    expect(JSON.parse(generated.tailwind).fontSize.bodyCompact[0]).toBe('var(--type-body-compact-size)')
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
    expect(findings.map(({ rule }) => rule)).toEqual(['bare-design-token', 'unknown-token', 'unknown-token'])
    expect(findings[1].message).toContain('--color-content-Primary')
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
            message:
                "Use theme('transitionDuration.fast') instead of var(--foundation-motion-duration-fast).",
        },
        {
            file: componentFile,
            line: 2,
            column: 54,
            rule: 'bare-design-token',
            message:
                "Use theme('transitionTimingFunction.standard') instead of var(--foundation-motion-easing-standard).",
        },
    ])
    expect(
        scan(
            '.x { color: color-mix(in srgb, var(--local, var(--color-content-primary)) 40%, transparent); }',
        ),
    ).toHaveLength(1)
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
        expect(scan('.x { color: var(--color-content-primary); }', file)).toHaveLength(1)
    }
})

it('leaves local variables, comments, strings, and theme access untouched', () => {
    expect(
        scan(`/* var(--color-missing) */
.x {
    --progress-color: red;
    color: var(--progress-color);
    content: 'var(--foundation-missing)';
    background: url("data:text/plain,var(--type-missing)");
    transition-duration: theme('transitionDuration.fast');
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

it('does not invent a theme path for tokens that are not exposed in Tailwind', () => {
    expect(scan('.x { color: var(--foundation-color-neutral-500); }')[0].message).toBe(
        'Expose --foundation-color-neutral-500 in the Tailwind theme, then use theme(...) instead of var(--foundation-color-neutral-500).',
    )
})

it('suggests theme paths that Tailwind can compile', async () => {
    const config = require('../tailwind.config.js')
    const css = [...policy.replacements.values()]
        .map((replacement, index) => `.token-${index} { --value: ${replacement}; }`)
        .join('\n')
    const result = await postcss([tailwindcss({ ...config, content: [{ raw: '<div></div>' }] })]).process(
        css,
        { from: undefined },
    )
    for (const token of policy.replacements.keys()) expect(result.css).toContain(`var(${token})`)
})

it('finds scalar, array, aliased, namespace-imported and quoted inline styles', () => {
    const examples = [
        component('`\n.x { color: var(--color-content-primary); }\n`'),
        component('[".x { color: var(--color-content-primary); }"]'),
        component('".x { color: var(--color-content-primary); }"')
            .replace('Component }', 'Component as View }')
            .replace('@Component', '@View'),
        component('".x { color: var(--color-content-primary); }"')
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
        String.raw`".x {\ncontent: '\u{1f680}\x61\u0062';\ncolor: var(--color-content-primary); }"`,
    )
    expect(scan(source, 'src/app/example.component.ts')).toEqual([
        expect.objectContaining({ line: 2, column: source.split('\n')[1].indexOf('var(') + 1 }),
    ])
    const continued = component('".x { \\\ncolor: var(--color-content-primary); }"')
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

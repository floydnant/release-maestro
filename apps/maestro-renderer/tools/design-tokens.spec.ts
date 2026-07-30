const {
    extractDesignTokenDeclarations,
    flatten,
    generate,
    normalizeLineEndings,
    resolveValue,
    validateDesignTokenReferences,
} = require('./design-tokens.cjs')

const foundations = {
    color: {
        ink: { 100: '#ffffff', 900: '#000000' },
    },
}

test('resolves aliases and emits deterministic output', () => {
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

test('rejects missing aliases', () => {
    expect(() => resolveValue('{color.ink.500}', foundations)).toThrow(/Missing token/)
})

test('rejects circular aliases', () => {
    const circular = { color: { a: '{color.b}', b: '{color.a}' } }
    expect(() => resolveValue('{color.a}', circular)).toThrow(/Circular token alias/)
})

test('rejects duplicate flattened paths', () => {
    expect(() => flatten({ primary: '#ffffff' }, ['color'], { 'color.primary': '#000000' })).toThrow(
        /Duplicate token/,
    )
})

test('normalizes Windows line endings for generated file checks', () => {
    expect(normalizeLineEndings('alpha\r\nbeta\r\n')).toBe('alpha\nbeta\n')
})

test('reports unknown generated design token references with line numbers', () => {
    const declarations = extractDesignTokenDeclarations(`
:root {
    --color-content-primary: #fff;
    --foundation-spacing-3: 0.75rem;
}
`)

    expect(
        validateDesignTokenReferences(
            [
                {
                    filePath: 'src/app/example.component.css',
                    contents: [
                        '.example {',
                        '    color: var(--color-content-priamry);',
                        '    padding: var(--foundation-spacing-3);',
                        '}',
                    ].join('\n'),
                },
            ],
            declarations,
        ),
    ).toEqual([{ filePath: 'src/app/example.component.css', line: 2, token: '--color-content-priamry' }])
})

test('allows component-local custom properties outside generated token namespaces', () => {
    const declarations = extractDesignTokenDeclarations(`
:root {
    --color-content-primary: #fff;
}
`)

    expect(
        validateDesignTokenReferences(
            [
                {
                    filePath: 'src/app/example.component.css',
                    contents: [
                        '.example {',
                        '    --component-gap: 1rem;',
                        '    color: var(--color-content-primary);',
                        '    gap: var(--component-gap);',
                        '}',
                    ].join('\n'),
                },
            ],
            declarations,
        ),
    ).toEqual([])
})

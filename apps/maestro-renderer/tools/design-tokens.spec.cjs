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

it('rejects duplicate flattened paths', () => {
    expect(() => flatten({ primary: '#ffffff' }, ['color'], { 'color.primary': '#000000' })).toThrow(
        /Duplicate token/,
    )
})

it('normalizes Windows line endings for generated file checks', () => {
    expect(normalizeLineEndings('alpha\r\nbeta\r\n')).toBe('alpha\nbeta\n')
})

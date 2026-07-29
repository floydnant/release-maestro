const assert = require('node:assert/strict')
const test = require('node:test')
const {
    findUnknownTokenReferences,
    flatten,
    generate,
    normalizeLineEndings,
    resolveValue,
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

    assert.deepEqual(generate(input), generate(input))
    assert.match(generate(input).css, /--color-content-primary: var\(--foundation-color-ink-100\)/)
    assert.match(generate(input).electronTs, /nativeWindowBackgroundColor = '#000000'/)
})

test('rejects missing aliases', () => {
    assert.throws(() => resolveValue('{color.ink.500}', foundations), /Missing token/)
})

test('rejects circular aliases', () => {
    const circular = { color: { a: '{color.b}', b: '{color.a}' } }
    assert.throws(() => resolveValue('{color.a}', circular), /Circular token alias/)
})

test('rejects duplicate flattened paths', () => {
    assert.throws(
        () => flatten({ primary: '#ffffff' }, ['color'], { 'color.primary': '#000000' }),
        /Duplicate token/,
    )
})

test('normalizes Windows line endings for generated file checks', () => {
    assert.equal(normalizeLineEndings('alpha\r\nbeta\r\n'), 'alpha\nbeta\n')
})

test('reports mistyped design-token custom properties with their line numbers', () => {
    const knownTokens = new Set(['--color-content-primary', '--foundation-spacing-2'])
    const source = `.valid { color: var(--color-content-primary); }
.invalid { padding: var(--foundation-spacing-3); color: var(--color-content-prmary); }`

    assert.deepEqual(findUnknownTokenReferences(source, knownTokens), [
        { line: 2, token: '--foundation-spacing-3' },
        { line: 2, token: '--color-content-prmary' },
    ])
})

test('ignores component-local custom properties', () => {
    assert.deepEqual(findUnknownTokenReferences('color: var(--progress-color);', new Set()), [])
})

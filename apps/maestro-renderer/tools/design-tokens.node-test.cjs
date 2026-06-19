const assert = require('node:assert/strict')
const test = require('node:test')
const { flatten, generate, normalizeLineEndings, resolveValue } = require('./design-tokens.cjs')

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

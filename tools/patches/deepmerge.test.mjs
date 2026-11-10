import { globSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const root = fileURLToPath(new URL('../../', import.meta.url))
const consumers = globSync(
    [
        'node_modules/.pnpm/jest-config@30.5.2*/node_modules/jest-config/package.json',
        'node_modules/.pnpm/fork-ts-checker-webpack-plugin@9.1.0*/node_modules/fork-ts-checker-webpack-plugin/package.json',
    ],
    { cwd: root },
)
if (consumers.length < 2) throw new Error('Expected both deepmerge consumers to be installed')
const entrypoints = [...new Set(consumers.map(path => createRequire(`${root}/${path}`).resolve('deepmerge')))]

const builds = entrypoints.flatMap(entrypoint => [entrypoint, join(dirname(entrypoint), 'umd.js')])

describe.each(builds)('installed deepmerge %s', entrypoint => {
    const merge = require(entrypoint)
    const payload = () => JSON.parse('{"__proto__":{"isAdmin":true},"safe":1}')

    function expectSafe(value) {
        expect(Object.getPrototypeOf(value)).toBe(Object.prototype)
        expect(value.isAdmin).toBeUndefined()
        expect(Object.prototype.isAdmin).toBeUndefined()
    }

    test('source keys cannot poison a result with a null-prototype target', () => {
        const result = merge(Object.create(null), payload())
        expectSafe(result)
        expect(result.safe).toBe(1)
    })

    test('target keys cannot poison the copied result', () => {
        expectSafe(merge(payload(), {}))
    })

    test.each([null, undefined, 1, 'value', false])(
        'nested placeholder %p cannot enable prototype poisoning',
        placeholder => {
            expectSafe(merge({ session: placeholder }, { session: payload() }).session)
        },
    )

    test('ordinary merges, arrays, symbols and custom merge callbacks still work', () => {
        const symbol = Symbol('field')
        expect(
            merge({ nested: { a: 1 }, values: [1] }, { nested: { b: 2 }, values: [2], [symbol]: 3 }),
        ).toEqual({ nested: { a: 1, b: 2 }, values: [1, 2], [symbol]: 3 })
        expect(
            merge(
                { count: 1 },
                { count: {} },
                { customMerge: key => (key === 'count' ? () => 7 : undefined) },
            ),
        ).toEqual({ count: 7 })
    })
})

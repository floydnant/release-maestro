import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../', import.meta.url))
const entries = []
const visited = new Set()

// Follow the installed dependency graph so orphaned pnpm peer variants are excluded.
function visit(manifestPath, isRoot = false) {
    const path = realpathSync(manifestPath)
    if (visited.has(path)) return
    visited.add(path)
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    const fields = [
        'dependencies',
        'optionalDependencies',
        'peerDependencies',
        ...(isRoot ? ['devDependencies'] : []),
    ]
    const dependencies = Object.assign({}, ...fields.map(field => manifest[field]))
    const consumerRequire = createRequire(path)
    if (dependencies.picomatch) {
        entries.push({ consumer: relative(root, path), entry: consumerRequire.resolve('picomatch') })
    }
    for (const name of Object.keys(dependencies)) {
        const dependencyManifest = consumerRequire.resolve
            .paths(name)
            ?.map(directory => join(directory, name, 'package.json'))
            .find(existsSync)
        if (dependencyManifest) visit(dependencyManifest)
    }
}
visit(join(root, 'package.json'), true)
if (entries.length === 0) throw new Error('Expected installed picomatch consumers')
const require = createRequire(import.meta.url)

// Small inputs verify compilation and matching without executing a ReDoS payload.
describe.each(entries)('picomatch through $consumer', ({ entry }) => {
    const builds = [entry, join(dirname(entry), 'posix.js')].filter(existsSync)
    const parse = require(join(dirname(entry), 'lib/parse.js'))
    const patterns = [
        '+(*)',
        '+(*a)',
        '*(*)',
        '*(*a)',
        '+(a*)',
        '+(a*b)',
        '+(**a)',
        '+(**)',
        '*(**)',
        '+(@(*a))',
        '+(a?(*))',
        '*(a?(*))',
        'file+(*a).js',
    ]

    test.each(patterns)('literalizes repeated wildcard %s', pattern => {
        for (const options of [
            {},
            { capture: true },
            { windows: true },
            { maxExtglobRecursion: false },
            { bash: true },
            { fastpaths: false },
        ]) {
            const parsed = parse(pattern, options)
            expect(parsed.output).toContain('\\*')
            for (const build of builds) {
                const picomatch = require(build)
                expect(picomatch.isMatch('aaa', pattern, options)).toBe(false)
                expect(picomatch.isMatch(pattern, pattern, options)).toBe(true)
            }
        }
    })

    test.each(builds)('preserves ordinary globs and safe extglobs through %s', build => {
        const picomatch = require(build)
        expect(picomatch.isMatch('src/example.ts', 'src/**/*.ts')).toBe(true)
        expect(picomatch.isMatch('src/example.js', 'src/**/*.ts')).toBe(false)
        expect(picomatch.isMatch('abab', '+(ab)')).toBe(true)
        expect(picomatch.isMatch('abba', '+(a|b)')).toBe(true)
        expect(picomatch.isMatch('***', '+([*])')).toBe(true)
        expect(picomatch.isMatch('***', '+("*")')).toBe(true)
        expect(picomatch.isMatch('***', '+(\\*)')).toBe(true)
    })
})

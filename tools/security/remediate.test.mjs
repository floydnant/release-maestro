import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from '@jest/globals'
import { parse } from 'yaml'
import { remediationInputs } from '../fixtures/security-remediation.mjs'
import { nodeRuntimeFixture } from '../fixtures/node-runtime.mjs'
import { remediate } from './remediate.mjs'

const lockfile = packages =>
    `lockfileVersion: '9.0'\n\npackages:\n${packages.map(p => `  ${p}: {}\n`).join('')}`
const vulnerable = {
    'parser@1.0.0': 'GHSA-parser',
    'transitive@1.0.0': 'GHSA-transitive',
    'playwright-core@1.64.0-alpha-1789764292000': 'GHSA-playwright',
}
const checkouts = []
afterEach(() => {
    for (const root of checkouts.splice(0)) rmSync(root, { recursive: true, force: true })
})

// A temporary checkout whose scanner reports a finding for each vulnerable lockfile entry.
// Groups run in name order. `update` maps lockfile entries that `pnpm update` replaces; `pnpm install` applies
// overrides. `failUpdate` and `failInstall` give pnpm errors. `failScans` lists the scans (counted from 1)
// that crash.
const checkout = ({
    failScans = [],
    failUpdate,
    failInstall,
    failRegistry = false,
    runtimeUpdate = false,
    failRuntime = false,
    workspace = 'minimumReleaseAge: 4320\n',
    packages = ['parser@1.0.0', 'playwright-core@1.64.0-alpha-1789764292000'],
    update = { 'parser@1.0.0': 'parser@1.1.0' },
} = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-remediate-'))
    checkouts.push(root)
    mkdirSync(join(root, 'dist/security'), { recursive: true })
    const runtime = nodeRuntimeFixture()
    runtime.releases = runtime.releases
        .filter(release => runtimeUpdate || ['v22.23.4', 'v24.22.1'].includes(release.version))
        .map(release => ({ ...release, date: '2026-10-11' }))
    const files = {
        'package.json': JSON.stringify({ engines: { node: runtime.range } }, null, 4) + '\n',
        '.node-version': runtime.pin + '\n',
        'pnpm-workspace.yaml': workspace,
        'pnpm-lock.yaml': lockfile(packages),
    }
    for (const [path, contents] of Object.entries(files)) writeFileSync(join(root, path), contents)
    const rewriteLock = replacements => {
        let lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
        for (const [from, to] of Object.entries(replacements)) lock = lock.replace(`${from}:`, `${to}:`)
        writeFileSync(join(root, 'pnpm-lock.yaml'), lock)
    }
    let scans = 0
    const run = (command, args) => {
        if (command === process.execPath) {
            scans += 1
            if (failScans.includes(scans)) throw new Error('OSV scan failed: exit 2')
            const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
            const findings = Object.entries(vulnerable)
                .filter(([entry]) => lock.includes(`${entry}:`))
                .map(([entry, id]) => {
                    const at = entry.lastIndexOf('@')
                    const [name, version] = [entry.slice(0, at), entry.slice(at + 1)]
                    return { ecosystem: 'npm', name, version, id, status: 'blocked' }
                })
            writeFileSync(join(root, 'dist/security/findings.json'), JSON.stringify(findings))
        }
        if (command === 'pnpm' && args[0] === 'update') {
            rewriteLock(update)
            if (failUpdate) throw new Error(`pnpm failed (1): ${failUpdate}`)
        }
        if (command === 'pnpm' && args[0] === 'install') {
            if (failInstall) throw new Error(`pnpm failed (1): ${failInstall}`)
            const { overrides = {} } = parse(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))
            rewriteLock(
                Object.fromEntries(
                    Object.entries(overrides).map(([from, to]) => [
                        from,
                        `${from.slice(0, from.lastIndexOf('@'))}@${to}`,
                    ]),
                ),
            )
        }
        return ''
    }
    const { advisories, registry, now } = remediationInputs()
    const fetchJson = async url => {
        const { hostname, pathname } = new URL(url)
        if (hostname === 'nodejs.org' || hostname === 'raw.githubusercontent.com') {
            if (failRuntime) throw new Error('Node metadata unavailable')
            return hostname === 'nodejs.org' ? runtime.releases : runtime.schedule
        }
        if (hostname === 'registry.npmjs.org') {
            if (failRegistry) throw new Error('Request failed: 503')
            return registry
        }
        if (pathname.startsWith('/v1/vulns/')) return advisories[0]
        return { vulns: [] }
    }
    const report = () => readFileSync(join(root, 'dist/security/remediation-pr.md'), 'utf8')
    const assertInputsRestored = () => {
        for (const [path, contents] of Object.entries(files))
            assert.equal(readFileSync(join(root, path), 'utf8'), contents, path)
    }
    return { root, report, assertInputsRestored, options: { root, run, fetchJson, now, log: () => {} } }
}
const byName = report => Object.fromEntries(report.packages.map(item => [item.name, item]))
const reportFiles = ['remediation.json', 'remediation-pr.md', 'findings.json', 'osv.json']

test.each([
    ['missing', null],
    ['invalid', 'invalid JSON'],
    ['non-array', '{}'],
])(
    'a scanner report that is %s includes the command stdout and stderr in the failure',
    async (_reportState, contents) => {
        const { root, options, assertInputsRestored } = checkout()
        writeFileSync(join(root, 'Makefile'), 'dependency-policy-check:\n')
        mkdirSync(join(root, 'tools/security'), { recursive: true })
        const writeReport =
            contents === null
                ? ''
                : `writeFileSync('dist/security/findings.json', ${JSON.stringify(contents)})`
        writeFileSync(
            join(root, 'tools/security/cli.mjs'),
            `import { writeFileSync } from 'node:fs'
${writeReport}
console.log('Scanner diagnostic on stdout')
console.error('Scanner connection failed on stderr')
process.exitCode = 1
`,
        )
        for (const args of [
            ['init', '--quiet'],
            ['add', '--', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.node-version'],
            [
                '-c',
                'user.name=Test',
                '-c',
                'user.email=test@example.com',
                '-c',
                'commit.gpgSign=false',
                'commit',
                '--quiet',
                '-m',
                'fixture',
            ],
        ]) {
            const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
            assert.equal(result.status, 0, result.stderr)
        }

        await assert.rejects(remediate('apply', { ...options, run: undefined }), error => {
            assert.match(error.message, /Scanner diagnostic on stdout/)
            assert.match(error.message, /Scanner connection failed on stderr/)
            return true
        })
        assertInputsRestored()
    },
)

test.each(['preflight', 'baseline'])(
    'a %s failure cannot leave reports from an earlier successful run',
    async failure => {
        const { root, options } = checkout({ failScans: failure === 'baseline' ? [1] : [] })
        for (const file of reportFiles)
            writeFileSync(join(root, 'dist/security', file), 'Old report describing verified fixes')
        const run = options.run
        options.run = (command, ...args) => {
            if (failure === 'preflight' && command === 'make') throw new Error('Preflight failed')
            return run(command, ...args)
        }

        await assert.rejects(remediate('apply', options), /Preflight failed|OSV scan failed/)
        for (const file of reportFiles) assert(!existsSync(join(root, 'dist/security', file)), file)
    },
)

test('an installed prerelease stays unresolved without blocking a stable fix or its reports', async () => {
    const { options, report } = checkout()
    const packages = byName(await remediate('apply', options))
    assert.equal(packages.parser.status, 'fixed')
    assert.deepEqual(packages.parser.resolvedVersions, ['1.1.0'])
    assert.equal(packages['playwright-core'].status, 'unresolved')
    assert.match(packages['playwright-core'].reason, /prerelease 1\.64\.0-alpha/)
    assert.match(report(), /playwright-core/)
})

test('a final scanner failure restores every dependency input after an applied fix', async () => {
    // Scans: initial, after the update, then the final verification.
    const { root, assertInputsRestored, options } = checkout({ failScans: [3] })
    await assert.rejects(remediate('apply', options), /OSV scan failed.*restored/)
    assertInputsRestored()
    for (const file of reportFiles) assert(!existsSync(join(root, 'dist/security', file)), file)
})

test.each(['remediation.json', 'remediation-pr.md'])(
    'a %s write failure restores every dependency input after a verified override',
    async filename => {
        const { root, assertInputsRestored, options } = checkout({ update: {} })
        const run = options.run
        options.run = (command, args, ...rest) => {
            const output = run(command, args, ...rest)
            // Obstruct report writing after the override changes the inputs. Cleanup can unlink this
            // junction without touching its target, including on Windows.
            if (command === 'pnpm' && args[0] === 'install')
                symlinkSync(root, join(root, 'dist/security', filename), 'junction')
            return output
        }
        await assert.rejects(remediate('apply', options), { code: 'EISDIR' })
        assertInputsRestored()
        for (const file of reportFiles) assert(!existsSync(join(root, 'dist/security', file)), file)

        options.run = run
        assert.equal(byName(await remediate('apply', options)).parser.status, 'fixed')
    },
)

test('an update to a version the planner did not vet falls back to the vetted override', async () => {
    const { options } = checkout({ update: { 'parser@1.0.0': 'parser@1.3.0' } })
    const { parser } = byName(await remediate('apply', options))
    assert.equal(parser.method, 'scoped override')
    assert.deepEqual(parser.resolvedVersions, ['1.1.0'])
})

test('a finding that an earlier fix already removed is not attempted again', async () => {
    const { options } = checkout({
        packages: ['parser@1.0.0', 'transitive@1.0.0'],
        update: { 'parser@1.0.0': 'parser@1.1.0', 'transitive@1.0.0': 'transitive@1.1.0' },
    })
    const { transitive } = byName(await remediate('apply', options))
    assert.equal(transitive.status, 'fixed')
    assert.equal(transitive.method, 'earlier fix in this run')
})

test('a failed lookup is reported as a failure, not a missing fix', async () => {
    const { options, report } = checkout({ failRegistry: true })
    const { parser } = byName(await remediate('plan', options))
    assert.equal(parser.status, 'failed')
    assert.match(report(), /## Unresolved findings\n\n- `parser`: Request failed: 503/)
})

test('an update to another eligible version than the target falls back to the vetted override', async () => {
    // 1.1.1 is eligible, but only the 1.1.0 target passed the per-version OSV check.
    const { options } = checkout({ update: { 'parser@1.0.0': 'parser@1.1.1' } })
    const { parser } = byName(await remediate('apply', options))
    assert.equal(parser.method, 'scoped override')
    assert.deepEqual(parser.resolvedVersions, ['1.1.0'])
})

test('a pnpm network error during an attempt fails the package so the publisher keeps the branch', async () => {
    const { assertInputsRestored, options } = checkout({ update: {}, failInstall: 'ERR_PNPM_FETCH_503' })
    const { parser } = byName(await remediate('apply', options))
    assert.equal(parser.status, 'failed')
    assert.match(parser.reason, /ERR_PNPM_FETCH_503/)
    assertInputsRestored()
})

test('a scanner crash during an attempt fails the package instead of rejecting the candidate', async () => {
    // One scanner crash must stop the attempt even when a fallback scan would succeed.
    const { assertInputsRestored, options } = checkout({ failScans: [2] })
    const { parser } = byName(await remediate('apply', options))
    assert.equal(parser.status, 'failed')
    assert.match(parser.reason, /OSV scan failed/)
    assertInputsRestored()
})

test('a targeted update network error fails the package without attempting an override', async () => {
    const { assertInputsRestored, options } = checkout({ failUpdate: 'ERR_PNPM_FETCH_503' })
    const { parser } = byName(await remediate('apply', options))
    assert.equal(parser.status, 'failed')
    assert.match(parser.reason, /ERR_PNPM_FETCH_503/)
    assertInputsRestored()
})

test('a targeted update policy refusal can still use a verified override', async () => {
    const { options } = checkout({ failUpdate: 'ERR_PNPM_TRUST_DOWNGRADE' })
    const { parser } = byName(await remediate('apply', options))
    assert.equal(parser.status, 'fixed')
    assert.equal(parser.method, 'scoped override')
    assert.deepEqual(parser.resolvedVersions, ['1.1.0'])
})

test('a pnpm policy refusal rejects the candidate and leaves the package unresolved', async () => {
    const { options } = checkout({ update: {}, failInstall: 'ERR_PNPM_TRUST_DOWNGRADE' })
    const { parser } = byName(await remediate('apply', options))
    assert.equal(parser.status, 'unresolved')
    assert.match(parser.reason, /ERR_PNPM_TRUST_DOWNGRADE/)
})

test('a missing minimum release age stops the run before any package is attempted', async () => {
    const { options } = checkout({ workspace: 'overrides: {}\n' })
    await assert.rejects(remediate('plan', options), /minimumReleaseAge/)
})

test('one apply run combines npm fixes and runtime changes in the existing report', async () => {
    const { root, options, report } = checkout({ runtimeUpdate: true })
    const result = byName(await remediate('apply', options))
    assert.equal(result.parser.status, 'fixed')
    assert.equal(result['Node.js 24'].status, 'fixed')
    assert.equal(readFileSync(join(root, '.node-version'), 'utf8'), '24.23.0\n')
    assert.match(report(), /parser/)
    assert.match(report(), /Node.js 24.*24.23.0/)
    const retry = byName(await remediate('apply', options))
    assert.equal(retry['Node.js 24'].status, 'current')
})

test('combined preview leaves npm and runtime inputs unchanged', async () => {
    const { options, assertInputsRestored } = checkout({ runtimeUpdate: true })
    const result = byName(await remediate('plan', options))
    assert.equal(result.parser.status, 'planned')
    assert.equal(result['Node.js 24'].status, 'planned')
    assertInputsRestored()
})

test('runtime lookup failure preserves npm fixes and records an unknown outcome', async () => {
    const { root, options } = checkout({ failRuntime: true })
    const result = byName(await remediate('apply', options))
    assert.equal(result.parser.status, 'fixed')
    assert.equal(result['Node.js runtime'].status, 'failed')
    assert.equal(readFileSync(join(root, '.node-version'), 'utf8'), '24.22.1\n')
})

test('report failure rolls back npm fixes and a changed runtime pin together', async () => {
    const { root, options, assertInputsRestored } = checkout({ runtimeUpdate: true })
    const run = options.run
    options.run = (command, args, ...rest) => {
        const output = run(command, args, ...rest)
        if (command === 'make' && readFileSync(join(root, '.node-version'), 'utf8') === '24.23.0\n')
            symlinkSync(root, join(root, 'dist/security/remediation.json'), 'junction')
        return output
    }
    await assert.rejects(remediate('apply', options), { code: 'EISDIR' })
    assertInputsRestored()
})

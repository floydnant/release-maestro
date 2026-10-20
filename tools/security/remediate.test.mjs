import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from '@jest/globals'
import { parse } from 'yaml'
import { remediationInputs } from '../fixtures/security-remediation.mjs'
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
    workspace = 'minimumReleaseAge: 4320\n',
    packages = ['parser@1.0.0', 'playwright-core@1.64.0-alpha-1789764292000'],
    update = { 'parser@1.0.0': 'parser@1.1.0' },
} = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-remediate-'))
    checkouts.push(root)
    mkdirSync(join(root, 'dist/security'), { recursive: true })
    const files = {
        'package.json': '{}\n',
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
    const { assertInputsRestored, options } = checkout({ failScans: [3] })
    await assert.rejects(remediate('apply', options), /OSV scan failed.*restored/)
    assertInputsRestored()
})

test.each(['remediation.json', 'remediation-pr.md'])(
    'a %s write failure restores every dependency input after a verified override',
    async filename => {
        const { root, assertInputsRestored, options } = checkout({ update: {} })
        mkdirSync(join(root, 'dist/security', filename))
        await assert.rejects(remediate('apply', options), { code: 'EISDIR' })
        assertInputsRestored()
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

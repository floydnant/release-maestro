import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from '@jest/globals'
import { remediationInputs } from '../fixtures/security-remediation.mjs'
import { remediate } from './remediate.mjs'

const lockfile = packages =>
    `lockfileVersion: '9.0'\n\npackages:\n${packages.map(p => `  ${p}: {}\n`).join('')}`
const vulnerable = {
    'parser@1.0.0': 'GHSA-parser',
    'playwright-core@1.64.0-alpha-1789764292000': 'GHSA-playwright',
}
const checkouts = []
afterEach(() => {
    for (const root of checkouts.splice(0)) rmSync(root, { recursive: true, force: true })
})

// A temporary checkout whose scanner reports a finding for each vulnerable lockfile entry.
const checkout = ({ failScan } = {}) => {
    const root = mkdtempSync(join(tmpdir(), 'maestro-remediate-'))
    checkouts.push(root)
    mkdirSync(join(root, 'dist/security'), { recursive: true })
    const files = {
        'package.json': '{}\n',
        'pnpm-workspace.yaml': 'minimumReleaseAge: 4320\n',
        'pnpm-lock.yaml': lockfile(Object.keys(vulnerable)),
    }
    for (const [path, contents] of Object.entries(files)) writeFileSync(join(root, path), contents)
    let scans = 0
    const run = (command, args) => {
        if (command === process.execPath) {
            scans += 1
            if (scans === failScan) throw new Error('OSV scan failed: exit 2')
            const lock = readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')
            const findings = Object.entries(vulnerable)
                .filter(([entry]) => lock.includes(entry))
                .map(([entry, id]) => {
                    const at = entry.lastIndexOf('@')
                    const [name, version] = [entry.slice(0, at), entry.slice(at + 1)]
                    return { ecosystem: 'npm', name, version, id, status: 'blocked' }
                })
            writeFileSync(join(root, 'dist/security/findings.json'), JSON.stringify(findings))
        }
        if (command === 'pnpm' && args[0] === 'update')
            writeFileSync(
                join(root, 'pnpm-lock.yaml'),
                readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8').replace('parser@1.0.0', 'parser@1.1.0'),
            )
        return ''
    }
    const { advisories, registry, now } = remediationInputs()
    const fetchJson = async url => {
        if (url.includes('/v1/vulns/')) return advisories[0]
        if (url.includes('registry.npmjs.org')) return registry
        return { vulns: [] }
    }
    return { root, files, options: { root, run, fetchJson, now, log: () => {} } }
}

test('an installed prerelease stays unresolved without blocking a stable fix or its reports', async () => {
    const { root, options } = checkout()
    const report = await remediate('apply', options)
    const byName = Object.fromEntries(report.packages.map(item => [item.name, item]))
    assert.equal(byName.parser.status, 'fixed')
    assert.deepEqual(byName.parser.resolvedVersions, ['1.1.0'])
    assert.equal(byName['playwright-core'].status, 'unresolved')
    assert.match(byName['playwright-core'].reason, /prerelease 1\.64\.0-alpha/)
    assert.match(readFileSync(join(root, 'dist/security/remediation-pr.md'), 'utf8'), /playwright-core/)
})

test('a final scanner failure restores every dependency input after an applied fix', async () => {
    // Scans: initial, after the update, then the final verification.
    const { root, files, options } = checkout({ failScan: 3 })
    await assert.rejects(remediate('apply', options), /OSV scan failed.*restored/)
    for (const [path, contents] of Object.entries(files))
        assert.equal(readFileSync(join(root, path), 'utf8'), contents)
})

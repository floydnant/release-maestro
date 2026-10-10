import assert from 'node:assert/strict'
import { test } from '@jest/globals'
import { verifyDownload, sha256 } from './install.mjs'
import { evaluateScan, validateExceptions } from './policy.mjs'
import { cargoRuntimePackages, npmRuntimePackages, scopeSbom } from './sbom.mjs'

const now = new Date('2026-10-03T12:00:00Z')
const exception = {
    ecosystem: 'npm',
    name: 'client',
    version: '1.0.0',
    id: 'GHSA-existing',
    expires: '2026-11-02',
    reason: 'Waiting for the upstream fix.',
}
const report = vulnerabilities => ({
    results: [
        {
            source: { path: '/repo/pnpm-lock.yaml' },
            packages: [{ package: { ecosystem: 'npm', name: 'client', version: '1.0.0' }, vulnerabilities }],
        },
        {
            source: { path: '/repo/apps/metadata-engine/Cargo.lock' },
            packages: [{ package: { ecosystem: 'crates.io', name: 'parser', version: '1.0.0' } }],
        },
    ],
})

test('accepts an exact finding while blocking new advisories and package versions', () => {
    const findings = evaluateScan(report([{ id: 'GHSA-existing' }, { id: 'GHSA-new' }]), [exception], now)
    assert.deepEqual(
        findings.map(finding => finding.status),
        ['accepted', 'blocked'],
    )
    const updated = report([{ id: 'GHSA-existing' }])
    updated.results[0].packages[0].package.version = '1.0.1'
    assert.equal(evaluateScan(updated, [exception], now)[0].status, 'blocked')
})

test('rejects missing scan coverage, including a successful scan with no packages', () => {
    const incomplete = report([])
    incomplete.results[1].packages = []
    assert.throws(() => evaluateScan(incomplete, [], now), /Cargo.lock/)
    assert.throws(() => evaluateScan({ results: [] }, [], now), /pnpm-lock.yaml/)
    assert.throws(() => evaluateScan({}, [], now), /missing results/)
})

test('treats maintenance notices as informational but blocks unsoundness and unscored security advisories', () => {
    const vulnerabilities = ['unmaintained', 'unsound', undefined].map((informational, index) => ({
        id: `RUSTSEC-${index}`,
        affected: [{ database_specific: { informational } }],
    }))
    assert.deepEqual(
        evaluateScan(report(vulnerabilities), [], now).map(finding => finding.status),
        ['informational', 'blocked', 'blocked'],
    )
    vulnerabilities[0].aliases = ['CVE-2026-1234']
    assert.equal(evaluateScan(report(vulnerabilities), [], now)[0].status, 'blocked')
})

test('rejects invalid, incomplete, and duplicate exceptions', () => {
    for (const expires of ['2026-02-30', '', 'tomorrow']) {
        assert.throws(() => validateExceptions([{ ...exception, expires }]))
    }
    assert.throws(() => validateExceptions([{ ...exception, reason: '' }]), /reason/)
    assert.throws(() => validateExceptions([exception, exception]), /Duplicate/)
})

test('expiry blocks the matching vulnerability at midnight UTC, while resolved findings stay clean', () => {
    const expires = new Date('2026-11-02T00:00:00Z')
    assert.doesNotThrow(() => validateExceptions([exception]))
    assert.equal(
        evaluateScan(report([{ id: exception.id }]), [exception], new Date(expires.getTime() - 1))[0].status,
        'accepted',
    )
    assert.equal(evaluateScan(report([{ id: exception.id }]), [exception], expires)[0].status, 'blocked')
    assert.deepEqual(evaluateScan(report([]), [exception], expires), [])
})

test('rejects corrupted tool downloads and cached bytes', () => {
    const bytes = Buffer.from('reviewed release executable')
    assert.doesNotThrow(() => verifyDownload(bytes, sha256(bytes)))
    assert.throws(() => verifyDownload(Buffer.from('modified'), sha256(bytes)), /checksum mismatch/)
})

test('follows peer-qualified snapshots, optional dependencies, shared dependencies, and multiple pnpm documents', () => {
    const documents = [
        { packages: { 'pnpm@12.8.1': {} }, importers: { '.': { packageManagerDependencies: {} } } },
        {
            importers: {
                '.': {
                    dependencies: { app: { version: '1.0.0(peer@2.0.0)' } },
                    devDependencies: { test: { version: '1.0.0' }, translations: { version: '1.0.0' } },
                },
            },
            snapshots: {
                'app@1.0.0(peer@2.0.0)': {
                    dependencies: { shared: '2.0.0' },
                    optionalDependencies: { native: '1.0.0' },
                },
                'shared@2.0.0': { dependencies: { app: '1.0.0(peer@2.0.0)' } },
                'native@1.0.0': {},
                'translations@1.0.0': {},
                'test@1.0.0': {},
            },
        },
    ]
    assert.deepEqual([...npmRuntimePackages(documents, ['translations'])].sort(), [
        'app@1.0.0',
        'native@1.0.0',
        'shared@2.0.0',
        'translations@1.0.0',
    ])
    assert.throws(() => npmRuntimePackages(documents, ['missing']), /Missing runtime/)
    delete documents[1].snapshots['native@1.0.0']
    assert.throws(() => npmRuntimePackages(documents), /Missing pnpm snapshot/)
})

test('excludes Rust test and build dependencies while retaining shared normal dependencies', () => {
    const edge = (pkg, kind) => ({ pkg, dep_kinds: [{ kind }] })
    const metadata = {
        packages: ['engine', 'parser', 'shared', 'fixture', 'macro'].map(name => ({
            id: name,
            name,
            version: '1.0.0',
        })),
        resolve: {
            root: 'engine',
            nodes: [
                {
                    id: 'engine',
                    deps: [edge('parser', null), edge('fixture', 'dev'), edge('macro', 'build')],
                },
                { id: 'parser', deps: [edge('shared', null)] },
                { id: 'shared', deps: [] },
            ],
        },
    }
    assert.deepEqual([...cargoRuntimePackages(metadata)].sort(), [
        'engine@1.0.0',
        'parser@1.0.0',
        'shared@1.0.0',
    ])
})

test('includes Electron as runtime and removes references to development components', () => {
    const component = (name, purl) => ({ name, version: '1.0.0', purl, 'bom-ref': name })
    const bom = {
        metadata: { component: { 'bom-ref': 'root' } },
        components: [
            component('app', 'pkg:npm/app@1.0.0'),
            component('electron', 'pkg:npm/electron@1.0.0'),
            component('test', 'pkg:npm/test@1.0.0'),
            component('parser', 'pkg:cargo/parser@1.0.0'),
        ],
        dependencies: [
            { ref: 'root', dependsOn: ['app', 'test'] },
            { ref: 'app', dependsOn: ['test'] },
            { ref: 'test', dependsOn: [] },
        ],
    }
    const { repository, runtime } = scopeSbom(bom, new Set(['app@1.0.0']), new Set(['parser@1.0.0']), '1.0.0')
    assert.equal(
        repository.components.find(item => item.name === 'test').properties.at(-1).value,
        'development',
    )
    assert.deepEqual(
        runtime.components.map(item => item.name),
        ['app', 'electron', 'parser'],
    )
    assert.deepEqual(runtime.dependencies, [
        { ref: 'root', dependsOn: ['app'] },
        { ref: 'app', dependsOn: [] },
    ])
})

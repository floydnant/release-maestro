import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@jest/globals'
import { sha256 } from './install.mjs'
import { verifyPatchExceptions } from './patch-exceptions.mjs'
import { validateExceptions, evaluateScan } from './policy.mjs'

const patch = 'reviewed patch bytes'
const digest = sha256(patch)
const exception = {
    ecosystem: 'npm',
    name: 'client',
    version: '1.0.0',
    id: 'GHSA-existing',
    reason: 'Reviewed local patch pending upstream release.',
    reviewed: '2026-11-10',
    expires: '2026-11-24',
    patch: {
        path: 'patches/client.patch',
        sha256: digest,
        since: '2026-11-10',
        advisoryModified: '2026-10-27T21:45:04.256048049Z',
        tests: ['tools/security-patches/client.test.mjs'],
    },
}
const modified = exception.patch.advisoryModified

function withRepository(change, check) {
    const root = mkdtempSync(join(tmpdir(), 'patch-exception-'))
    const workspace = { patchedDependencies: { 'client@1.0.0': 'patches/client.patch' } }
    const lock = {
        patchedDependencies: { 'client@1.0.0': digest },
        snapshots: { [`client@1.0.0(patch_hash=${digest})`]: {} },
    }
    const state = { patch, workspace, lock, files: { 'tools/security-patches/client.test.mjs': 'test' } }
    try {
        change(state)
        mkdirSync(join(root, 'patches'))
        mkdirSync(join(root, 'tools/security-patches'), { recursive: true })
        if (state.patch !== null) writeFileSync(join(root, 'patches/client.patch'), state.patch)
        for (const [path, contents] of Object.entries(state.files)) writeFileSync(join(root, path), contents)
        writeFileSync(join(root, 'pnpm-workspace.yaml'), JSON.stringify(workspace))
        writeFileSync(
            join(root, 'pnpm-lock.yaml'),
            `---\n${JSON.stringify({ snapshots: { 'pnpm@12.18.0': {} } })}\n---\n${JSON.stringify(lock)}`,
        )
        check(() => verifyPatchExceptions([exception], root))
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
}

test('verifies reviewed patch bytes, workspace registration and locked application', () => {
    withRepository(
        () => {},
        verify => assert.doesNotThrow(verify),
    )
})

test.each([
    state => {
        state.patch = 'changed bytes'
    },
    state => {
        delete state.workspace.patchedDependencies['client@1.0.0']
    },
    state => {
        state.workspace.patchedDependencies['client@1.0.0'] = 'patches/other.patch'
    },
    state => {
        state.lock.patchedDependencies['client@1.0.0'] = '0'.repeat(64)
    },
    state => {
        state.lock.snapshots = {}
    },
    state => {
        state.lock.snapshots['client@1.0.0'] = {}
    },
    state => {
        state.lock.snapshots['client@1.0.0(patch_hash=wrong)'] = {}
    },
])('fails closed when patch evidence changes (%#)', change => {
    withRepository(change, verify => assert.throws(verify, /patch verification failed/))
})

test('an allowance for a version that is neither locked nor registered is stale, not a failure', () => {
    withRepository(
        state => {
            state.patch = null
            state.workspace.patchedDependencies = {}
            state.lock.patchedDependencies = {}
            state.lock.snapshots = { 'client@1.0.1': {} }
            state.files = {}
        },
        verify => assert.doesNotThrow(verify),
    )
})

test('a registered patch fails closed when its regression test is missing', () => {
    withRepository(
        state => {
            state.files = {}
        },
        verify => assert.throws(verify, /patch verification failed/),
    )
})

test.each([
    ['a patch test no allowance lists', { 'tools/security-patches/old.test.mjs': 'test' }],
    ['a patch file nothing registers', { 'patches/old@1.0.0.patch': 'patch' }],
])('%s lingers and fails verification', (_case, files) => {
    withRepository(
        state => {
            Object.assign(state.files, files)
        },
        verify => assert.throws(verify, new RegExp(`Unowned security patch files: ${Object.keys(files)[0]}`)),
    )
})

test('unowned patch files fail even without patch allowances', () => {
    const root = mkdtempSync(join(tmpdir(), 'patch-exception-'))
    try {
        mkdirSync(join(root, 'tools/security-patches'), { recursive: true })
        writeFileSync(join(root, 'tools/security-patches/client.test.mjs'), 'test')
        writeFileSync(join(root, 'pnpm-workspace.yaml'), 'minimumReleaseAge: 4320\n')
        assert.throws(() => verifyPatchExceptions([], root), /Unowned security patch files/)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test('a missing patch file fails closed', () => {
    withRepository(
        state => {
            state.patch = null
        },
        verify => assert.throws(verify, /ENOENT/),
    )
})

test('rejects unsafe patch paths, malformed hashes and non-npm bindings', () => {
    for (const path of ['../patches/client.patch', '/patches/client.patch', 'patches/../client.patch']) {
        assert.throws(() => validateExceptions([{ ...exception, patch: { ...exception.patch, path } }]))
    }
    assert.throws(() =>
        validateExceptions([{ ...exception, patch: { ...exception.patch, sha256: 'invalid' } }]),
    )
    assert.throws(() => validateExceptions([{ ...exception, ecosystem: 'crates.io' }]))
    for (const patch of [null, false, '', {}, []])
        assert.throws(() => validateExceptions([{ ...exception, patch }]))
    for (const change of [
        { since: undefined },
        { since: '2026-11-11' },
        { advisoryModified: 'unknown' },
        { tests: undefined },
        { tests: [] },
        { tests: ['tools/security-patches/a.test.mjs', 'tools/security-patches/a.test.mjs'] },
        { tests: ['tools/security/a.test.mjs'] },
        { tests: ['tools/security-patches/../a.test.mjs'] },
    ])
        assert.throws(
            () => validateExceptions([{ ...exception, patch: { ...exception.patch, ...change } }]),
            /patch binding/,
        )
})

test('an advisory amended after the patch review blocks again with the reason', () => {
    const scan = advisoryModified => ({
        results: [
            {
                source: { path: '/repo/pnpm-lock.yaml' },
                packages: [
                    {
                        package: { ecosystem: 'npm', name: 'client', version: '1.0.0' },
                        vulnerabilities: [{ id: 'GHSA-existing', modified: advisoryModified }],
                    },
                ],
            },
            {
                source: { path: '/repo/Cargo.lock' },
                packages: [{ package: { ecosystem: 'crates.io', name: 'parser', version: '1.0.0' } }],
            },
        ],
    })
    const now = new Date('2026-11-12T00:00:00Z')
    assert.equal(evaluateScan(scan(modified), [exception], now)[0].status, 'accepted')
    const [finding] = evaluateScan(scan('2026-11-11T08:00:00Z'), [exception], now)
    assert.equal(finding.status, 'blocked')
    assert.match(finding.reason, /after the patch review/)
})

test('patch allowances expire and never accept another advisory or version', () => {
    const report = {
        results: [
            {
                source: { path: '/repo/pnpm-lock.yaml' },
                packages: [
                    {
                        package: { ecosystem: 'npm', name: 'client', version: '1.0.0' },
                        vulnerabilities: [
                            { id: 'GHSA-existing', modified },
                            { id: 'GHSA-new', modified },
                        ],
                    },
                    {
                        package: { ecosystem: 'npm', name: 'client', version: '1.0.1' },
                        vulnerabilities: [{ id: 'GHSA-existing', modified }],
                    },
                ],
            },
            {
                source: { path: '/repo/Cargo.lock' },
                packages: [{ package: { ecosystem: 'crates.io', name: 'parser', version: '1.0.0' } }],
            },
        ],
    }
    assert.deepEqual(
        evaluateScan(report, [exception], new Date('2026-11-23T23:59:59Z')).map(f => f.status),
        ['accepted', 'blocked', 'blocked'],
    )
    assert.deepEqual(
        evaluateScan(report, [exception], new Date('2026-11-24T00:00:00Z')).map(f => f.status),
        ['blocked', 'blocked', 'blocked'],
    )
})

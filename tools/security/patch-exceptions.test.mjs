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
    expires: '2026-11-24',
    patch: { path: 'patches/client.patch', sha256: digest },
}

function withRepository(change, check) {
    const root = mkdtempSync(join(tmpdir(), 'patch-exception-'))
    const workspace = { patchedDependencies: { 'client@1.0.0': 'patches/client.patch' } }
    const lock = {
        patchedDependencies: { 'client@1.0.0': digest },
        snapshots: { [`client@1.0.0(patch_hash=${digest})`]: {} },
    }
    const state = { patch, workspace, lock }
    try {
        change(state)
        mkdirSync(join(root, 'patches'))
        if (state.patch !== null) writeFileSync(join(root, 'patches/client.patch'), state.patch)
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
})

test('patch allowances expire and never accept another advisory or version', () => {
    const report = {
        results: [
            {
                source: { path: '/repo/pnpm-lock.yaml' },
                packages: [
                    {
                        package: { ecosystem: 'npm', name: 'client', version: '1.0.0' },
                        vulnerabilities: [{ id: 'GHSA-existing' }, { id: 'GHSA-new' }],
                    },
                    {
                        package: { ecosystem: 'npm', name: 'client', version: '1.0.1' },
                        vulnerabilities: [{ id: 'GHSA-existing' }],
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

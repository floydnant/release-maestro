import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { afterEach } from 'node:test'
import {
    isExactDependencySpecifier,
    isPinnedActionReference,
    verifyDependencyPolicy,
} from './verify-dependency-policy.mjs'

const temporaryDirectories = []

afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
        rmSync(directory, { force: true, recursive: true })
    }
})

const createWorkspace = () => {
    const workspace = mkdtempSync(join(tmpdir(), 'dependency-policy-'))
    temporaryDirectories.push(workspace)
    mkdirSync(join(workspace, '.github', 'workflows'), { recursive: true })
    writeFileSync(
        join(workspace, 'package.json'),
        JSON.stringify({
            packageManager: `pnpm@1.2.3+sha512.${'a'.repeat(128)}`,
            dependencies: { example: '1.2.3' },
            engines: { node: '>= 22.22.3 < 25' },
        }),
    )
    writeFileSync(
        join(workspace, 'pnpm-workspace.yaml'),
        [
            'minimumReleaseAge: 4320',
            'minimumReleaseAgeIgnoreMissingTime: false',
            'minimumReleaseAgeStrict: true',
            'trustPolicy: no-downgrade',
            'strictDepBuilds: true',
            'autoInstallPeers: false',
            "savePrefix: ''",
        ].join('\n'),
    )
    writeFileSync(
        join(workspace, '.github', 'workflows', 'ci.yml'),
        `jobs:\n  test:\n    steps:\n      - uses: owner/action@${'b'.repeat(40)}\n`,
    )
    return workspace
}

test('accepts exact dependency versions only', () => {
    assert.equal(isExactDependencySpecifier('1.2.3'), true)
    assert.equal(isExactDependencySpecifier('1.2.3-beta.1'), true)
    assert.equal(isExactDependencySpecifier('^1.2.3'), false)
    assert.equal(isExactDependencySpecifier('*'), false)
    assert.equal(isExactDependencySpecifier('latest'), false)
})

test('accepts immutable action references and local actions', () => {
    assert.equal(isPinnedActionReference('actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1'), true)
    assert.equal(isPinnedActionReference('./.github/actions/setup-node'), true)
    assert.equal(isPinnedActionReference(`docker://registry.example/action@sha256:${'c'.repeat(64)}`), true)
    assert.equal(isPinnedActionReference('actions/checkout@v7'), false)
    assert.equal(isPinnedActionReference('docker://registry.example/action:latest'), false)
})

test('validates effective pnpm settings instead of matching comments', () => {
    const workspace = createWorkspace()
    writeFileSync(
        join(workspace, 'pnpm-workspace.yaml'),
        `minimumReleaseAge: 0\n# minimumReleaseAge: 4320\nminimumReleaseAgeIgnoreMissingTime: false\nminimumReleaseAgeStrict: true\ntrustPolicy: no-downgrade\nstrictDepBuilds: true\nautoInstallPeers: false\nsavePrefix: ''\n`,
    )

    assert.match(verifyDependencyPolicy(workspace).join('\n'), /minimumReleaseAge must be 4320/)
})

test('parses quoted uses keys while ignoring comments and block-scalar text', () => {
    const workspace = createWorkspace()
    writeFileSync(
        join(workspace, '.github', 'workflows', 'ci.yml'),
        `env:\n  uses: owner/in-an-env@v1\njobs:\n  test:\n    steps:\n      # uses: owner/commented@v1\n      - run: |\n          echo 'uses: owner/in-a-script@v1'\n      - "uses": owner/action@v1\n`,
    )

    const errors = verifyDependencyPolicy(workspace)
    assert.equal(errors.length, 1)
    assert.match(errors[0], /owner\/action@v1/)
})

test('ignores YAML outside the exact workflows directory', () => {
    const workspace = createWorkspace()
    const backupDirectory = join(workspace, '.github', 'workflows-backup')
    mkdirSync(backupDirectory, { recursive: true })
    writeFileSync(join(backupDirectory, 'unused.yml'), 'uses: owner/action@v1\n')

    assert.deepEqual(verifyDependencyPolicy(workspace), [])
})

test('checks composite actions outside the GitHub directory', () => {
    const workspace = createWorkspace()
    const actionDirectory = join(workspace, 'ci', 'local-action')
    mkdirSync(actionDirectory, { recursive: true })
    writeFileSync(
        join(actionDirectory, 'action.yml'),
        `runs:\n  using: composite\n  steps:\n    - uses: owner/action@v1\n`,
    )

    assert.match(verifyDependencyPolicy(workspace).join('\n'), /ci\/local-action\/action.yml/)
})

test('rejects alternate lockfiles', () => {
    const workspace = createWorkspace()
    writeFileSync(join(workspace, 'package-lock.json'), '{}')

    assert.match(verifyDependencyPolicy(workspace).join('\n'), /package-lock.json: unsupported lockfile/)
})

test('does not follow directory symlinks', { skip: process.platform === 'win32' }, () => {
    const workspace = createWorkspace()
    symlinkSync(workspace, join(workspace, 'loop'), 'dir')

    assert.deepEqual(verifyDependencyPolicy(workspace), [])
})

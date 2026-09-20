import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, test } from '@jest/globals'
import {
    isExactDependencySpecifier,
    isExactReleaseAgeExclusion,
    isPinnedActionReference,
    verifyDependencyPolicy,
} from './verify-dependency-policy.mjs'

const temporaryDirectories = []
const testOnNonWindows = process.platform === 'win32' ? test.skip : test

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
            packageManager: 'pnpm@1.2.3',
            dependencies: { example: '1.2.3' },
            engines: { node: '>= 22.22.3 < 23 || >= 24.15.0 < 25', pnpm: '1.2.3' },
        }),
    )
    writeFileSync(
        join(workspace, 'pnpm-workspace.yaml'),
        [
            'minimumReleaseAge: 4320',
            'minimumReleaseAgeIgnoreMissingTime: false',
            'minimumReleaseAgeStrict: true',
            'minimumReleaseAgeExcludePrune: true',
            'trustPolicy: no-downgrade',
            'trustPolicyIgnoreAfter: 525600',
            'trustLockfile: false',
            'blockExoticSubdeps: true',
            'strictDepBuilds: true',
            'autoInstallPeers: false',
            "savePrefix: ''",
            'allowBuilds:',
            "  '@parcel/watcher': true",
            "  '@pnpm/exe': true",
            "  '@swc/core': true",
            '  better-sqlite3: true',
            '  electron: true',
            '  esbuild: true',
            '  lmdb: false',
            '  msgpackr-extract: false',
            '  nx: true',
            '  puppeteer: false',
            '  unrs-resolver: false',
            'peerDependencyRules:',
            '  ignoreMissing:',
            '    - electron-builder-squirrel-windows',
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

test('accepts only exact-version release-age exclusions', () => {
    assert.equal(isExactReleaseAgeExclusion('electron@44.4.3'), true)
    assert.equal(isExactReleaseAgeExclusion('@jest/core@30.5.2'), true)
    assert.equal(isExactReleaseAgeExclusion('@jest/*'), false)
    assert.equal(isExactReleaseAgeExclusion('electron'), false)
})

test('requires one exact pnpm version across package-manager declarations', () => {
    const workspace = createWorkspace()
    const manifestPath = join(workspace, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.packageManager = 'pnpm@^1.2.3'
    writeFileSync(manifestPath, JSON.stringify(manifest))

    assert.match(
        verifyDependencyPolicy(workspace).join('\n'),
        /packageManager must pin pnpm by exact version/,
    )

    manifest.packageManager = 'pnpm@1.2.4'
    writeFileSync(manifestPath, JSON.stringify(manifest))
    assert.match(verifyDependencyPolicy(workspace).join('\n'), /engines\.pnpm must match packageManager/)
})

test('validates effective pnpm settings instead of matching comments', () => {
    const workspace = createWorkspace()
    writeFileSync(
        join(workspace, 'pnpm-workspace.yaml'),
        readFileSync(join(workspace, 'pnpm-workspace.yaml'), 'utf8').replace(
            'minimumReleaseAge: 4320',
            'minimumReleaseAge: 0\n# minimumReleaseAge: 4320',
        ),
    )

    assert.match(verifyDependencyPolicy(workspace).join('\n'), /minimumReleaseAge must be 4320/)
})

test('rejects Node ranges that admit unsupported releases', () => {
    const workspace = createWorkspace()
    const manifestPath = join(workspace, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
    manifest.engines.node = '>= 22.22.3 < 25'
    writeFileSync(manifestPath, JSON.stringify(manifest))

    assert.match(
        verifyDependencyPolicy(workspace).join('\n'),
        /engines\.node must require Node 22\.22\.3–22\.x or Node 24\.15\.0–24\.x/,
    )
})

test('rejects broad security exceptions and unreviewed build-script changes', () => {
    const workspace = createWorkspace()
    const settingsPath = join(workspace, 'pnpm-workspace.yaml')
    writeFileSync(
        settingsPath,
        `${readFileSync(settingsPath, 'utf8')}\nminimumReleaseAgeExclude:\n  - '@jest/*'\ntrustPolicyExclude:\n  - example\n`,
    )

    const errors = verifyDependencyPolicy(workspace).join('\n')
    assert.match(errors, /minimumReleaseAgeExclude may contain exact versions only/)
    assert.match(errors, /trustPolicyExclude must be empty/)

    writeFileSync(settingsPath, readFileSync(settingsPath, 'utf8').replace('  nx: true', '  nx: false'))
    assert.match(
        verifyDependencyPolicy(workspace).join('\n'),
        /allowBuilds must match the reviewed install-script policy/,
    )
})

test('rejects broad missing-peer exceptions', () => {
    const workspace = createWorkspace()
    const settingsPath = join(workspace, 'pnpm-workspace.yaml')
    writeFileSync(
        settingsPath,
        readFileSync(settingsPath, 'utf8').replace('    - electron-builder-squirrel-windows', "    - '*'"),
    )

    assert.match(
        verifyDependencyPolicy(workspace).join('\n'),
        /peerDependencyRules\.ignoreMissing must contain only electron-builder-squirrel-windows/,
    )
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

testOnNonWindows('does not follow directory symlinks', () => {
    const workspace = createWorkspace()
    symlinkSync(workspace, join(workspace, 'loop'), 'dir')

    assert.deepEqual(verifyDependencyPolicy(workspace), [])
})

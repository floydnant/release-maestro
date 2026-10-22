import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { afterEach, test } from '@jest/globals'
import {
    collectAssets,
    releaseVersion,
    resolveRelease,
    uploadRelease,
    verifyPublishedRelease,
    verifyVersion,
} from './release.mjs'
import { createReleaseAssets, publishedRelease, releaseInstallers } from './fixtures/release.mjs'

const directories = []
const assets = () => {
    const directory = createReleaseAssets()
    directories.push(directory)
    return directory
}

afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { force: true, recursive: true })
})

test('accepts stable pre-1.0 tags and rejects command-like, path, and prerelease inputs before external calls', () => {
    assert.equal(releaseVersion('v0.1.0'), '0.1.0')
    for (const tag of [
        '',
        undefined,
        'v01.1.0',
        'v0.1.0-beta.1',
        '--help',
        'v0.1.0\nsha=other',
        '../v0.1.0',
        '$(exit 42)',
    ]) {
        assert.throws(
            () => resolveRelease(tag, 'owner/repo', () => assert.fail('must not call GitHub or git')),
            /stable release tag/,
        )
    }
})

test('rejects missing, draft, prerelease, and mismatched GitHub releases', () => {
    verifyPublishedRelease('v0.1.0', publishedRelease)
    for (const release of [
        null,
        {},
        { ...publishedRelease, isDraft: true },
        { ...publishedRelease, isPrerelease: true },
        { ...publishedRelease, tagName: 'v0.1.1' },
    ]) {
        assert.throws(() => verifyPublishedRelease('v0.1.0', release), /published stable release/)
    }
    assert.throws(() => verifyVersion('v0.1.0', '1.0.0'), /does not match/)
})

test('resolves the tag commit, checks main ancestry, and reads the version from that commit rather than current main', () => {
    const calls = []
    const sha = 'a'.repeat(40)
    const command = (name, args) => {
        calls.push([name, args])
        if (name === 'gh') return JSON.stringify(publishedRelease)
        if (args[0] === 'rev-parse') return sha
        if (args[0] === 'show') return JSON.stringify({ version: '0.1.0' })
        return ''
    }
    assert.deepEqual(resolveRelease('v0.1.0', 'owner/repo', command), { tag: 'v0.1.0', sha })
    assert.ok(
        calls.some(
            ([name, args]) => name === 'git' && args[0] === 'merge-base' && args.includes('origin/main'),
        ),
    )
    assert.ok(
        calls.some(
            ([name, args]) => name === 'git' && args[0] === 'rev-parse' && args[1] === 'v0.1.0^{commit}',
        ),
    )
    assert.ok(
        calls.some(
            ([name, args]) => name === 'git' && args[0] === 'show' && args[1] === `${sha}:package.json`,
        ),
    )
})

test('a tag outside main or with a mismatched version cannot reach a release build', () => {
    for (const failure of ['ancestry', 'version']) {
        const command = (name, args) => {
            if (name === 'gh') return JSON.stringify(publishedRelease)
            if (args[0] === 'rev-parse') return 'a'.repeat(40)
            if (args[0] === 'merge-base' && failure === 'ancestry') throw new Error('outside main')
            if (args[0] === 'show') return JSON.stringify({ version: '0.2.0' })
            return ''
        }
        assert.throws(() => resolveRelease('v0.1.0', 'owner/repo', command), /outside main|does not match/)
    }
})

test('collects both macOS installers and update files without including unpacked applications or debug files', () => {
    const directory = assets()
    writeFileSync(join(directory, 'latest-mac.yml'), 'metadata')
    writeFileSync(join(directory, 'Release-Maestro-macOS-arm64.dmg'), 'native installer')
    writeFileSync(join(directory, 'Release-Maestro-macOS-arm64.zip'), 'native archive')
    writeFileSync(join(directory, 'Release-Maestro-macOS-universal.zip.blockmap'), 'blockmap')
    writeFileSync(join(directory, 'builder-debug.yml'), 'debug')
    mkdirSync(join(directory, 'mac-universal'))
    assert.deepEqual(
        Array.from(collectAssets(directory, 'macos'), path => basename(path)),
        [
            'Release-Maestro-macOS-arm64.dmg',
            'Release-Maestro-macOS-arm64.zip',
            'Release-Maestro-macOS-universal.dmg',
            'Release-Maestro-macOS-universal.zip',
            'Release-Maestro-macOS-universal.zip.blockmap',
            'latest-mac.yml',
        ],
    )
})

test('refuses to upload until every platform has nonempty installers', () => {
    const directory = assets()
    rmSync(join(directory, releaseInstallers[0]))
    const command = (name, args) => {
        assert.equal(name, 'gh')
        assert.equal(args[1], 'view', 'must not upload partial releases')
        return JSON.stringify(publishedRelease)
    }
    assert.throws(
        () => uploadRelease('v0.1.0', 'owner/repo', directory, '0.1.0', command),
        /Missing or empty installer/,
    )
    writeFileSync(join(directory, releaseInstallers[0]), '')
    assert.throws(() => collectAssets(directory, 'linux'), /Missing or empty installer/)
})

test('upload retries replace existing assets on the same release without creating tags or changing notes', () => {
    const directory = assets()
    const calls = []
    const command = (name, args) => {
        calls.push([name, args])
        return args[1] === 'view' ? JSON.stringify(publishedRelease) : ''
    }
    uploadRelease('v0.1.0', 'owner/repo', directory, '0.1.0', command)
    uploadRelease('v0.1.0', 'owner/repo', directory, '0.1.0', command)
    const uploads = calls.filter(([, args]) => args[1] === 'upload')
    assert.equal(uploads.length, 2)
    assert.deepEqual(uploads[0], uploads[1])
    assert.ok(uploads[0][1].includes('--clobber'))
    assert.deepEqual(
        uploads[0][1]
            .filter(arg => arg.startsWith(directory))
            .map(path => basename(path))
            .sort(),
        [...releaseInstallers].sort(),
    )
})

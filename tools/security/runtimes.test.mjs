import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@jest/globals'
import {
    assessRuntime,
    checkRuntimes,
    compareVersions,
    declaredBrowsers,
    runtimeGateFailed,
    sources,
} from './runtimes.mjs'

const upstream = {
    chrome: '156.0.8078.80',
    electron: [
        { version: '45.0.2', chrome: '156.0.8078.80', node: '24.22.0' },
        { version: '44.9.4', chrome: '152.0.7977.180', node: '24.22.0' },
        { version: '44.9.0', chrome: '152.0.7977.167', node: '24.22.0' },
        { version: '43.9.0', chrome: '150.0.7777.100', node: '24.22.0' },
    ],
}

test('flags the Chromium build in the incident and compares patch numbers numerically', () => {
    assert.equal(
        assessRuntime({ package: 'playwright-core', version: '156.0.8078.4' }, upstream).status,
        'review-required',
    )
    assert.equal(compareVersions('156.0.8078.100', upstream.chrome), 1)
    assert.equal(
        assessRuntime({ package: 'puppeteer-core', version: upstream.chrome }, upstream).status,
        'current',
    )
    assert.throws(() => compareVersions(undefined, upstream.chrome), /Invalid runtime version/)
})

test('checks Electron patch freshness without claiming older Chromium lacks backported fixes', () => {
    const runtime = { package: 'electron', packageVersion: '44.9.4', version: '152.0.7977.180' }
    assert.equal(assessRuntime(runtime, upstream).status, 'current')
    assert.equal(assessRuntime({ ...runtime, packageVersion: '44.9.0' }, upstream).status, 'review-required')
    assert.equal(assessRuntime({ ...runtime, packageVersion: '42.9.0' }, upstream).status, 'review-required')
})

test('finds the newest Electron patch without relying on feed order', () => {
    const runtime = { package: 'electron', packageVersion: '44.9.4', version: '152.0.7977.180' }
    const assessed = assessRuntime(runtime, { ...upstream, electron: upstream.electron.toReversed() })
    assert.equal(assessed.status, 'current')
    assert.equal(assessed.latestPackageVersion, '44.9.4')
})

test('parses browser declarations as data and rejects changed manifest formats', () => {
    assert.equal(
        declaredBrowsers('puppeteer-core', '1.0.0', () => "chrome: '148.0.7778.97'")[0].version,
        '148.0.7778.97',
    )
    assert.equal(
        declaredBrowsers('playwright-core', '1.0.0', () =>
            JSON.stringify({ browsers: [{ name: 'chromium', browserVersion: upstream.chrome }] }),
        )[0].version,
        upstream.chrome,
    )
    assert.throws(
        () => declaredBrowsers('puppeteer-core', '1.0.0', () => 'format changed'),
        /Missing Chrome revision/,
    )
})

test('writes unknown coverage on network errors and stale feeds; inventories every locked browser version', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'maestro-runtime-test-'))
    const write = (path, value) => {
        mkdirSync(join(directory, path, '..'), { recursive: true })
        writeFileSync(join(directory, path), value)
    }
    const now = new Date('2026-11-03T22:00:00Z')
    const feeds = {
        [sources.electron]: upstream.electron,
        [sources.chrome]: {
            timestamp: now.toISOString(),
            channels: { Stable: { version: upstream.chrome } },
        },
    }
    try {
        execFileSync('git', ['init', '--quiet'], { cwd: directory })
        execFileSync(
            'git',
            [
                '-c',
                'user.name=Test',
                '-c',
                'user.email=test@example.com',
                'commit',
                '--allow-empty',
                '-m',
                'test: fixture',
                '--quiet',
            ],
            { cwd: directory },
        )
        write(
            'pnpm-lock.yaml',
            'packages:\n  electron@44.9.4: {}\n  playwright-core@1.0.0: {}\n  playwright-core@1.1.0-alpha: {}\n  puppeteer-core@2.0.0: {}\n',
        )
        for (const version of ['1.0.0', '1.1.0-alpha']) {
            const base = `node_modules/.pnpm/playwright-core@${version}/node_modules/playwright-core`
            write(`${base}/package.json`, JSON.stringify({ name: 'playwright-core', version }))
            write(
                `${base}/browsers.json`,
                JSON.stringify({
                    browsers: [
                        {
                            name: 'chromium',
                            browserVersion: version.includes('alpha') ? '155.0.1.1' : upstream.chrome,
                        },
                    ],
                }),
            )
        }
        const base = 'node_modules/.pnpm/puppeteer-core@2.0.0_peer@1/node_modules/puppeteer-core'
        write(`${base}/package.json`, JSON.stringify({ name: 'puppeteer-core', version: '2.0.0' }))
        write(`${base}/lib/esm/puppeteer/revisions.js`, `chrome: '${upstream.chrome}'`)
        const options = { directory, now, fetchJson: async url => feeds[url] }
        const report = await checkRuntimes(options)
        assert.equal(report.runtimes.length, 4)
        assert.equal(report.errors.length, 0)
        assert.equal(report.status, 'review-required')
        assert.equal(report.runtimes.filter(r => r.status === 'review-required').length, 1)
        const failed = await checkRuntimes({
            ...options,
            fetchJson: async () => {
                throw new Error('offline')
            },
        })
        assert.equal(failed.status, 'review-required')
        assert.deepEqual(failed.runtimes, [])
        assert.match(readFileSync(join(directory, 'dist/security/runtimes.json'), 'utf8'), /offline/)
        feeds[sources.chrome].timestamp = '2026-10-01T00:00:00Z'
        assert.match((await checkRuntimes(options)).errors[0], /older than 48 hours/)
        feeds[sources.chrome].timestamp = now.toISOString()
        rmSync(join(directory, base, 'lib/esm/puppeteer/revisions.js'))
        const missing = await checkRuntimes(options)
        assert.equal(missing.status, 'review-required')
        assert.match(missing.errors[0], /puppeteer-core/)
        assert.equal(missing.runtimes.length, 3)
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
})

test('PR inventory reports freshness reviews but always fails on unknown coverage', () => {
    const review = { status: 'review-required', errors: [] }
    assert.equal(runtimeGateFailed(review), true)
    assert.equal(runtimeGateFailed(review, true), false)
    assert.equal(runtimeGateFailed({ ...review, errors: ['upstream unavailable'] }, true), true)
    assert.equal(runtimeGateFailed({ status: 'current', errors: [] }), false)
})

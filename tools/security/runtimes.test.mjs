import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterEach, beforeEach, describe, test } from '@jest/globals'
import {
    assessRuntime,
    checkRuntimes,
    compareVersions,
    declaredBrowsers,
    runtimeGateFailed,
    sources,
    stepSummary,
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

describe('assessRuntime', () => {
    test('flags the Chromium build in the incident and compares patch numbers numerically', () => {
        const stale = { package: 'playwright-core', browserVersion: '156.0.8078.4' }
        assert.equal(assessRuntime(stale, upstream).status, 'review-required')
        assert.equal(compareVersions('156.0.8078.100', upstream.chrome), 1)
        const current = { package: 'puppeteer-core', browserVersion: upstream.chrome }
        assert.equal(assessRuntime(current, upstream).status, 'current')
        assert.throws(() => compareVersions(undefined, upstream.chrome), /Invalid runtime version/)
    })

    test('checks Electron patch freshness without claiming older Chromium lacks backported fixes', () => {
        const runtime = { package: 'electron', packageVersion: '44.9.4', browserVersion: '152.0.7977.180' }
        assert.equal(assessRuntime(runtime, upstream).status, 'current')
        const olderPatch = assessRuntime({ ...runtime, packageVersion: '44.9.0' }, upstream)
        assert.equal(olderPatch.status, 'review-required')
        assert.equal(olderPatch.latestPackageVersion, '44.9.4')
        const unsupportedLine = assessRuntime({ ...runtime, packageVersion: '42.9.0' }, upstream)
        assert.equal(unsupportedLine.status, 'review-required')
        assert.match(unsupportedLine.reason, /outside the latest three stable majors/)
    })

    test('finds the newest Electron patch without relying on feed order', () => {
        const runtime = { package: 'electron', packageVersion: '44.9.4', browserVersion: '152.0.7977.180' }
        const assessed = assessRuntime(runtime, { ...upstream, electron: upstream.electron.toReversed() })
        assert.equal(assessed.status, 'current')
        assert.equal(assessed.latestPackageVersion, '44.9.4')
    })
})

test('parses browser declarations as data and rejects changed manifest formats', () => {
    const puppeteer = declaredBrowsers('puppeteer-core', '1.0.0', () => "chrome: '148.0.7778.97'")
    assert.deepEqual(puppeteer, [{ browser: 'chrome', browserVersion: '148.0.7778.97' }])
    const manifest = JSON.stringify({ browsers: [{ name: 'chromium', browserVersion: upstream.chrome }] })
    const playwright = declaredBrowsers('playwright-core', '1.0.0', () => manifest)
    assert.deepEqual(playwright, [{ browser: 'chromium', browserVersion: upstream.chrome }])
    assert.throws(
        () => declaredBrowsers('puppeteer-core', '1.0.0', () => 'format changed'),
        /Missing Chrome revision/,
    )
})

describe('checkRuntimes', () => {
    const now = new Date('2026-11-03T22:00:00Z')
    const puppeteerDirectory = 'node_modules/.pnpm/puppeteer-core@2.0.0_peer@1/node_modules/puppeteer-core'
    let directory
    let feeds

    const write = (path, contents) => {
        mkdirSync(dirname(join(directory, path)), { recursive: true })
        writeFileSync(join(directory, path), contents)
    }
    const check = (options = {}) =>
        checkRuntimes({ directory, now, fetchJson: async url => feeds[url], ...options })

    // A git checkout with three locked runtime packages. Playwright has a current release and a stale
    // prerelease; Puppeteer is installed under a peer-suffixed store entry.
    beforeEach(() => {
        directory = mkdtempSync(join(tmpdir(), 'maestro-runtime-test-'))
        const git = args => execFileSync('git', args, { cwd: directory })
        git(['init', '--quiet'])
        git([
            '-c',
            'user.name=Test',
            '-c',
            'user.email=test@example.com',
            'commit',
            '--allow-empty',
            '-qm',
            'test',
        ])

        write(
            'pnpm-lock.yaml',
            'packages:\n  electron@44.9.4: {}\n  playwright-core@1.0.0: {}\n  playwright-core@1.1.0-alpha: {}\n  puppeteer-core@2.0.0: {}\n',
        )
        for (const [version, chromium] of [
            ['1.0.0', upstream.chrome],
            ['1.1.0-alpha', '155.0.1.1'],
        ]) {
            const base = `node_modules/.pnpm/playwright-core@${version}/node_modules/playwright-core`
            write(`${base}/package.json`, JSON.stringify({ name: 'playwright-core', version }))
            write(
                `${base}/browsers.json`,
                JSON.stringify({ browsers: [{ name: 'chromium', browserVersion: chromium }] }),
            )
        }
        write(
            `${puppeteerDirectory}/package.json`,
            JSON.stringify({ name: 'puppeteer-core', version: '2.0.0' }),
        )
        write(`${puppeteerDirectory}/lib/esm/puppeteer/revisions.js`, `chrome: '${upstream.chrome}'`)

        feeds = {
            [sources.electron]: upstream.electron,
            [sources.chrome]: {
                timestamp: now.toISOString(),
                channels: { Stable: { version: upstream.chrome } },
            },
        }
    })
    afterEach(() => rmSync(directory, { recursive: true, force: true }))

    test('inventories every locked browser declaration and writes the report', async () => {
        const report = await check()
        assert.deepEqual(report.errors, [])
        assert.deepEqual(
            report.runtimes.map(r => `${r.package}@${r.packageVersion} ${r.browserVersion} ${r.status}`),
            [
                'electron@44.9.4 152.0.7977.180 current',
                `playwright-core@1.0.0 ${upstream.chrome} current`,
                'playwright-core@1.1.0-alpha 155.0.1.1 review-required',
                `puppeteer-core@2.0.0 ${upstream.chrome} current`,
            ],
        )
        assert.equal(report.status, 'review-required')
        assert.deepEqual(
            JSON.parse(readFileSync(join(directory, 'dist/security/runtimes.json'), 'utf8')),
            report,
        )
    })

    test('records unknown coverage when upstream is unreachable', async () => {
        const report = await check({
            fetchJson: async () => {
                throw new Error('offline')
            },
        })
        assert.equal(report.status, 'review-required')
        assert.deepEqual(report.runtimes, [])
        assert.deepEqual(report.errors, ['offline'])
        assert.match(readFileSync(join(directory, 'dist/security/runtimes.json'), 'utf8'), /offline/)
    })

    test('records unknown coverage when the Chrome feed is stale', async () => {
        feeds[sources.chrome].timestamp = '2026-10-01T00:00:00Z'
        const report = await check()
        assert.deepEqual(report.runtimes, [])
        assert.match(report.errors[0], /older than 48 hours/)
    })

    test('records a missing manifest against its version and inventories the rest', async () => {
        rmSync(join(directory, puppeteerDirectory, 'lib/esm/puppeteer/revisions.js'))
        const report = await check()
        assert.equal(report.status, 'review-required')
        assert.equal(report.errors.length, 1)
        assert.match(report.errors[0], /^puppeteer-core@2\.0\.0: /)
        assert.equal(report.runtimes.length, 3)
    })

    test('does not inventory Puppeteer when no dependency locks it, even with stale store entries', async () => {
        write('pnpm-lock.yaml', 'packages:\n  electron@44.9.4: {}\n  playwright-core@1.0.0: {}\n')
        const report = await check()
        assert.deepEqual(report.errors, [])
        assert.equal(report.status, 'current')
        assert.deepEqual(
            report.runtimes.map(r => r.package),
            ['electron', 'playwright-core'],
        )
    })

    test('records required runtimes missing from the lockfile', async () => {
        write('pnpm-lock.yaml', 'packages:\n  puppeteer-core@2.0.0: {}\n')
        const report = await check()
        assert.deepEqual(report.errors, [
            'Runtime package missing from lockfile: electron',
            'Runtime package missing from lockfile: playwright-core',
        ])
        assert.equal(report.status, 'review-required')
    })

    test('fails when locked Puppeteer is not installed', async () => {
        rmSync(join(directory, puppeteerDirectory), { recursive: true })
        const report = await check()
        assert.equal(report.errors.length, 1)
        assert.match(report.errors[0], /^puppeteer-core@2\.0\.0: /)
        assert.equal(report.status, 'review-required')
    })

    test('rejects a store entry whose installed identity differs from the lockfile', async () => {
        write(
            `${puppeteerDirectory}/package.json`,
            JSON.stringify({ name: 'puppeteer-core', version: '1.9.0' }),
        )
        const report = await check()
        assert.deepEqual(report.errors, ['puppeteer-core@2.0.0: Installed package identity mismatch'])
    })
})

describe('runtime gate', () => {
    const review = { status: 'review-required', runtimes: [{ status: 'review-required' }], errors: [] }
    const unknown = { ...review, errors: ['upstream unavailable'] }

    test('PR inventory reports freshness reviews but always fails on unknown coverage', () => {
        assert.equal(runtimeGateFailed(review, { inventoryOnly: true }), false)
        assert.equal(runtimeGateFailed(unknown, { inventoryOnly: true }), true)
        assert.match(stepSummary(review, { inventoryOnly: true }), /1 freshness reviews.*\n.*PR reports/)
    })

    test('main, scheduled, and manual runs enforce freshness reviews and unknown coverage', () => {
        assert.equal(runtimeGateFailed(review, { inventoryOnly: false }), true)
        assert.equal(runtimeGateFailed(unknown, { inventoryOnly: false }), true)
        assert.equal(runtimeGateFailed({ status: 'current', errors: [] }, { inventoryOnly: false }), false)
        assert.match(stepSummary(review, { inventoryOnly: false }), /This run enforces freshness findings/)
    })
})

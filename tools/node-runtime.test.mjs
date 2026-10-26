import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, test } from '@jest/globals'
import { nodeRuntimeFixture } from './fixtures/node-runtime.mjs'
import { nodeRuntimeErrors, planNodeSecurityUpdate, updateNodeRuntime } from './node-runtime.mjs'

const directories = []
afterEach(() => directories.splice(0).forEach(path => rmSync(path, { recursive: true, force: true })))
const plan = fixture =>
    planNodeSecurityUpdate(fixture.range, fixture.pin, fixture.releases, fixture.schedule, fixture.now)
const workspace = () => {
    const fixture = nodeRuntimeFixture()
    const root = mkdtempSync(join(tmpdir(), 'node-runtime-'))
    directories.push(root)
    writeFileSync(
        join(root, 'package.json'),
        JSON.stringify(
            {
                name: 'fixture',
                engines: { node: fixture.range },
                dependencies: { example: '1.2.3' },
            },
            null,
            4,
        ) + '\n',
    )
    writeFileSync(join(root, '.node-version'), fixture.pin + '\n')
    const request = async url => (url.includes('index.json') ? fixture.releases : fixture.schedule)
    return { root, fixture, request }
}

test('proposes LTS security updates for both floors and the pinned major only', () => {
    const update = plan(nodeRuntimeFixture())
    assert.equal(update.range, '>= 22.24.0 < 23 || >= 24.23.0 < 25')
    assert.equal(update.pin, '24.23.0')
    assert.equal(update.packages.filter(p => p.status === 'fixed').length, 2)
    assert.deepEqual(nodeRuntimeErrors(update.range, update.pin), [])
})

test('does not downgrade a newer runtime or minimum floor', () => {
    const fixture = nodeRuntimeFixture()
    fixture.pin = '24.25.0'
    fixture.range = '>= 22.25.0 < 23 || >= 24.24.0 < 25'
    const update = plan(fixture)
    assert.equal(update.pin, fixture.pin)
    assert.equal(update.range, fixture.range)
    assert(update.packages.every(p => p.status === 'current'))
})

test('repairs a pin below an already raised floor after a partial prior write', () => {
    const fixture = nodeRuntimeFixture()
    fixture.range = '>= 22.24.0 < 23 || >= 24.23.0 < 25'
    const update = plan(fixture)
    assert.equal(update.pin, '24.23.0')
    assert.equal(update.packages[1].status, 'fixed')
})

test('never proposes prereleases, future releases, or releases not yet marked LTS', () => {
    const fixture = nodeRuntimeFixture()
    fixture.releases.push(
        { version: 'v24.99.0-rc.1', date: '2026-11-01', lts: 'Krypton', security: true },
        { version: 'v24.99.0', date: '2027-01-01', lts: 'Krypton', security: true },
        { version: 'v24.98.0', date: '2026-11-01', lts: false, security: true },
    )
    assert.equal(plan(fixture).pin, '24.23.0')
})

test('end-of-life lines require maintainer review instead of silently changing supported majors', () => {
    const fixture = nodeRuntimeFixture()
    fixture.schedule.v22.end = '2026-11-02'
    assert.throws(() => plan(fixture), /Node 22 is not a maintained LTS/)
})

test('invalid or incomplete upstream metadata fails closed', () => {
    const fixture = nodeRuntimeFixture()
    fixture.releases = fixture.releases.filter(r => !r.version.startsWith('v22'))
    assert.throws(() => plan(fixture), /No published LTS security release found for Node 22/)
    fixture.releases = [{ version: 'v22.24.0', date: '2026-02-30', lts: 'Jod', security: true }]
    assert.throws(() => plan(fixture), /Invalid date/)
    fixture.releases[0].date = '2026-11-01'
    fixture.releases[0].security = 'true'
    assert.throws(() => plan(fixture), /Invalid Node security release metadata/)
})

test('policy accepts future raised floors but rejects mismatched or unsupported pins', () => {
    assert.deepEqual(nodeRuntimeErrors('>= 22.24.0 < 23 || >= 24.23.0 < 25', '24.23.1'), [])
    assert.equal(nodeRuntimeErrors('>= 22.24.0 < 23 || >= 24.23.0 < 25', '24.22.1').length, 1)
    assert.equal(nodeRuntimeErrors(nodeRuntimeFixture().range, '26.12.1').length, 1)
})

test('apply updates both inputs, preserves other fields, and converges on a repeated run', async () => {
    const { root, fixture, request } = workspace()
    const report = await updateNodeRuntime('apply', root, { request, now: fixture.now })
    assert.equal(readFileSync(join(root, '.node-version'), 'utf8'), '24.23.0\n')
    const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.equal(manifest.engines.node, report.range)
    assert.deepEqual(manifest.dependencies, { example: '1.2.3' })
    const before = readFileSync(join(root, 'package.json'), 'utf8')
    const retry = await updateNodeRuntime('apply', root, { request, now: fixture.now })
    assert(retry.packages.every(p => p.status === 'current'))
    assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before)
    assert.equal(JSON.parse(readFileSync(join(root, 'dist/security/node-runtime.json'))).mode, 'apply')
})

test('preview leaves runtime inputs unchanged and cannot be confused with an applied report', async () => {
    const { root, fixture, request } = workspace()
    const before = readFileSync(join(root, 'package.json'), 'utf8')
    const report = await updateNodeRuntime('plan', root, { request, now: fixture.now })
    assert(report.packages.every(p => p.status === 'planned'))
    assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before)
    assert.equal(readFileSync(join(root, '.node-version'), 'utf8').trim(), fixture.pin)
    assert.equal(JSON.parse(readFileSync(join(root, 'dist/security/node-runtime.json'))).mode, 'plan')
})

test('lookup failure preserves inputs and removes stale publishable reports', async () => {
    const { root, fixture } = workspace()
    mkdirSync(join(root, 'dist/security'), { recursive: true })
    writeFileSync(join(root, 'dist/security/node-runtime.json'), '{"mode":"apply"}')
    writeFileSync(join(root, 'dist/security/node-runtime-pr.md'), 'stale')
    const before = readFileSync(join(root, 'package.json'), 'utf8')
    await assert.rejects(
        updateNodeRuntime('apply', root, {
            request: async () => {
                throw new Error('network unavailable')
            },
            now: fixture.now,
        }),
        /network unavailable/,
    )
    assert.equal(readFileSync(join(root, 'package.json'), 'utf8'), before)
    assert.throws(() => readFileSync(join(root, 'dist/security/node-runtime.json')), /ENOENT/)
    assert.throws(() => readFileSync(join(root, 'dist/security/node-runtime-pr.md')), /ENOENT/)
})

import assert from 'node:assert/strict'
import {
    chmod,
    cp,
    mkdir,
    mkdtemp,
    readFile,
    realpath,
    rename,
    rm,
    symlink,
    utimes,
    writeFile,
} from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import net from 'node:net'
import { afterEach, jest, test } from '@jest/globals'
import { parseUnixProcessIdentity, rootProcessHolders } from './core.mjs'

jest.setTimeout(30_000)

test('Unix process identities exclude zombie and exiting processes', () => {
    const started = 'Mon Sep 21 23:59:02 2026'

    assert.equal(parseUnixProcessIdentity(`S+ ${started}`), started)
    assert.equal(parseUnixProcessIdentity(`Z ${started}`), null)
    assert.equal(parseUnixProcessIdentity(`?Es ${started}`), null)
})

test('process shutdown starts with supervisors and orphaned holders', () => {
    const supervisor = { id: 'supervisor' }
    const managedChild = { id: 'managed-child', parentHolderId: supervisor.id }
    const orphan = { id: 'orphan', parentHolderId: 'missing-parent' }

    assert.deepEqual(rootProcessHolders([supervisor, managedChild, orphan]), [supervisor, orphan])
})

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const coreModule = new URL('./core.mjs', import.meta.url).href
const cli = join(repositoryRoot, 'tools/dev-instance/cli.mjs')
const mcpWrapper = join(repositoryRoot, 'tools/dev-instance/mcp-wrapper.mjs')
const hook = join(repositoryRoot, 'tools/dev-instance/hook.mjs')
const temporaryDirectories = []
const liveChildren = []
const liveServers = []

afterEach(async () => {
    for (const child of liveChildren.splice(0)) {
        if (child.exitCode === null && child.signalCode === null) {
            spawnSync('pkill', ['-TERM', '-P', String(child.pid)])
            child.kill('SIGKILL')
        }
    }
    for (const server of liveServers.splice(0)) {
        await new Promise(resolve => server.close(resolve))
    }
    for (const directory of temporaryDirectories.splice(0)) {
        await rm(directory, { recursive: true, force: true })
    }
})

const git = (cwd, args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    return result.stdout.trim()
}

const createFixture = async ({ worktrees = 1 } = {}) => {
    const base = await mkdtemp(join(tmpdir(), 'release-maestro-instance-test-'))
    temporaryDirectories.push(base)
    const main = join(base, 'main')
    const state = join(base, 'state')
    await mkdir(main)
    git(main, ['init', '-q'])
    git(main, ['config', 'user.email', 'test@example.com'])
    git(main, ['config', 'user.name', 'Test'])
    await writeFile(join(main, 'README.md'), 'fixture\n')
    git(main, ['add', 'README.md'])
    git(main, ['commit', '-qm', 'fixture'])
    const roots = [main]
    for (let index = 1; index < worktrees; index += 1) {
        const path = join(base, `worktree-${index}`)
        git(main, ['worktree', 'add', '-q', '-b', `fixture-${index}`, path])
        roots.push(path)
    }
    return { base, main, roots, state }
}

const environmentFor = (fixture, extra = {}) => ({
    ...process.env,
    RELEASE_MAESTRO_INSTANCE_STATE_DIR: fixture.state,
    ...extra,
})

const run = (fixture, cwd, args, extra = {}) =>
    spawnSync(process.execPath, [cli, ...args], {
        cwd,
        env: environmentFor(fixture, extra),
        encoding: 'utf8',
        timeout: 15_000,
    })

const runJson = (fixture, cwd, args, extra = {}) => {
    const result = run(fixture, cwd, args, extra)
    assert.equal(result.status, 0, result.stderr)
    return JSON.parse(result.stdout)
}

const waitFor = async (read, predicate, message, timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs
    let value
    while (Date.now() < deadline) {
        try {
            value = await read()
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
            await new Promise(resolve => setTimeout(resolve, 50))
            continue
        }
        if (predicate(value)) return value
        await new Promise(resolve => setTimeout(resolve, 50))
    }
    assert.fail(`${message}: ${JSON.stringify(value)}`)
}

const listen = (host, port) =>
    new Promise((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen({ host, port, ipv6Only: host === '::1' }, () => {
            liveServers.push(server)
            resolve(server)
        })
    })

const createFakePnpm = async (fixture, directoryName = 'bin') => {
    const bin = join(fixture.base, directoryName)
    const executable = join(bin, 'pnpm')
    await mkdir(bin)
    await writeFile(
        executable,
        `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import net from 'node:net'
if (process.env.FAKE_CAPTURE) writeFileSync(process.env.FAKE_CAPTURE, JSON.stringify(process.argv.slice(2)))
const portIndex = process.argv.indexOf('--port')
const remoteIndex = process.argv.indexOf('--remoteDebuggingPort')
const servers = []
if (process.env.FAKE_OPEN_PORT === '1') {
  for (const index of [portIndex, remoteIndex]) {
    if (index < 0) continue
    const server = net.createServer()
    server.listen({ host: 'localhost', port: Number(process.argv[index + 1]) })
    servers.push(server)
  }
}
const finish = signal => {
  if (process.env.FAKE_SIGNAL_CAPTURE) writeFileSync(process.env.FAKE_SIGNAL_CAPTURE, signal)
  for (const server of servers) server.close()
  process.exit(signal ? 0 : Number(process.env.FAKE_EXIT_CODE ?? 0))
}
process.on('SIGTERM', () => {
  if (process.env.FAKE_IGNORE_SIGTERM !== '1') finish('SIGTERM')
})
process.on('SIGINT', () => finish('SIGINT'))
const delay = Number(process.env.FAKE_DELAY_MS ?? 60000)
setTimeout(() => finish(''), delay)
`,
    )
    await chmod(executable, 0o755)
    return bin
}

const spawnMcp = (fixture, cwd, bin, server = 'chrome-devtools', extra = {}) => {
    const child = spawn(process.execPath, [mcpWrapper, server], {
        cwd,
        env: environmentFor(fixture, {
            PATH: `${bin}:${process.env.PATH}`,
            RELEASE_MAESTRO_PNPM_COMMAND: join(bin, 'pnpm'),
            ...extra,
        }),
        stdio: ['pipe', 'pipe', 'pipe'],
    })
    liveChildren.push(child)
    return child
}

const childResult = child =>
    new Promise(resolve => {
        let stdout = ''
        let stderr = ''
        child.stdout?.on('data', chunk => (stdout += chunk))
        child.stderr?.on('data', chunk => (stderr += chunk))
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve({ code: child.exitCode, signal: child.signalCode, stdout, stderr })
        } else {
            child.once('exit', (code, signal) => resolve({ code, signal, stdout, stderr }))
        }
    })

test('simultaneous first allocation gives two worktrees distinct stable bundles', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    const children = fixture.roots.map(cwd =>
        spawn(process.execPath, [cli, 'dev-allocate'], {
            cwd,
            env: environmentFor(fixture),
            stdio: ['ignore', 'pipe', 'pipe'],
        }),
    )
    liveChildren.push(...children)
    const results = await Promise.all(children.map(childResult))
    results.forEach(result => assert.equal(result.code, 0, result.stderr))
    const allocations = results.map(result => JSON.parse(result.stdout))
    assert.notDeepEqual(allocations[0].bundle, allocations[1].bundle)
    const reused = runJson(fixture, fixture.roots[0], ['dev-allocate'])
    assert.deepEqual(reused.bundle, allocations[0].bundle)
    assert.equal(reused.worktreeId, allocations[0].worktreeId)
})

test('the instance manager allocates before dependencies are installed', async () => {
    const fixture = await createFixture()
    const copiedTools = join(fixture.main, 'tools', 'dev-instance')
    await cp(join(repositoryRoot, 'tools', 'dev-instance'), copiedTools, { recursive: true })

    const result = spawnSync(process.execPath, [join(copiedTools, 'cli.mjs'), 'dev-allocate'], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        encoding: 'utf8',
    })

    assert.equal(result.status, 0, result.stderr)
    assert.ok(JSON.parse(result.stdout).worktreeId)
})

test('dev-list reports development allocations across worktrees', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    for (const worktree of fixture.roots) runJson(fixture, worktree, ['dev-allocate'])

    const listed = runJson(fixture, fixture.main, ['dev-list', '--json'])
    const canonicalRoots = await Promise.all(fixture.roots.map(worktree => realpath(worktree)))
    assert.deepEqual(listed.instances.map(instance => instance.path).sort(), canonicalRoots.sort())
    const slots = listed.instances.map(instance => instance.slot)
    assert.ok(slots.every(Number.isSafeInteger))
    assert.notEqual(slots[0], slots[1])

    const human = run(fixture, fixture.main, ['dev-list'])
    assert.equal(human.status, 0, human.stderr)
    for (const worktree of canonicalRoots) assert.match(human.stdout, new RegExp(worktree))
})

test('allocator prefers slot zero and skips a slot with one occupied IPv4 port', async () => {
    const fixture = await createFixture()
    await listen('127.0.0.1', 4200)
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    const slot = allocation.bundle.renderer - 4200
    assert.ok(slot > 0)
    assert.equal(allocation.bundle.cdp, 9222 + slot)
    assert.equal(allocation.bundle.inspector, 5858 + slot)
})

test('allocator detects an IPv6-only listener', async () => {
    const fixture = await createFixture()
    try {
        await listen('::1', 4200)
    } catch (error) {
        if (error?.code === 'EADDRNOTAVAIL') return
        throw error
    }
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    const slot = allocation.bundle.renderer - 4200
    assert.ok(slot > 0)
    assert.equal(allocation.bundle.cdp, 9222 + slot)
    assert.equal(allocation.bundle.inspector, 5858 + slot)
})

test('allocator skips a slot held by a wildcard IPv4 listener', async () => {
    const fixture = await createFixture()
    await listen('0.0.0.0', 4200)
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    assert.ok(allocation.bundle.renderer > 4200)
})

test('manual bundles must be complete and distinct', async () => {
    const fixture = await createFixture()
    const partial = run(fixture, fixture.main, ['dev-allocate'], {
        RELEASE_MAESTRO_RENDERER_PORT: '4310',
    })
    assert.equal(partial.status, 1)
    assert.match(partial.stderr, /PARTIAL_BUNDLE/)

    const allocation = runJson(fixture, fixture.main, ['dev-allocate'], {
        RELEASE_MAESTRO_RENDERER_PORT: '4310',
        RELEASE_MAESTRO_CDP_PORT: '9310',
        RELEASE_MAESTRO_INSPECTOR_PORT: '5910',
    })
    assert.deepEqual(allocation.bundle, { renderer: 4310, cdp: 9310, inspector: 5910 })
})

test('a complete manual override replaces an existing idle bundle', async () => {
    const fixture = await createFixture()
    const original = runJson(fixture, fixture.main, ['dev-allocate'])
    const changed = runJson(fixture, fixture.main, ['dev-allocate'], {
        RELEASE_MAESTRO_RENDERER_PORT: '4311',
        RELEASE_MAESTRO_CDP_PORT: '9311',
        RELEASE_MAESTRO_INSPECTOR_PORT: '5911',
    })
    assert.equal(changed.worktreeId, original.worktreeId)
    assert.deepEqual(changed.bundle, { renderer: 4311, cdp: 9311, inspector: 5911 })
})

test('automatic reallocation reserves the previous bundle while choosing its replacement', async () => {
    const fixture = await createFixture()
    const first = runJson(fixture, fixture.main, ['dev-allocate'])
    const second = runJson(fixture, fixture.main, ['dev-reallocate'])

    assert.notDeepEqual(second.bundle, first.bundle)
})

test('malformed registry, manifest, and interrupted write repair automatically', async () => {
    const fixture = await createFixture()
    await mkdir(fixture.state, { recursive: true })
    await writeFile(join(fixture.state, 'registry.json'), '{broken')
    await writeFile(join(fixture.state, 'registry.json.tmp-interrupted'), '{partial')
    await writeFile(join(fixture.main, '.release-maestro-instance.json'), '{broken')

    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    assert.ok(allocation.worktreeId)
    const stateFiles = await import('node:fs/promises').then(fs => fs.readdir(fixture.state))
    assert.ok(stateFiles.some(name => name.startsWith('registry.json.corrupt-')))
    const worktreeFiles = await import('node:fs/promises').then(fs => fs.readdir(fixture.main))
    assert.ok(worktreeFiles.some(name => name.startsWith('.release-maestro-instance.json.corrupt-')))
    assert.ok(existsSync(join(fixture.state, 'registry.json.tmp-interrupted')))
})

test('an abandoned registry lock is recovered after its heartbeat becomes stale', async () => {
    const fixture = await createFixture()
    const lock = join(fixture.state, 'registry.lock')
    await mkdir(lock, { recursive: true })
    const staleAt = new Date(Date.now() - 20_000)
    await utimes(lock, staleAt, staleAt)

    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])

    assert.ok(allocation.worktreeId)
    assert.equal(existsSync(lock), false)
})

test('an invalid allocation timestamp quarantines both registry copies', async () => {
    const fixture = await createFixture()
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    const registryPath = join(fixture.state, 'registry.json')
    const backupPath = join(fixture.state, 'registry.backup.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    registry.allocations[allocation.worktreeId].inactiveSince = 'not-a-date'
    await writeFile(registryPath, JSON.stringify(registry))
    await writeFile(backupPath, JSON.stringify(registry))

    const status = runJson(fixture, fixture.main, ['dev-status', '--json'])
    const stateFiles = await import('node:fs/promises').then(fs => fs.readdir(fixture.state))

    assert.equal(status.state, 'reclaimable')
    assert.equal(stateFiles.filter(name => name.includes('.corrupt-')).length, 2)
})

test('forced release finds its allocation when the worktree manifest is missing', async () => {
    const fixture = await createFixture()
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    await rm(join(fixture.main, '.release-maestro-instance.json'))

    const released = runJson(fixture, fixture.main, ['dev-release', '--force'])
    assert.equal(released.released, true)
    const registry = JSON.parse(await readFile(join(fixture.state, 'registry.json'), 'utf8'))
    assert.equal(registry.allocations[allocation.worktreeId], undefined)
})

test('registry recovery keeps live ownership from the last known good copy', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const wrapper = spawnMcp(fixture, fixture.main, bin)
    const active = await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json'])),
        status => status.holders?.length === 1,
        'MCP holder did not register',
    )
    await writeFile(join(fixture.state, 'registry.json'), '{broken')

    const recovered = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(recovered.holders.length, 1)
    assert.equal(recovered.holders[0].id, active.holders[0].id)
    assert.equal(recovered.holders[0].pid, wrapper.pid)
    wrapper.kill('SIGTERM')
    await childResult(wrapper)
})

test('registry recovery selects the valid copy with the highest generation', async () => {
    const fixture = await createFixture()
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    const registryPath = join(fixture.state, 'registry.json')
    const backupPath = join(fixture.state, 'registry.backup.json')
    const primary = JSON.parse(await readFile(registryPath, 'utf8'))
    const backup = structuredClone(primary)
    primary.allocations[allocation.worktreeId].branch = 'older-primary'
    backup.generation += 1
    backup.allocations[allocation.worktreeId].branch = 'newer-backup'
    await writeFile(registryPath, JSON.stringify(primary))
    await writeFile(backupPath, JSON.stringify(backup))

    const listed = runJson(fixture, fixture.main, ['dev-list', '--json'])

    assert.equal(listed.instances[0].branch, 'newer-backup')
})

test('a stale manifest generation follows the authoritative registry', async () => {
    const fixture = await createFixture()
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    const manifestPath = join(fixture.main, '.release-maestro-instance.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.registryGeneration = 0
    manifest.bundle = { renderer: 4301, cdp: 9301, inspector: 5901 }
    await writeFile(manifestPath, JSON.stringify(manifest))
    const status = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(status.worktreeId, allocation.worktreeId)
    assert.deepEqual(status.bundle, allocation.bundle)
    const refreshed = JSON.parse(await readFile(manifestPath, 'utf8'))
    assert.deepEqual(refreshed.bundle, allocation.bundle)
    assert.ok(refreshed.registryGeneration > 0)
})

test('a missed heartbeat reports degraded health while preserving a live holder', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const wrapper = spawnMcp(fixture, fixture.main, bin)
    const active = await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json'])),
        status => status.holders?.length === 1,
        'MCP holder did not register',
    )
    const registryPath = join(fixture.state, 'registry.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    registry.generation += 1
    registry.allocations[active.worktreeId].holders[0].heartbeatAt = '2000-01-01T00:00:00.000Z'
    await writeFile(registryPath, JSON.stringify(registry))
    const degraded = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(degraded.health, 'degraded')
    assert.equal(degraded.holders[0].pid, wrapper.pid)
    wrapper.kill('SIGTERM')
    await childResult(wrapper)
})

test('moving a worktree keeps its identity while a new checkout at the old path gets a new one', async () => {
    const fixture = await createFixture()
    const first = runJson(fixture, fixture.main, ['dev-allocate'])
    git(fixture.main, ['checkout', '-qb', 'renamed-branch'])
    const afterBranchChange = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(afterBranchChange.worktreeId, first.worktreeId)
    assert.equal(afterBranchChange.branch, 'renamed-branch')
    const moved = join(fixture.base, 'moved')
    await rename(fixture.main, moved)
    const afterMove = runJson(fixture, moved, ['dev-allocate'])
    assert.equal(afterMove.worktreeId, first.worktreeId)
    assert.equal(afterMove.appDataPath, join(await realpath(moved), '.app-data.dev'))

    await mkdir(fixture.main)
    git(fixture.main, ['init', '-q'])
    const replacement = runJson(fixture, fixture.main, ['dev-allocate'])
    assert.notEqual(replacement.worktreeId, first.worktreeId)
})

test('a copied manifest does not attach another worktree to the original allocation', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    const first = runJson(fixture, fixture.roots[0], ['dev-allocate'])
    await cp(
        join(fixture.roots[0], '.release-maestro-instance.json'),
        join(fixture.roots[1], '.release-maestro-instance.json'),
    )

    const second = runJson(fixture, fixture.roots[1], ['dev-allocate'])
    const firstAfterCopy = runJson(fixture, fixture.roots[0], ['dev-status', '--json'])

    assert.notEqual(second.worktreeId, first.worktreeId)
    assert.notDeepEqual(second.bundle, first.bundle)
    assert.equal(firstAfterCopy.path, await realpath(fixture.roots[0]))
})

test('a copied manifest cannot inspect, release, or stop another worktree allocation', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    const first = runJson(fixture, fixture.roots[0], ['dev-allocate'])
    await cp(
        join(fixture.roots[0], '.release-maestro-instance.json'),
        join(fixture.roots[1], '.release-maestro-instance.json'),
    )

    for (const command of ['dev-status', 'dev-release', 'dev-stop']) {
        const result = run(fixture, fixture.roots[1], [command])
        assert.notEqual(result.status, 0, command)
        assert.match(result.stderr, /MANIFEST_OWNERSHIP_CONFLICT/)
        const original = runJson(fixture, fixture.roots[0], ['dev-status', '--json'])
        assert.equal(original.worktreeId, first.worktreeId)
        assert.equal(original.path, await realpath(fixture.roots[0]))
    }
})

test('a copied manifest cannot lend another worktree identity to a workflow', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    const original = runJson(fixture, fixture.roots[0], ['dev-allocate'])
    await cp(
        join(fixture.roots[0], '.release-maestro-instance.json'),
        join(fixture.roots[1], '.release-maestro-instance.json'),
    )
    const workflow = spawn(
        process.execPath,
        [cli, 'run-workflow', 'renderer-e2e', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        { cwd: fixture.roots[1], env: environmentFor(fixture), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    liveChildren.push(workflow)
    const listed = await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.roots[0], ['dev-list', '--json'])),
        value => value.instances.some(instance => instance.workflow === 'renderer-e2e'),
        'workflow did not register',
    )
    const transient = listed.instances.find(instance => instance.workflow === 'renderer-e2e')
    assert.notEqual(transient.worktreeId, original.worktreeId)
    assert.equal(transient.path, await realpath(fixture.roots[1]))
    workflow.kill('SIGTERM')
    await childResult(workflow)
})

test('forced release with a copied manifest only releases the current worktree', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    const first = runJson(fixture, fixture.roots[0], ['dev-allocate'])
    const second = runJson(fixture, fixture.roots[1], ['dev-allocate'])
    await cp(
        join(fixture.roots[0], '.release-maestro-instance.json'),
        join(fixture.roots[1], '.release-maestro-instance.json'),
    )
    const released = runJson(fixture, fixture.roots[1], ['dev-release', '--force'])
    assert.equal(released.released, true)
    const listed = runJson(fixture, fixture.roots[0], ['dev-list', '--json'])
    assert.ok(listed.instances.some(instance => instance.worktreeId === first.worktreeId))
    assert.equal(
        listed.instances.some(instance => instance.worktreeId === second.worktreeId),
        false,
    )
})

test('a persisted port taken by an unrelated process fails with owner and reallocation details', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'], {
        RELEASE_MAESTRO_RENDERER_PORT: '4310',
        RELEASE_MAESTRO_CDP_PORT: '9310',
        RELEASE_MAESTRO_INSPECTOR_PORT: '5910',
    })
    await listen('127.0.0.1', allocation.bundle.cdp)
    const wrapper = spawnMcp(fixture, fixture.main, bin)
    const result = await childResult(wrapper)
    assert.equal(result.code, 1)
    assert.match(result.stderr, new RegExp(`PID ${process.pid}.*process start.*make dev-reallocate`))

    const reallocated = runJson(fixture, fixture.main, ['dev-reallocate'])
    assert.notDeepEqual(reallocated.bundle, allocation.bundle)
})

test('MCP wrapper resolves the worktree endpoint, propagates exit code, and cleans its holder', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const capture = join(fixture.base, 'args.json')
    const child = spawnMcp(fixture, fixture.main, bin, 'chrome-devtools', {
        FAKE_CAPTURE: capture,
        FAKE_DELAY_MS: '20',
        FAKE_EXIT_CODE: '7',
    })
    const result = await childResult(child)
    assert.equal(result.code, 7, result.stderr)
    const args = JSON.parse(await readFile(capture, 'utf8'))
    const status = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.ok(args.includes(`http://127.0.0.1:${status.bundle.cdp}`))
    assert.equal(status.state, 'inactive')
    assert.deepEqual(status.holders, [])
})

test('MCP wrapper reports and logs package-manager startup failures', async () => {
    const fixture = await createFixture()
    const child = spawn(process.execPath, [mcpWrapper, 'chrome-devtools'], {
        cwd: fixture.main,
        env: environmentFor(fixture, {
            RELEASE_MAESTRO_PNPM_COMMAND: join(fixture.base, 'missing-pnpm'),
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.push(child)

    const result = await childResult(child)
    assert.equal(result.code, 1)
    assert.match(result.stderr, /MCP wrapper failed: spawn .*missing-pnpm ENOENT/)
    const log = await readFile(join(fixture.state, 'orchestration.jsonl'), 'utf8')
    assert.match(log, /"event":"mcp-wrapper-failed"/)
})

test('MCP wrapper forwards signals and dev-stop leaves unrelated processes alive', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const signalCapture = join(fixture.base, 'signal.txt')
    const wrapper = spawnMcp(fixture, fixture.main, bin, 'playwright', {
        FAKE_SIGNAL_CAPTURE: signalCapture,
    })
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    liveChildren.push(unrelated)
    await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json'])),
        status => status.holders?.length === 1,
        'MCP holder did not register',
    )
    const stopped = runJson(fixture, fixture.main, ['dev-stop'])
    assert.equal(stopped.stopped.length, 1)
    const result = await childResult(wrapper)
    assert.equal(result.code, 0)
    assert.equal((await readFile(signalCapture, 'utf8')).trim(), 'SIGTERM')
    assert.equal(unrelated.exitCode, null)
})

test('dev-stop lets the supervisor reap its managed processes', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const dev = spawn(process.execPath, [cli, 'run-dev'], {
        cwd: fixture.main,
        env: environmentFor(fixture, {
            PATH: `${bin}:${process.env.PATH}`,
            RELEASE_MAESTRO_PNPM_COMMAND: join(bin, 'pnpm'),
            FAKE_OPEN_PORT: '1',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.push(dev)
    await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json'])),
        status => status.holders?.length === 5,
        'dev stack did not finish registering its holders',
    )

    const startedAt = Date.now()
    const stopped = runJson(fixture, fixture.main, ['dev-stop'])
    const stopDurationMs = Date.now() - startedAt
    await childResult(dev)
    const status = runJson(fixture, fixture.main, ['dev-status', '--json'])
    const events = (await readFile(join(fixture.state, 'orchestration.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
    const request = events.findLast(event => event.event === 'dev-stop-requested')

    assert.ok(stopped.stopped.some(holder => holder.role === 'dev-supervisor'))
    assert.ok(stopDurationMs < 4_000, `dev-stop took ${stopDurationMs} ms`)
    assert.deepEqual(
        request.targets.map(holder => holder.role),
        ['dev-supervisor'],
    )
    assert.equal(status.state, 'inactive')
    assert.deepEqual(status.holders, [])
})

test('several MCP sessions share one allocation and release-when-idle waits for the last holder', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const first = spawnMcp(fixture, fixture.main, bin)
    const second = spawnMcp(fixture, fixture.main, bin)
    await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json'])),
        status => status.holders?.length === 2,
        'holders did not register',
    )
    const hookResult = spawnSync(process.execPath, [hook], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        input: JSON.stringify({ hook_event_name: 'SessionEnd', cwd: fixture.main, reason: 'other' }),
        encoding: 'utf8',
    })
    assert.equal(hookResult.status, 0, hookResult.stderr)
    first.kill('SIGTERM')
    await childResult(first)
    const active = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(active.state, 'active')
    assert.equal(active.holders.length, 1)
    const forced = run(fixture, fixture.main, ['dev-release', '--force'])
    assert.equal(forced.status, 1)
    assert.match(forced.stderr, /LIVE_HOLDERS/)
    second.kill('SIGTERM')
    await childResult(second)
    const released = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(released.state, 'reclaimable')
})

test('Claude clear keeps an idle allocation for the continuing session', async () => {
    const fixture = await createFixture()
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    for (const payload of [
        { hook_event_name: 'SessionEnd', reason: 'clear' },
        { hook_event_name: 'SessionStart', source: 'clear' },
    ]) {
        const result = spawnSync(process.execPath, [hook], {
            cwd: fixture.main,
            env: environmentFor(fixture),
            input: JSON.stringify({ ...payload, cwd: fixture.main }),
            encoding: 'utf8',
        })
        assert.equal(result.status, 0, result.stderr)
    }
    const status = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(status.worktreeId, allocation.worktreeId)
    assert.equal(status.state, 'reserved')
})

test('Claude WorktreeRemove releases only after the directory is gone', async () => {
    const fixture = await createFixture()
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    const hookResult = spawnSync(process.execPath, [hook], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        input: JSON.stringify({
            hook_event_name: 'WorktreeRemove',
            cwd: fixture.main,
            worktree_path: fixture.main,
        }),
        encoding: 'utf8',
    })
    assert.equal(hookResult.status, 0, hookResult.stderr)
    let registry = JSON.parse(await readFile(join(fixture.state, 'registry.json'), 'utf8'))
    assert.ok(registry.allocations[allocation.worktreeId])
    await rm(fixture.main, { recursive: true, force: true })
    registry = await waitFor(
        async () => JSON.parse(await readFile(join(fixture.state, 'registry.json'), 'utf8')),
        value => !value.allocations[allocation.worktreeId],
        'removed worktree allocation was not released',
    )
    assert.equal(registry.allocations[allocation.worktreeId], undefined)
})

test('a delayed removal for an old path keeps the allocation at its current path', async () => {
    const fixture = await createFixture()
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    const removedPath = join(fixture.base, 'old-worktree-path')

    const result = spawnSync(process.execPath, [hook, 'verify-remove', removedPath, allocation.worktreeId], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        encoding: 'utf8',
    })
    const registry = JSON.parse(await readFile(join(fixture.state, 'registry.json'), 'utf8'))

    assert.equal(result.status, 0, result.stderr)
    assert.ok(registry.allocations[allocation.worktreeId])
})

test('removed worktree release resolves a symlinked parent path', async () => {
    const fixture = await createFixture()
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    const alias = join(fixture.base, 'alias')
    await symlink(fixture.base, alias, process.platform === 'win32' ? 'junction' : 'dir')
    await rm(fixture.main, { recursive: true, force: true })
    const result = spawnSync(
        process.execPath,
        [hook, 'verify-remove', join(alias, 'main'), allocation.worktreeId],
        {
            cwd: fixture.base,
            env: environmentFor(fixture),
            encoding: 'utf8',
        },
    )
    assert.equal(result.status, 0, result.stderr)
    const registry = JSON.parse(await readFile(join(fixture.state, 'registry.json'), 'utf8'))
    assert.equal(registry.allocations[allocation.worktreeId], undefined)
})

test('zero grace expires an inactive allocation and permits reassignment', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    const bin = await createFakePnpm(fixture)
    const first = spawnMcp(fixture, fixture.roots[0], bin, 'chrome-devtools', {
        FAKE_DELAY_MS: '20',
        RELEASE_MAESTRO_INSTANCE_GRACE_MS: '0',
    })
    await childResult(first)
    const expired = runJson(fixture, fixture.roots[0], ['dev-status', '--json'], {
        RELEASE_MAESTRO_INSTANCE_GRACE_MS: '0',
    })
    assert.equal(expired.state, 'reclaimable')
    const reassigned = runJson(fixture, fixture.roots[1], ['dev-allocate'], {
        RELEASE_MAESTRO_INSTANCE_GRACE_MS: '0',
    })
    assert.equal(reassigned.bundle.renderer, 4200)
})

test('configured nonzero grace keeps an inactive allocation and reports expiration', async () => {
    const fixture = await createFixture()
    await mkdir(fixture.state, { recursive: true })
    await writeFile(join(fixture.state, 'settings.json'), JSON.stringify({ graceMs: 60_000 }))
    const bin = await createFakePnpm(fixture)
    const wrapper = spawnMcp(fixture, fixture.main, bin, 'chrome-devtools', {
        FAKE_DELAY_MS: '20',
    })
    await childResult(wrapper)
    const status = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(status.state, 'inactive')
    assert.equal(Date.parse(status.expiresAt) - Date.parse(status.inactiveSince), 60_000)
})

test('invalid global grace settings fail with a configuration error', async () => {
    const fixture = await createFixture()
    runJson(fixture, fixture.main, ['dev-allocate'])
    await mkdir(fixture.state, { recursive: true })
    await writeFile(join(fixture.state, 'settings.json'), '{"graceMs":"0x10"}')
    const result = run(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(result.status, 1)
    assert.match(result.stderr, /INVALID_CONFIG.*graceMs/)
})

test('Electron E2E coexists with renderer E2E but duplicate mutating workflows fail', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    const hold = [process.execPath, '-e', 'setInterval(() => {}, 1000)']
    const electron = spawn(process.execPath, [cli, 'run-workflow', 'electron-e2e', '--', ...hold], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.push(electron)
    const electronRegistry = await waitFor(
        async () => JSON.parse(await readFile(join(fixture.state, 'registry.json'), 'utf8')),
        registry =>
            Object.values(registry.transients).some(
                item => item.workflow === 'electron-e2e' && item.childHolder?.pid !== undefined,
            ),
        'Electron E2E did not allocate',
    )
    const electronTransient = Object.values(electronRegistry.transients).find(
        item => item.workflow === 'electron-e2e',
    )
    assert.notEqual(electronTransient.childHolder.pid, electron.pid)
    const renderer = spawn(process.execPath, [cli, 'run-workflow', 'renderer-e2e', '--', ...hold], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.push(renderer)
    await waitFor(
        async () => JSON.parse(await readFile(join(fixture.state, 'registry.json'), 'utf8')),
        registry => Object.keys(registry.transients).length === 2,
        'compatible renderer E2E did not allocate',
    )
    const otherWorktreeElectron = spawn(
        process.execPath,
        [cli, 'run-workflow', 'electron-e2e', '--', ...hold],
        {
            cwd: fixture.roots[1],
            env: environmentFor(fixture),
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    )
    liveChildren.push(otherWorktreeElectron)
    await waitFor(
        async () => JSON.parse(await readFile(join(fixture.state, 'registry.json'), 'utf8')),
        registry => Object.keys(registry.transients).length === 3,
        'the second worktree Electron E2E did not allocate',
    )
    const duplicate = run(fixture, fixture.main, ['run-workflow', 'electron-e2e', '--', ...hold])
    assert.equal(duplicate.status, 1)
    assert.match(duplicate.stderr, /RESOURCE_CONFLICT.*held by electron-e2e/)
    electron.kill('SIGTERM')
    await childResult(electron)
    renderer.kill('SIGTERM')
    await childResult(renderer)
    otherWorktreeElectron.kill('SIGTERM')
    await childResult(otherWorktreeElectron)
    const registry = await waitFor(
        async () => JSON.parse(await readFile(join(fixture.state, 'registry.json'), 'utf8')),
        value => Object.keys(value.transients).length === 0,
        'transient allocations were not released',
    )
    assert.deepEqual(registry.transients, {})
})

test('an MCP-only holder does not block Electron E2E', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const wrapper = spawnMcp(fixture, fixture.main, bin)
    await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json'])),
        status => status.holders?.some(holder => holder.role === 'mcp:chrome-devtools'),
        'MCP holder did not register',
    )

    const e2e = run(fixture, fixture.main, [
        'run-workflow',
        'electron-e2e',
        '--',
        process.execPath,
        '-e',
        'process.exit(0)',
    ])

    assert.equal(e2e.status, 0, e2e.stderr)
    wrapper.kill('SIGTERM')
    await childResult(wrapper)
})

test('a workflow tolerates a child that exits before holder registration', async () => {
    const fixture = await createFixture()
    const script = `
        import { allocateTransient, releaseTransient, setTransientChildHolder } from ${JSON.stringify(coreModule)}
        const transient = await allocateTransient('renderer-e2e')
        const registered = await setTransientChildHolder(transient.id, 2147483647)
        await releaseTransient(transient.id)
        if (registered) process.exit(2)
    `
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        encoding: 'utf8',
    })

    assert.equal(result.status, 0, result.stderr)
})

test('run-workflow stops descendants left behind by a successful launcher', async () => {
    const fixture = await createFixture()
    const descendantPidPath = join(fixture.base, 'descendant.pid')
    const launcher = `
        const { writeFileSync } = require('node:fs')
        const { spawn } = require('node:child_process')
        const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' })
        writeFileSync(${JSON.stringify(descendantPidPath)}, String(descendant.pid))
        descendant.unref()
    `
    const result = run(fixture, fixture.main, [
        'run-workflow',
        'renderer-e2e',
        '--',
        process.execPath,
        '-e',
        launcher,
    ])
    const descendantPid = Number(await readFile(descendantPidPath, 'utf8'))

    assert.equal(result.status, 0, result.stderr)
    await waitFor(
        () =>
            Promise.resolve().then(() => {
                try {
                    process.kill(descendantPid, 0)
                    return true
                } catch (error) {
                    if (error?.code === 'ESRCH') return false
                    throw error
                }
            }),
        alive => !alive,
        'workflow descendant was left running',
    )
})

test('run-workflow passes separators and shell metacharacters as literal child arguments', async () => {
    const fixture = await createFixture()
    const result = run(fixture, fixture.main, [
        'run-workflow',
        'renderer-e2e',
        '--',
        process.execPath,
        '-e',
        'process.exit(process.argv[1] === "--then" && process.argv[2] === "value with spaces & pipes | literally" ? 0 : 9)',
        '--',
        '--literal',
        '--then',
        'value with spaces & pipes | literally',
    ])
    assert.equal(result.status, 0, result.stderr)
})

test('run-workflow launches pnpm from npm_execpath with Node', async () => {
    const fixture = await createFixture()
    const pnpmScript = join(fixture.base, 'pnpm.cjs')
    await writeFile(
        pnpmScript,
        'process.exit(process.argv.slice(2).join(" ") === "exec playwright --version" ? 0 : 9)',
    )
    await chmod(pnpmScript, 0o644)
    const result = run(
        fixture,
        fixture.main,
        ['run-workflow', 'renderer-e2e', '--', 'playwright', '--version'],
        {
            npm_execpath: pnpmScript,
            RELEASE_MAESTRO_PNPM_COMMAND: '',
        },
    )
    assert.equal(result.status, 0, result.stderr)
})

test('run-workflow does not launch a chained command after cancellation', async () => {
    const fixture = await createFixture()
    const ready = join(fixture.base, 'first-ready')
    const secondRan = join(fixture.base, 'second-ran')
    const workflow = spawn(
        process.execPath,
        [
            cli,
            'run-workflow',
            'renderer-e2e',
            '--',
            process.execPath,
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(ready)}, ''); process.on('SIGTERM', () => process.exit(0)); setInterval(() => {}, 1000)`,
            '--then',
            process.execPath,
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(secondRan)}, '')`,
        ],
        {
            cwd: fixture.main,
            env: environmentFor(fixture),
            stdio: ['ignore', 'pipe', 'pipe'],
        },
    )
    liveChildren.push(workflow)
    await waitFor(() => Promise.resolve(existsSync(ready)), Boolean, 'first command did not start')

    workflow.kill('SIGTERM')
    const result = await childResult(workflow)

    assert.equal(result.code, 143)
    assert.equal(result.signal, null)
    assert.equal(existsSync(secondRan), false)
})

test('MCP wrapper exits when its child ignores termination', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const capture = join(fixture.base, 'mcp-started')
    const wrapper = spawnMcp(fixture, fixture.main, bin, 'chrome-devtools', {
        FAKE_IGNORE_SIGTERM: '1',
        FAKE_CAPTURE: capture,
    })
    await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json'])),
        status => status.holders?.length === 1,
        'MCP holder did not register',
    )
    await waitFor(() => Promise.resolve(existsSync(capture)), Boolean, 'MCP child did not start')
    wrapper.kill('SIGTERM')
    const result = await childResult(wrapper)
    assert.equal(result.code, 143)
    const status = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.deepEqual(status.holders, [])
})

test('workflow releases its claim when a child ignores termination', async () => {
    const fixture = await createFixture()
    const ready = join(fixture.base, 'workflow-started')
    const workflow = spawn(
        process.execPath,
        [
            cli,
            'run-workflow',
            'renderer-e2e',
            '--',
            process.execPath,
            '-e',
            `require('node:fs').writeFileSync(${JSON.stringify(ready)}, ''); process.on('SIGTERM', () => {}); setInterval(() => {}, 1000)`,
        ],
        { cwd: fixture.main, env: environmentFor(fixture), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    liveChildren.push(workflow)
    await waitFor(() => Promise.resolve(existsSync(ready)), Boolean, 'workflow child did not start')
    workflow.kill('SIGTERM')
    const result = await childResult(workflow)
    assert.equal(result.code, 143)
    const instances = runJson(fixture, fixture.main, ['dev-list', '--json'])
    assert.equal(
        instances.instances.some(instance => instance.workflow === 'renderer-e2e'),
        false,
    )
})

test('wrappers exit after a signal while waiting for the registry lock', async () => {
    const fixture = await createFixture()
    await mkdir(join(fixture.state, 'registry.lock'), { recursive: true })
    const bin = await createFakePnpm(fixture)
    const mcp = spawnMcp(fixture, fixture.main, bin)
    const workflow = spawn(
        process.execPath,
        [cli, 'run-workflow', 'renderer-e2e', '--', process.execPath, '-e', 'setInterval(() => {}, 1000)'],
        { cwd: fixture.main, env: environmentFor(fixture), stdio: ['ignore', 'pipe', 'pipe'] },
    )
    liveChildren.push(workflow)
    await new Promise(resolve => setTimeout(resolve, 250))
    mcp.kill('SIGTERM')
    workflow.kill('SIGTERM')
    const results = await Promise.all([childResult(mcp), childResult(workflow)])
    assert.deepEqual(
        results.map(result => result.code),
        [143, 143],
    )
})

test('development startup rejects an invalid deadline before allocating', async () => {
    const fixture = await createFixture()
    const result = run(fixture, fixture.main, ['run-dev'], {
        RELEASE_MAESTRO_STARTUP_TIMEOUT_MS: 'not-a-number',
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /INVALID_CONFIG.*RELEASE_MAESTRO_STARTUP_TIMEOUT_MS/)
    assert.equal(runJson(fixture, fixture.main, ['dev-status', '--json']).state, 'unallocated')
})

test('dev conflicts with Electron E2E and a second dev supervisor reports its owner', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const dev = spawn(process.execPath, [cli, 'run-dev'], {
        cwd: fixture.main,
        env: environmentFor(fixture, {
            PATH: `${bin}:${process.env.PATH}`,
            RELEASE_MAESTRO_PNPM_COMMAND: join(bin, 'pnpm'),
            FAKE_OPEN_PORT: '1',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.push(dev)
    let devStderr = ''
    dev.stderr.on('data', chunk => (devStderr += chunk))
    const status = await waitFor(
        () => {
            if (dev.exitCode !== null || dev.signalCode !== null) assert.fail(devStderr)
            return Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json']))
        },
        value => value.holders?.some(holder => holder.role === 'dev-electron'),
        'dev stack did not start',
    )
    const duplicate = run(fixture, fixture.main, ['run-dev'], {
        PATH: `${bin}:${process.env.PATH}`,
        RELEASE_MAESTRO_PNPM_COMMAND: join(bin, 'pnpm'),
        FAKE_OPEN_PORT: '1',
    })
    assert.equal(duplicate.status, 1)
    assert.match(duplicate.stderr, /DUPLICATE_WORKFLOW/)
    assert.ok(status.holders.some(holder => duplicate.stderr.includes(`PID ${holder.pid}`)))
    const e2e = run(fixture, fixture.main, [
        'run-workflow',
        'electron-e2e',
        '--',
        process.execPath,
        '-e',
        'process.exit(0)',
    ])
    assert.equal(e2e.status, 1)
    assert.match(e2e.stderr, /RESOURCE_CONFLICT.*electron-development-bundle/)
    dev.kill('SIGTERM')
    await childResult(dev)
})

test('run-dev exits promptly when the renderer dies before opening its port', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture, 'bin with spaces')
    const capture = join(fixture.base, 'pnpm-arguments.json')
    const startedAt = Date.now()
    const result = run(fixture, fixture.main, ['run-dev'], {
        PATH: `${bin}:${process.env.PATH}`,
        RELEASE_MAESTRO_PNPM_COMMAND: join(bin, 'pnpm'),
        FAKE_CAPTURE: capture,
        FAKE_DELAY_MS: '3000',
    })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /RENDERER_START_FAILED/)
    assert.deepEqual(JSON.parse(await readFile(capture, 'utf8')).slice(0, 3), ['exec', 'nx', 'serve'])
    assert.ok(Date.now() - startedAt < 10_000, 'startup failure waited for the port timeout')
})

test('run-dev latches cancellation while waiting for the renderer', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const capture = join(fixture.base, 'pnpm-arguments.json')
    const dev = spawn(process.execPath, [cli, 'run-dev'], {
        cwd: fixture.main,
        env: environmentFor(fixture, {
            PATH: `${bin}:${process.env.PATH}`,
            RELEASE_MAESTRO_PNPM_COMMAND: join(bin, 'pnpm'),
            FAKE_CAPTURE: capture,
            FAKE_IGNORE_SIGTERM: '1',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.push(dev)
    await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json'])),
        status => status.holders?.some(holder => holder.role === 'dev-renderer'),
        'renderer holder did not register',
    )

    dev.kill('SIGTERM')
    const result = await Promise.race([
        childResult(dev),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('run-dev did not honor cancellation')), 8_000),
        ),
    ])

    assert.equal(result.code, 143, result.stderr)
    assert.ok(JSON.parse(await readFile(capture, 'utf8')).includes('maestro-renderer'))
})

test('run-dev escalates cancellation after both launchers are ready', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const dev = spawn(process.execPath, [cli, 'run-dev'], {
        cwd: fixture.main,
        env: environmentFor(fixture, {
            PATH: `${bin}:${process.env.PATH}`,
            RELEASE_MAESTRO_PNPM_COMMAND: join(bin, 'pnpm'),
            FAKE_IGNORE_SIGTERM: '1',
            FAKE_OPEN_PORT: '1',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.push(dev)
    await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json'])),
        status => status.holders?.filter(holder => holder.role === 'dev-electron').length === 2,
        'Electron listeners did not register',
    )

    dev.kill('SIGTERM')
    const result = await Promise.race([
        childResult(dev),
        new Promise((_, reject) =>
            setTimeout(() => reject(new Error('run-dev did not escalate cancellation')), 8_000),
        ),
    ])

    assert.equal(result.code, 143, result.stderr)
})

test('run-dev reports a missing renderer launcher through its cleanup path', async () => {
    const fixture = await createFixture()
    const result = run(fixture, fixture.main, ['run-dev'], {
        RELEASE_MAESTRO_PNPM_COMMAND: join(fixture.base, 'missing-pnpm'),
    })

    assert.equal(result.status, 1)
    assert.match(result.stderr, /RENDERER_START_FAILED/)
    assert.doesNotMatch(result.stderr, /Unhandled 'error' event/)
})

test('an orphaned live listener remains an owner and dev-stop terminates it', async () => {
    const fixture = await createFixture()
    const bin = await createFakePnpm(fixture)
    const dev = spawn(process.execPath, [cli, 'run-dev'], {
        cwd: fixture.main,
        env: environmentFor(fixture, {
            PATH: `${bin}:${process.env.PATH}`,
            RELEASE_MAESTRO_PNPM_COMMAND: join(bin, 'pnpm'),
            FAKE_OPEN_PORT: '1',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.push(dev)
    let devStderr = ''
    dev.stderr.on('data', chunk => (devStderr += chunk))
    const active = await waitFor(
        () => {
            if (dev.exitCode !== null || dev.signalCode !== null) assert.fail(devStderr)
            return Promise.resolve(runJson(fixture, fixture.main, ['dev-status', '--json']))
        },
        status => status.holders?.filter(holder => holder.role === 'dev-electron').length === 2,
        'listener holder did not register',
        25_000,
    )
    const electronListener = active.holders.find(
        holder => holder.role === 'dev-electron' && holder.processGroup === undefined,
    )
    assert.ok(electronListener)

    dev.kill('SIGKILL')
    await childResult(dev)
    const orphaned = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.ok(orphaned.holders.some(holder => holder.id === electronListener.id))

    const stopped = runJson(fixture, fixture.main, ['dev-stop'])
    assert.ok(stopped.stopped.some(holder => holder.pid === electronListener.pid))
    const inactive = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.equal(inactive.state, 'inactive')
}, 45_000)

test('active worktrees cannot share a canonical app-data directory', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    const bin = await createFakePnpm(fixture)
    const shared = join(fixture.base, 'shared-data')
    runJson(fixture, fixture.roots[0], ['dev-allocate'], {
        RELEASE_MAESTRO_APP_DATA_DIR: shared,
    })
    runJson(fixture, fixture.roots[1], ['dev-allocate'], {
        RELEASE_MAESTRO_APP_DATA_DIR: join(shared, '..', 'shared-data'),
    })
    const first = spawnMcp(fixture, fixture.roots[0], bin, 'chrome-devtools', {
        RELEASE_MAESTRO_APP_DATA_DIR: shared,
    })
    const firstStatus = await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.roots[0], ['dev-status', '--json'])),
        status => status.state === 'active',
        'first worktree did not become active',
    )
    assert.equal(firstStatus.appDataPath, join(await realpath(fixture.base), 'shared-data'))
    const changedOverride = run(fixture, fixture.roots[0], ['dev-allocate'], {
        RELEASE_MAESTRO_APP_DATA_DIR: join(fixture.base, 'different-data'),
    })
    assert.equal(changedOverride.status, 1)
    assert.match(changedOverride.stderr, /APP_DATA_CONFLICT/)
    const second = spawnMcp(fixture, fixture.roots[1], bin, 'chrome-devtools', {
        RELEASE_MAESTRO_APP_DATA_DIR: join(shared, '..', 'shared-data'),
    })
    const result = await childResult(second)
    assert.equal(result.code, 1)
    assert.match(result.stderr, /Resource app-data:.*worktree/)
    first.kill('SIGTERM')
    await childResult(first)
})

test('dead or reused PIDs are reconciled without killing a live unrelated process', async () => {
    const fixture = await createFixture()
    const allocation = runJson(fixture, fixture.main, ['dev-allocate'])
    const unrelated = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'])
    liveChildren.push(unrelated)
    const registryPath = join(fixture.state, 'registry.json')
    const registry = JSON.parse(await readFile(registryPath, 'utf8'))
    registry.allocations[allocation.worktreeId].holders.push({
        id: 'reused-pid',
        role: 'dev-electron',
        pid: unrelated.pid,
        startIdentity: 'a different process start',
        heartbeatAt: new Date(0).toISOString(),
        worktreeId: allocation.worktreeId,
    })
    registry.allocations[allocation.worktreeId].wasActive = true
    await writeFile(registryPath, JSON.stringify(registry))
    const status = runJson(fixture, fixture.main, ['dev-status', '--json'])
    assert.deepEqual(status.holders, [])
    assert.equal(unrelated.exitCode, null)
})

test('logs redact sensitive query values, rotate, and render through dev-log', async () => {
    const fixture = await createFixture({ worktrees: 2 })
    const bin = await createFakePnpm(fixture)
    const shared = join(fixture.base, 'shared?token=very-secret')
    const first = spawnMcp(fixture, fixture.roots[0], bin, 'chrome-devtools', {
        RELEASE_MAESTRO_APP_DATA_DIR: shared,
        RELEASE_MAESTRO_INSTANCE_LOG_LIMIT_BYTES: '400',
    })
    await waitFor(
        () => Promise.resolve(runJson(fixture, fixture.roots[0], ['dev-status', '--json'])),
        status => status.state === 'active',
        'first holder did not register',
    )
    const failed = spawnMcp(fixture, fixture.roots[1], bin, 'chrome-devtools', {
        RELEASE_MAESTRO_APP_DATA_DIR: shared,
        RELEASE_MAESTRO_INSTANCE_LOG_LIMIT_BYTES: '400',
    })
    await childResult(failed)
    for (let index = 0; index < 8; index += 1) {
        run(fixture, fixture.roots[0], ['dev-status', '--json'], {
            RELEASE_MAESTRO_INSTANCE_LOG_LIMIT_BYTES: '400',
        })
    }
    const rendered = run(fixture, fixture.roots[0], ['dev-log'])
    assert.equal(rendered.status, 0, rendered.stderr)
    assert.match(rendered.stdout, /holder-registered|command-failed|mcp-wrapper-failed/)
    assert.match(rendered.stdout, /\n  [A-Za-z]+: /)
    const json = run(fixture, fixture.roots[0], ['dev-log', '--json'])
    assert.equal(json.status, 0, json.stderr)
    for (const line of json.stdout.trim().split('\n')) assert.ok(JSON.parse(line).event)
    const logs = await import('node:fs/promises').then(fs => fs.readdir(fixture.state))
    assert.ok(logs.some(name => name === 'orchestration.jsonl.1'))
    for (const name of logs.filter(name => name.startsWith('orchestration.jsonl'))) {
        assert.doesNotMatch(await readFile(join(fixture.state, name), 'utf8'), /very-secret/)
    }
    first.kill('SIGTERM')
    await childResult(first)
})

test('concurrent log writers keep attributed JSON lines intact', async () => {
    const fixture = await createFixture()
    const writers = Array.from({ length: 8 }, (_, index) =>
        spawn(
            process.execPath,
            [
                '--input-type=module',
                '-e',
                `import(${JSON.stringify(coreModule)}).then(m => m.logDiagnostic('writer', { writer: ${index} }))`,
            ],
            { cwd: fixture.main, env: environmentFor(fixture), stdio: ['ignore', 'pipe', 'pipe'] },
        ),
    )
    liveChildren.push(...writers)
    const results = await Promise.all(writers.map(childResult))
    assert.ok(
        results.every(result => result.code === 0),
        JSON.stringify(results),
    )
    const events = (await readFile(join(fixture.state, 'orchestration.jsonl'), 'utf8'))
        .trim()
        .split('\n')
        .map(line => JSON.parse(line))
        .filter(event => event.event === 'writer')
    assert.deepEqual(
        events.map(event => event.writer).sort((a, b) => a - b),
        [0, 1, 2, 3, 4, 5, 6, 7],
    )
})

test('dev-log follow restarts at the beginning of a rotated log', async () => {
    const fixture = await createFixture()
    await mkdir(fixture.state, { recursive: true })
    const log = join(fixture.state, 'orchestration.jsonl')
    await writeFile(log, `${JSON.stringify({ event: 'before-rotation', detail: 'x'.repeat(200) })}\n`)
    const follower = spawn(process.execPath, [cli, 'dev-log', '--follow', '--json'], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        stdio: ['ignore', 'pipe', 'pipe'],
    })
    liveChildren.push(follower)
    const followerResult = childResult(follower)
    let output = ''
    follower.stdout.on('data', chunk => (output += chunk))
    await waitFor(
        () => Promise.resolve(output),
        value => value.includes('before-rotation'),
        'log follower did not read the initial log',
    )

    await rename(log, `${log}.1`)
    await writeFile(log, `${JSON.stringify({ event: 'after-rotation', detail: 'y'.repeat(500) })}\n`)
    await waitFor(
        () => Promise.resolve(output),
        value => value.includes('after-rotation'),
        'log follower skipped the replacement log',
    )

    follower.kill('SIGTERM')
    await followerResult
})

test('hook failures are advisory', async () => {
    const fixture = await createFixture()
    const start = spawnSync(process.execPath, [hook], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        input: JSON.stringify({ hook_event_name: 'SessionStart', cwd: fixture.main, source: 'resume' }),
        encoding: 'utf8',
    })
    assert.equal(start.status, 0, start.stderr)
    assert.match(
        await readFile(join(fixture.state, 'orchestration.jsonl'), 'utf8'),
        /session-start-reconciled/,
    )
    const result = spawnSync(process.execPath, [hook], {
        cwd: fixture.main,
        env: environmentFor(fixture),
        input: '{not json',
        encoding: 'utf8',
    })
    assert.equal(result.status, 0)
})

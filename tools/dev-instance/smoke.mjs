#!/usr/bin/env node

import { chmod, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn, spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const temporaryRoot = await mkdtemp(join(tmpdir(), 'release-maestro-two-worktree-'))
const stateDir = join(temporaryRoot, 'state')
const shimBin = join(temporaryRoot, 'bin')
const worktrees = [join(temporaryRoot, 'one'), join(temporaryRoot, 'two')]
const processes = []
const shellQuote = value => `'${value.replaceAll("'", `'"'"'`)}'`

await import('node:fs/promises').then(fs => fs.mkdir(shimBin))
const pnpmShim = join(shimBin, 'pnpm')
await writeFile(
    pnpmShim,
    `#!/bin/sh
if [ "$1" = "exec" ]; then shift; fi
command="$1"
shift
exec ${shellQuote(`${repositoryRoot}/node_modules/.bin`)}"/$command" "$@"
`,
)
await chmod(pnpmShim, 0o755)

const environment = {
    ...process.env,
    CI: '1',
    PATH: `${shimBin}:${process.env.PATH}`,
    RELEASE_MAESTRO_PNPM_COMMAND: pnpmShim,
    RELEASE_MAESTRO_INSTANCE_STATE_DIR: stateDir,
}

const git = args => {
    const result = spawnSync('git', ['-C', repositoryRoot, ...args], { encoding: 'utf8' })
    if (result.status !== 0) throw new Error(result.stderr || `git ${args.join(' ')} failed`)
}

const readAllocation = async worktree => {
    const manifest = JSON.parse(await readFile(join(worktree, '.release-maestro-instance.json'), 'utf8'))
    const registry = JSON.parse(await readFile(join(stateDir, 'registry.json'), 'utf8'))
    return registry.allocations[manifest.worktreeId] ?? null
}

const waitFor = async (description, read) => {
    const deadline = Date.now() + 180_000
    let lastError
    while (Date.now() < deadline) {
        try {
            const value = await read()
            if (value) return value
        } catch (error) {
            lastError = error
        }
        await new Promise(resolve => setTimeout(resolve, 500))
    }
    throw new Error(`Timed out waiting for ${description}${lastError ? `: ${lastError.message}` : ''}`)
}

const stop = async (processHandle, cwd) => {
    if (processHandle.exitCode === null && processHandle.signalCode === null) processHandle.kill('SIGTERM')
    await Promise.race([
        new Promise(resolve => processHandle.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, 5_000)),
    ])
    if (processHandle.exitCode === null && processHandle.signalCode === null) {
        spawnSync(process.execPath, [join(cwd, 'tools/dev-instance/cli.mjs'), 'dev-stop'], {
            cwd,
            env: environment,
            stdio: 'inherit',
        })
        processHandle.kill('SIGKILL')
    }
}

try {
    for (const worktree of worktrees) {
        git(['worktree', 'add', '--detach', worktree, 'HEAD'])
        await symlink(join(repositoryRoot, 'node_modules'), join(worktree, 'node_modules'), 'dir')
    }

    for (const worktree of worktrees) {
        const child = spawn('make', [`PNPM=${pnpmShim}`, 'dev'], {
            cwd: worktree,
            env: environment,
            stdio: ['ignore', 'pipe', 'pipe'],
        })
        child.stdout.pipe(process.stdout)
        child.stderr.pipe(process.stderr)
        processes.push(child)
    }

    const statuses = await Promise.all(
        worktrees.map(worktree =>
            waitFor(`${worktree} dev stack`, async () => {
                const status = await readAllocation(worktree)
                return status?.holders.some(holder => holder.role === 'dev-electron') ? status : null
            }),
        ),
    )
    if (JSON.stringify(statuses[0].bundle) === JSON.stringify(statuses[1].bundle)) {
        throw new Error('The worktrees received the same endpoint bundle')
    }
    if (statuses[0].appDataPath === statuses[1].appDataPath) {
        throw new Error('The worktrees received the same app-data path')
    }

    for (const status of statuses) {
        await waitFor(
            `renderer ${status.bundle.renderer}`,
            async () => (await fetch(`http://localhost:${status.bundle.renderer}`)).ok,
        )
        await waitFor(
            `CDP ${status.bundle.cdp}`,
            async () => (await fetch(`http://127.0.0.1:${status.bundle.cdp}/json/list`)).ok,
        )
        await waitFor(
            `inspector ${status.bundle.inspector}`,
            async () => (await fetch(`http://127.0.0.1:${status.bundle.inspector}/json/list`)).ok,
        )
    }

    const fakeBin = join(temporaryRoot, 'fake-bin')
    const capture = join(temporaryRoot, 'mcp-args.json')
    await import('node:fs/promises').then(fs => fs.mkdir(fakeBin))
    const fakePnpm = join(fakeBin, 'pnpm')
    await writeFile(
        fakePnpm,
        `#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
writeFileSync(process.env.MCP_CAPTURE, JSON.stringify(process.argv.slice(2)))
`,
    )
    await chmod(fakePnpm, 0o755)
    const mcp = spawnSync(
        process.execPath,
        [join(worktrees[1], 'tools/dev-instance/mcp-wrapper.mjs'), 'chrome-devtools'],
        {
            cwd: worktrees[1],
            env: {
                ...environment,
                PATH: `${fakeBin}:${process.env.PATH}`,
                RELEASE_MAESTRO_PNPM_COMMAND: fakePnpm,
                MCP_CAPTURE: capture,
            },
            encoding: 'utf8',
        },
    )
    if (mcp.status !== 0) throw new Error(mcp.stderr)
    const mcpArgs = JSON.parse(await readFile(capture, 'utf8'))
    if (!mcpArgs.includes(`http://127.0.0.1:${statuses[1].bundle.cdp}`)) {
        throw new Error('The MCP wrapper did not resolve the second worktree CDP endpoint')
    }

    await stop(processes[0], worktrees[0])
    const secondStillRunning = await fetch(`http://localhost:${statuses[1].bundle.renderer}`)
    if (!secondStillRunning.ok) throw new Error('Stopping the first worktree stopped the second renderer')
    await stop(processes[1], worktrees[1])

    process.stdout.write(
        `Two-worktree smoke check passed.\n` +
            `${worktrees[0]} ${JSON.stringify(statuses[0].bundle)}\n` +
            `${worktrees[1]} ${JSON.stringify(statuses[1].bundle)}\n`,
    )
} finally {
    for (let index = 0; index < processes.length; index += 1) {
        await stop(processes[index], worktrees[index]).catch(() => {})
    }
    for (const worktree of worktrees) {
        if (existsSync(worktree)) {
            spawnSync('git', ['-C', repositoryRoot, 'worktree', 'remove', '--force', worktree])
        }
    }
    await rm(temporaryRoot, { recursive: true, force: true })
}

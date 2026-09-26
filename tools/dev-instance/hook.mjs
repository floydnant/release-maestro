#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { parse, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { reconcileInstances, releaseDevelopment, releaseRemovedWorktree } from './core.mjs'

const readStdin = async () => {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    const input = Buffer.concat(chunks).toString('utf8').trim()
    return input ? JSON.parse(input) : {}
}

const verifyRemoved = async (path, worktreeId) => {
    const deadline = Date.now() + 30_000
    while (existsSync(path) && Date.now() < deadline) {
        await new Promise(done => setTimeout(done, 250))
    }
    if (!existsSync(path)) await releaseRemovedWorktree(path, worktreeId || null)
}

const waitForVerifierReady = child =>
    new Promise(resolveReady => {
        let settled = false
        const finish = () => {
            if (settled) return
            settled = true
            clearTimeout(timeout)
            if (child.connected) child.disconnect()
            child.unref()
            resolveReady()
        }
        const timeout = setTimeout(finish, 5_000)
        child.once('message', finish)
        child.once('error', finish)
        child.once('exit', finish)
    })

const handleHook = async () => {
    const payload = await readStdin()
    if (typeof payload.cwd === 'string' && existsSync(payload.cwd)) process.chdir(payload.cwd)

    switch (payload.hook_event_name) {
        case 'SessionStart':
            await reconcileInstances(payload.source)
            return
        case 'SessionEnd':
            if (payload.reason === 'clear') return
            await releaseDevelopment({ requestWhenIdle: true })
            return
        case 'WorktreeRemove': {
            if (typeof payload.worktree_path !== 'string') return
            let worktreeId = ''
            try {
                const manifest = JSON.parse(
                    await readFile(resolve(payload.worktree_path, '.release-maestro-instance.json'), 'utf8'),
                )
                if (typeof manifest.worktreeId === 'string') worktreeId = manifest.worktreeId
            } catch {
                // Registry path matching is the fallback when the manifest is missing.
            }
            const child = spawn(
                process.execPath,
                [fileURLToPath(import.meta.url), 'verify-remove', payload.worktree_path, worktreeId],
                {
                    cwd: parse(resolve(payload.worktree_path)).root,
                    detached: true,
                    stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
                },
            )
            await waitForVerifierReady(child)
            return
        }
        default:
            return
    }
}

try {
    if (process.argv[2] === 'verify-remove') {
        if (process.send) await new Promise(done => process.send('ready', done))
        await verifyRemoved(resolve(process.argv[3]), process.argv[4] || '')
    } else {
        await handleHook()
    }
} catch {
    // Hooks are advisory. A failure must never block an agent session or worktree removal.
    process.exitCode = 0
}

#!/usr/bin/env node

import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'
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
                { detached: true, stdio: 'ignore' },
            )
            child.unref()
            return
        }
        default:
            return
    }
}

try {
    if (process.argv[2] === 'verify-remove') {
        await verifyRemoved(resolve(process.argv[3]), process.argv[4] || '')
    } else {
        await handleHook()
    }
} catch {
    // Hooks are advisory. A failure must never block an agent session or worktree removal.
    process.exitCode = 0
}

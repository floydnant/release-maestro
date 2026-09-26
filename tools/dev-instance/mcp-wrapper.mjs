#!/usr/bin/env node

import {
    bundleEnvironment,
    registerDevelopmentHolder,
    removeDevelopmentHolder,
    stopProcessTree,
    spawnPackageBinary,
    startHeartbeat,
    heartbeatDevelopmentHolder,
    logDiagnostic,
} from './core.mjs'
import { constants as osConstants } from 'node:os'

const server = process.argv[2]
if (!['chrome-devtools', 'playwright'].includes(server)) {
    process.stderr.write('Usage: mcp-wrapper.mjs <chrome-devtools|playwright>\n')
    process.exit(2)
}

let holder
let child
let stopHeartbeat = () => {}
let pendingSignal = null
let startupShutdownTimer = null
const signalListeners = new Map()
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const listener = () => {
        pendingSignal ??= signal
        if (child?.pid) {
            void stopProcessTree(child.pid, child.releaseMaestroStartIdentity, signal).catch(() => {})
        } else if (!startupShutdownTimer) {
            startupShutdownTimer = setTimeout(
                () => process.exit(128 + (osConstants.signals[pendingSignal] ?? 0)),
                5_000,
            )
            startupShutdownTimer.unref()
        }
    }
    process.on(signal, listener)
    signalListeners.set(signal, listener)
}

try {
    const registered = await registerDevelopmentHolder(`mcp:${server}`)
    holder = registered.holder
    const { allocation } = registered
    const endpoint = `http://127.0.0.1:${allocation.bundle.cdp}`
    const commandArgs =
        server === 'chrome-devtools'
            ? [
                  'exec',
                  'chrome-devtools-mcp',
                  '--browserUrl',
                  endpoint,
                  '--usageStatistics=false',
                  '--memoryDebugging',
              ]
            : ['exec', 'playwright-mcp', '--cdp-endpoint', endpoint]
    const [binary, ...binaryArgs] = commandArgs.slice(1)
    child = spawnPackageBinary(binary, binaryArgs, {
        env: { ...process.env, ...bundleEnvironment(allocation.bundle, allocation.appDataPath) },
    })
    if (child.releaseMaestroIdentityError) throw child.releaseMaestroIdentityError
    if (pendingSignal) {
        clearTimeout(startupShutdownTimer)
        startupShutdownTimer = null
        void stopProcessTree(child.pid, child.releaseMaestroStartIdentity, pendingSignal).catch(() => {})
    }
    stopHeartbeat = startHeartbeat(() => heartbeatDevelopmentHolder(holder.id))
    const { code, signal } = await new Promise((resolve, reject) => {
        child.once('exit', (code, signal) => resolve({ code, signal }))
        child.once('error', reject)
    })
    if (pendingSignal || signal) {
        const signalNumber = osConstants.signals[pendingSignal || signal] ?? 0
        process.exitCode = 128 + signalNumber
    } else {
        process.exitCode = code ?? 1
    }
} catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`MCP wrapper failed: ${message}\n`)
    await logDiagnostic('mcp-wrapper-failed', { server, reason: message }).catch(() => {})
    process.exitCode = 1
} finally {
    clearTimeout(startupShutdownTimer)
    stopHeartbeat()
    signalListeners.forEach((listener, signal) => process.off(signal, listener))
    if (holder) await removeDevelopmentHolder(holder.id).catch(() => {})
}

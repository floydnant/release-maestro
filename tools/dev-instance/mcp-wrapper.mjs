#!/usr/bin/env node

import {
    bundleEnvironment,
    registerDevelopmentHolder,
    removeDevelopmentHolder,
    signalProcessTree,
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
const signalListeners = new Map()
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
    const listener = () => {
        if (child?.pid) signalProcessTree(child.pid, signal, child.releaseMaestroStartIdentity)
        else pendingSignal = signal
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
    if (pendingSignal) signalProcessTree(child.pid, pendingSignal, child.releaseMaestroStartIdentity)
    stopHeartbeat = startHeartbeat(() => heartbeatDevelopmentHolder(holder.id))
    const { code, signal } = await new Promise(resolve => {
        child.once('exit', (code, signal) => resolve({ code, signal }))
        child.once('error', error => resolve({ code: 1, signal: null, error }))
    })
    if (signal) {
        const signalNumber = osConstants.signals[signal] ?? 0
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
    stopHeartbeat()
    signalListeners.forEach((listener, signal) => process.off(signal, listener))
    if (holder) await removeDevelopmentHolder(holder.id).catch(() => {})
}

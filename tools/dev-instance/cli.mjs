#!/usr/bin/env node

import {
    InstanceError,
    allocateDevelopment,
    allocateTransient,
    bundleEnvironment,
    followLog,
    forwardSignals,
    heartbeatTransient,
    registerDevelopmentHolder,
    registerDevelopmentListenerHolder,
    releaseDevelopment,
    releaseTransient,
    removeDevelopmentHolder,
    signalProcessTree,
    spawnManaged,
    spawnPackageBinary,
    startHeartbeat,
    statusDevelopment,
    stopDevelopment,
    stopProcessTree,
    waitForPort,
    heartbeatDevelopmentHolders,
    logDiagnostic,
} from './core.mjs'
import { constants as osConstants } from 'node:os'

const print = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)

const exitForChild = (code, signal) => {
    if (signal) return 128 + (osConstants.signals[signal] ?? 0)
    return code ?? 1
}

const waitForExit = child =>
    new Promise(resolve => {
        if (child.exitCode !== null || child.signalCode !== null) {
            resolve({ child, code: child.exitCode, signal: child.signalCode })
            return
        }
        child.once('exit', (code, signal) => resolve({ child, code, signal }))
        child.once('error', () => resolve({ child, code: 1, signal: null }))
    })

const stopChild = async child => {
    if (!child?.pid) return
    await stopProcessTree(child.pid)
    await waitForExit(child)
}

const runDevelopment = async () => {
    const { allocation, holder: supervisor } = await registerDevelopmentHolder('dev-supervisor')
    const environment = { ...process.env, ...bundleEnvironment(allocation.bundle, allocation.appDataPath) }
    const children = []
    const childHolders = []
    const stopHeartbeat = startHeartbeat(() =>
        heartbeatDevelopmentHolders([supervisor.id, ...childHolders.map(holder => holder.id)]),
    )
    const stopForwarding = forwardSignals(() => children)

    try {
        const renderer = spawnPackageBinary(
            'nx',
            [
                'serve',
                'maestro-renderer',
                '--host',
                'localhost',
                '--port',
                String(allocation.bundle.renderer),
            ],
            { env: environment },
        )
        children.push(renderer)
        const rendererHolder = await registerDevelopmentHolder(
            'dev-renderer',
            renderer.pid,
            supervisor.id,
            process.platform !== 'win32',
        )
        childHolders.push(rendererHolder.holder)

        await Promise.race([
            waitForPort(allocation.bundle.renderer),
            waitForExit(renderer).then(result => {
                throw new InstanceError(
                    `Renderer exited before it opened port ${allocation.bundle.renderer} with code ${result.code}.`,
                    'RENDERER_START_FAILED',
                )
            }),
        ])
        const rendererListener = await registerDevelopmentListenerHolder(
            'dev-renderer',
            [allocation.bundle.renderer],
            renderer.pid,
            supervisor.id,
        )
        childHolders.push(rendererListener.holder)

        const electronEnvironment = { ...environment }
        delete electronEnvironment.ELECTRON_RUN_AS_NODE
        const electron = spawnPackageBinary(
            'nx',
            [
                'serve-internal',
                'maestro-electron',
                '--remoteDebuggingPort',
                String(allocation.bundle.cdp),
                '--port',
                String(allocation.bundle.inspector),
            ],
            { env: electronEnvironment },
        )
        children.push(electron)
        const electronHolder = await registerDevelopmentHolder(
            'dev-electron',
            electron.pid,
            supervisor.id,
            process.platform !== 'win32',
        )
        childHolders.push(electronHolder.holder)

        await Promise.race([
            Promise.all([
                waitForPort(allocation.bundle.cdp, 30_000),
                waitForPort(allocation.bundle.inspector, 30_000),
            ]),
            waitForExit(electron).then(result => {
                throw new InstanceError(
                    `Electron exited before it opened its debug ports with code ${result.code}.`,
                    'ELECTRON_START_FAILED',
                )
            }),
        ])
        const electronListener = await registerDevelopmentListenerHolder(
            'dev-electron',
            [allocation.bundle.cdp, allocation.bundle.inspector],
            electron.pid,
            supervisor.id,
        )
        childHolders.push(electronListener.holder)

        process.stdout.write(
            `Release Maestro dev instance\n` +
                `  renderer  http://localhost:${allocation.bundle.renderer}\n` +
                `  CDP       http://127.0.0.1:${allocation.bundle.cdp}\n` +
                `  inspector http://127.0.0.1:${allocation.bundle.inspector}\n` +
                `  app data  ${allocation.appDataPath}\n`,
        )

        const result = await Promise.race([waitForExit(renderer), waitForExit(electron)])
        await Promise.all(children.filter(child => child !== result.child).map(stopChild))
        process.exitCode = exitForChild(result.code, result.signal)
    } finally {
        stopHeartbeat()
        stopForwarding()
        await Promise.all(children.map(stopChild))
        for (const holder of childHolders) await removeDevelopmentHolder(holder.id).catch(() => {})
        await removeDevelopmentHolder(supervisor.id).catch(() => {})
    }
}

const runWorkflow = async args => {
    const separator = args.indexOf('--')
    if (separator < 1 || separator === args.length - 1) {
        throw new InstanceError(
            'Usage: cli.mjs run-workflow <electron-e2e|renderer-e2e> -- <command> [args...]',
        )
    }
    const workflow = args[0]
    const command = args[separator + 1]
    const commandArgs = args.slice(separator + 2)
    let child
    let pendingSignal = null
    const signalListeners = new Map()
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        const listener = () => {
            if (child?.pid) signalProcessTree(child.pid, signal)
            else pendingSignal = signal
        }
        process.on(signal, listener)
        signalListeners.set(signal, listener)
    }
    let transient
    let stopHeartbeat = () => {}
    try {
        transient = await allocateTransient(workflow)
        child = spawnManaged(command, commandArgs, {
            env: {
                ...process.env,
                ...bundleEnvironment(transient.bundle, transient.appDataPath),
            },
        })
        if (pendingSignal) signalProcessTree(child.pid, pendingSignal)
        stopHeartbeat = startHeartbeat(() => heartbeatTransient(transient.id))
        const result = await waitForExit(child)
        process.exitCode = exitForChild(result.code, result.signal)
    } finally {
        stopHeartbeat()
        signalListeners.forEach((listener, signal) => process.off(signal, listener))
        if (transient) await releaseTransient(transient.id)
    }
}

const humanStatus = status => {
    if (!status.bundle) return `${status.state}: ${status.path}`
    const holders = status.holders.length
        ? status.holders
              .map(holder => `  ${holder.role}: PID ${holder.pid}, started ${holder.startIdentity}`)
              .join('\n')
        : '  none'
    return [
        `${status.state} (${status.health})`,
        `worktree: ${status.path}`,
        `identity: ${status.worktreeId}`,
        `renderer: ${status.bundle.renderer}`,
        `CDP: ${status.bundle.cdp}`,
        `inspector: ${status.bundle.inspector}`,
        `app data: ${status.appDataPath}`,
        `age: ${Math.round(status.ageMs / 1000)}s`,
        `resources: ${status.claims.join(', ')}`,
        `holders:\n${holders}`,
    ].join('\n')
}

const main = async () => {
    const [command, ...args] = process.argv.slice(2)
    switch (command) {
        case 'dev-allocate':
            print(await allocateDevelopment())
            return
        case 'dev-release':
            print(await releaseDevelopment({ force: args.includes('--force') }))
            return
        case 'dev-reallocate':
            print(await allocateDevelopment({ reallocate: true }))
            return
        case 'dev-status': {
            const status = await statusDevelopment()
            process.stdout.write(
                args.includes('--json') ? `${JSON.stringify(status, null, 2)}\n` : `${humanStatus(status)}\n`,
            )
            return
        }
        case 'dev-stop':
            print({ stopped: await stopDevelopment() })
            return
        case 'dev-log':
            await followLog({ follow: args.includes('--follow') || args.includes('-f') })
            return
        case 'run-dev':
            await runDevelopment()
            return
        case 'run-workflow':
            await runWorkflow(args)
            return
        default:
            throw new InstanceError(
                'Usage: cli.mjs <dev-allocate|dev-release|dev-reallocate|dev-status|dev-stop|dev-log|run-dev|run-workflow>',
                'USAGE',
            )
    }
}

main().catch(async error => {
    const prefix = error instanceof InstanceError ? error.code : 'UNEXPECTED_ERROR'
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`${prefix}: ${message}\n`)
    await logDiagnostic('command-failed', { code: prefix, reason: message }).catch(() => {})
    process.exitCode = 1
})

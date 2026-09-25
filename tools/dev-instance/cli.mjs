#!/usr/bin/env node

import {
    InstanceError,
    allocateDevelopment,
    allocateTransient,
    bundleEnvironment,
    developmentSlot,
    followLog,
    forwardSignals,
    heartbeatTransient,
    registerDevelopmentHolder,
    registerDevelopmentListenerHolder,
    setTransientChildHolder,
    releaseDevelopment,
    releaseTransient,
    removeDevelopmentHolder,
    signalProcessTree,
    spawnManaged,
    spawnPackageBinary,
    startHeartbeat,
    statusDevelopment,
    stopDevelopment,
    stopProcessGroup,
    stopProcessTree,
    waitForPort,
    heartbeatDevelopmentHolders,
    logDiagnostic,
    listInstances,
} from './core.mjs'
import { constants as osConstants } from 'node:os'
import {
    developmentAppName,
    formatDevelopmentStatus,
    formatDevelopmentSummary,
    formatInstanceList,
} from './presentation.mjs'

const print = value => process.stdout.write(`${JSON.stringify(value, null, 2)}\n`)
const useColor = () => {
    if ('FORCE_COLOR' in process.env) return process.env['FORCE_COLOR'] !== '0'
    return Boolean(process.stdout.isTTY && !('NO_COLOR' in process.env))
}

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
    if (child.exitCode === null && child.signalCode === null) {
        if (!child.releaseMaestroStartIdentity) return
        await stopProcessTree(child.pid, child.releaseMaestroStartIdentity)
        await waitForExit(child)
        return
    }
    await stopProcessGroup(child.pid, child.releaseMaestroStartIdentity)
}

const parseWorkflowCommands = tokens => {
    const commands = [[]]
    for (let index = 0; index < tokens.length; index += 1) {
        const token = tokens[index]
        if (token === '--literal') {
            if (index === tokens.length - 1) {
                throw new InstanceError('--literal must be followed by an argument', 'USAGE')
            }
            commands.at(-1).push(tokens[(index += 1)])
        } else if (token === '--then') {
            if (commands.length === 2 || commands.at(-1).length === 0) {
                throw new InstanceError('run-workflow accepts at most two non-empty commands', 'USAGE')
            }
            commands.push([])
        } else {
            commands.at(-1).push(token)
        }
    }
    if (commands.some(command => command.length === 0)) {
        throw new InstanceError('Each run-workflow command must name an executable', 'USAGE')
    }
    return commands
}

const runDevelopment = async () => {
    const { allocation, holder: supervisor } = await registerDevelopmentHolder('dev-supervisor')
    const instance = { ...allocation, slot: developmentSlot(allocation.bundle) }
    const environment = {
        ...process.env,
        ...bundleEnvironment(allocation.bundle, allocation.appDataPath),
        RELEASE_MAESTRO_DEV_APP_NAME: developmentAppName(instance),
    }
    const children = []
    const childHolders = []
    const stopHeartbeat = startHeartbeat(() =>
        heartbeatDevelopmentHolders([supervisor.id, ...childHolders.map(holder => holder.id)]),
    )
    const cancellation = new AbortController()
    let cancellationSignal = null
    const stopForwarding = forwardSignals(
        () => children,
        signal => {
            cancellationSignal ??= signal
            cancellation.abort()
        },
    )
    const stopIfCancelled = () => {
        if (!cancellationSignal) return false
        process.exitCode = exitForChild(null, cancellationSignal)
        return true
    }

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
        const rendererExit = waitForExit(renderer)
        if (!renderer.pid) {
            const result = await rendererExit
            throw new InstanceError(
                `Renderer launcher failed with code ${result.code}.`,
                'RENDERER_START_FAILED',
            )
        }
        const rendererHolder = await registerDevelopmentHolder(
            'dev-renderer',
            renderer.pid,
            supervisor.id,
            process.platform !== 'win32',
        )
        childHolders.push(rendererHolder.holder)

        const rendererReadiness = new AbortController()
        try {
            await Promise.race([
                waitForPort(
                    allocation.bundle.renderer,
                    120_000,
                    AbortSignal.any([rendererReadiness.signal, cancellation.signal]),
                ),
                rendererExit.then(result => {
                    throw new InstanceError(
                        `Renderer exited before it opened port ${allocation.bundle.renderer} with code ${result.code}.`,
                        'RENDERER_START_FAILED',
                    )
                }),
            ])
        } finally {
            rendererReadiness.abort()
        }
        if (stopIfCancelled()) return
        const rendererListener = await registerDevelopmentListenerHolder(
            'dev-renderer',
            [allocation.bundle.renderer],
            renderer.pid,
            supervisor.id,
        )
        childHolders.push(rendererListener.holder)
        if (stopIfCancelled()) return

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
        const electronExit = waitForExit(electron)
        if (!electron.pid) {
            const result = await electronExit
            throw new InstanceError(
                `Electron launcher failed with code ${result.code}.`,
                'ELECTRON_START_FAILED',
            )
        }
        const electronHolder = await registerDevelopmentHolder(
            'dev-electron',
            electron.pid,
            supervisor.id,
            process.platform !== 'win32',
        )
        childHolders.push(electronHolder.holder)

        const electronReadiness = new AbortController()
        try {
            await Promise.race([
                Promise.all([
                    waitForPort(
                        allocation.bundle.cdp,
                        30_000,
                        AbortSignal.any([electronReadiness.signal, cancellation.signal]),
                    ),
                    waitForPort(
                        allocation.bundle.inspector,
                        30_000,
                        AbortSignal.any([electronReadiness.signal, cancellation.signal]),
                    ),
                ]),
                electronExit.then(result => {
                    throw new InstanceError(
                        `Electron exited before it opened its debug ports with code ${result.code}.`,
                        'ELECTRON_START_FAILED',
                    )
                }),
            ])
        } finally {
            electronReadiness.abort()
        }
        if (stopIfCancelled()) return
        const electronListener = await registerDevelopmentListenerHolder(
            'dev-electron',
            [allocation.bundle.cdp, allocation.bundle.inspector],
            electron.pid,
            supervisor.id,
        )
        childHolders.push(electronListener.holder)

        process.stdout.write(formatDevelopmentSummary(instance, { color: useColor() }))

        const result = await Promise.race([rendererExit, electronExit])
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
    const commands = parseWorkflowCommands(args.slice(separator + 1))
    let child
    let cancellationSignal = null
    const signalListeners = new Map()
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        const listener = () => {
            cancellationSignal ??= signal
            if (child?.pid) signalProcessTree(child.pid, signal, child.releaseMaestroStartIdentity)
        }
        process.on(signal, listener)
        signalListeners.set(signal, listener)
    }
    let transient
    let stopHeartbeat = () => {}
    try {
        transient = await allocateTransient(workflow)
        const environment = {
            ...process.env,
            ...bundleEnvironment(transient.bundle, transient.appDataPath),
        }
        for (const [command, ...commandArgs] of commands) {
            if (cancellationSignal) {
                process.exitCode = exitForChild(null, cancellationSignal)
                break
            }
            child = ['nx', 'playwright'].includes(command)
                ? spawnPackageBinary(command, commandArgs, { env: environment })
                : spawnManaged(command, commandArgs, { env: environment })
            try {
                await setTransientChildHolder(transient.id, child.pid, child.releaseMaestroStartIdentity)
            } catch (error) {
                await stopChild(child)
                throw error
            }
            stopHeartbeat()
            stopHeartbeat = startHeartbeat(() => heartbeatTransient(transient.id))
            const result = await waitForExit(child)
            await stopChild(child)
            child = null
            if (cancellationSignal) {
                process.exitCode = exitForChild(null, cancellationSignal)
                break
            }
            process.exitCode = exitForChild(result.code, result.signal)
            if (result.code !== 0 || result.signal) break
        }
    } finally {
        stopHeartbeat()
        signalListeners.forEach((listener, signal) => process.off(signal, listener))
        if (transient) await releaseTransient(transient.id)
    }
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
                args.includes('--json')
                    ? `${JSON.stringify(status, null, 2)}\n`
                    : `${formatDevelopmentStatus(status, { color: useColor() })}\n`,
            )
            return
        }
        case 'dev-list': {
            const listed = await listInstances()
            process.stdout.write(
                args.includes('--json')
                    ? `${JSON.stringify(listed, null, 2)}\n`
                    : `${formatInstanceList(listed, { color: useColor() })}\n`,
            )
            return
        }
        case 'dev-stop':
            print({ stopped: await stopDevelopment() })
            return
        case 'dev-log':
            await followLog({
                follow: args.includes('--follow') || args.includes('-f'),
                json: args.includes('--json'),
                color: useColor(),
            })
            return
        case 'run-dev':
            await runDevelopment()
            return
        case 'run-workflow':
            await runWorkflow(args)
            return
        default:
            throw new InstanceError(
                'Usage: cli.mjs <dev-allocate|dev-release|dev-reallocate|dev-status|dev-list|dev-stop|dev-log|run-dev|run-workflow>',
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

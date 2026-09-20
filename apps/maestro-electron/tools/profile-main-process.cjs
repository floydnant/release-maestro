#!/usr/bin/env node

const { existsSync, readFileSync } = require('node:fs')
const { join } = require('node:path')

const durationSeconds = Number(process.argv[2] ?? 10)

if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Usage: node apps/maestro-electron/tools/profile-main-process.cjs [seconds]')
}

const manifestPath = join(process.cwd(), '.release-maestro-instance.json')
const manifestPort = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, 'utf8')).bundle?.inspector
    : undefined
const inspectorPort = Number(process.env.RELEASE_MAESTRO_INSPECTOR_PORT ?? manifestPort ?? 5858)
const inspectorUrl = `http://127.0.0.1:${inspectorPort}/json/list`
const requestTimeoutMs = 5_000

async function main() {
    const response = await fetch(inspectorUrl, { signal: AbortSignal.timeout(requestTimeoutMs) })
    if (!response.ok) throw new Error(`Node inspector returned ${response.status}`)

    const [target] = await response.json()
    if (!target?.webSocketDebuggerUrl) throw new Error(`No Node inspector target at ${inspectorUrl}`)

    const socket = new WebSocket(target.webSocketDebuggerUrl)
    try {
        await new Promise((resolve, reject) => {
            const cleanup = () => {
                clearTimeout(timeout)
                socket.removeEventListener('open', onOpen)
                socket.removeEventListener('error', onDisconnect)
                socket.removeEventListener('close', onDisconnect)
            }
            const onOpen = () => {
                cleanup()
                resolve()
            }
            const onDisconnect = () => {
                cleanup()
                reject(new Error('Node inspector disconnected while connecting'))
            }
            const timeout = setTimeout(() => {
                cleanup()
                reject(new Error('Node inspector timed out while connecting'))
            }, requestTimeoutMs)

            socket.addEventListener('open', onOpen, { once: true })
            socket.addEventListener('error', onDisconnect, { once: true })
            socket.addEventListener('close', onDisconnect, { once: true })
        })

        let nextId = 0

        const send = (method, params = {}) =>
            new Promise((resolve, reject) => {
                const id = ++nextId
                const cleanup = () => {
                    clearTimeout(timeout)
                    socket.removeEventListener('message', onMessage)
                    socket.removeEventListener('error', onDisconnect)
                    socket.removeEventListener('close', onDisconnect)
                }
                const onMessage = event => {
                    let message
                    try {
                        message = JSON.parse(event.data)
                    } catch {
                        cleanup()
                        reject(new Error(`Node inspector sent invalid JSON during ${method}`))
                        return
                    }
                    if (message?.id !== id) return

                    cleanup()
                    if (message.error) reject(new Error(message.error.message ?? `${method} failed`))
                    else resolve(message.result)
                }
                const onDisconnect = () => {
                    cleanup()
                    reject(new Error(`Node inspector disconnected during ${method}`))
                }
                const timeout = setTimeout(() => {
                    cleanup()
                    reject(new Error(`Node inspector timed out during ${method}`))
                }, requestTimeoutMs)

                socket.addEventListener('message', onMessage)
                socket.addEventListener('error', onDisconnect, { once: true })
                socket.addEventListener('close', onDisconnect, { once: true })
                try {
                    socket.send(JSON.stringify({ id, method, params }))
                } catch (error) {
                    cleanup()
                    reject(error)
                }
            })

        await send('Profiler.enable')
        await send('Profiler.start')
        console.error(`Profiling the Electron main process for ${durationSeconds}s. Exercise it now.`)
        await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000))

        const { profile } = await send('Profiler.stop')

        // Electron omits node.hitCount, so count sampled leaf-node IDs instead.
        const hitsByNode = new Map()
        for (const nodeId of profile.samples ?? []) {
            hitsByNode.set(nodeId, (hitsByNode.get(nodeId) ?? 0) + 1)
        }

        const hottest = profile.nodes
            .map(node => ({ node, hits: hitsByNode.get(node.id) ?? 0 }))
            .filter(({ node, hits }) => node.callFrame.functionName !== '(idle)' && hits > 0)
            .sort((left, right) => right.hits - left.hits)
            .slice(0, 15)
            .map(({ node, hits }) => ({
                hits,
                function: node.callFrame.functionName || '(anonymous)',
                url: node.callFrame.url,
                line: node.callFrame.lineNumber + 1,
            }))

        console.log(
            JSON.stringify(
                {
                    durationMs: Math.round((profile.endTime - profile.startTime) / 1000),
                    samples: profile.samples?.length ?? 0,
                    hottest,
                },
                null,
                2,
            ),
        )
    } finally {
        socket.close()
    }
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})

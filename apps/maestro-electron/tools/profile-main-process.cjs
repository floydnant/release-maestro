#!/usr/bin/env node

const durationSeconds = Number(process.argv[2] ?? 10)

if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('Usage: node apps/maestro-electron/tools/profile-main-process.cjs [seconds]')
}

const inspectorUrl = 'http://127.0.0.1:5858/json/list'

async function main() {
    const response = await fetch(inspectorUrl)
    if (!response.ok) throw new Error(`Node inspector returned ${response.status}`)

    const [target] = await response.json()
    if (!target?.webSocketDebuggerUrl) throw new Error(`No Node inspector target at ${inspectorUrl}`)

    const socket = new WebSocket(target.webSocketDebuggerUrl)
    await new Promise((resolve, reject) => {
        socket.addEventListener('open', resolve, { once: true })
        socket.addEventListener('error', reject, { once: true })
    })

    let nextId = 0
    const pending = new Map()

    socket.addEventListener('message', event => {
        const message = JSON.parse(event.data)
        const callback = pending.get(message.id)
        if (!callback) return

        pending.delete(message.id)
        callback(message)
    })

    const send = (method, params = {}) =>
        new Promise((resolve, reject) => {
            const id = ++nextId
            pending.set(id, message => {
                if (message.error) reject(new Error(message.error.message))
                else resolve(message.result)
            })
            socket.send(JSON.stringify({ id, method, params }))
        })

    await send('Profiler.enable')
    await send('Profiler.start')
    console.error(`Profiling the Electron main process for ${durationSeconds}s. Exercise it now.`)
    await new Promise(resolve => setTimeout(resolve, durationSeconds * 1000))

    const { profile } = await send('Profiler.stop')
    socket.close()

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
}

main().catch(error => {
    console.error(error instanceof Error ? error.message : error)
    process.exitCode = 1
})

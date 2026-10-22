import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { EventEmitter } from 'node:events'
import vm from 'node:vm'
import { test } from '@jest/globals'

const require = createRequire(import.meta.url)
const executorPath = require.resolve('nx-electron/src/executors/execute/executor.js')

test('Electron exits before a watched build starts its replacement', async () => {
    const live = new Set()
    const spawnedWithOldProcessAlive = []
    let nextPid = 100

    const spawn = () => {
        spawnedWithOldProcessAlive.push(live.size > 0)
        const child = new EventEmitter()
        child.pid = ++nextPid
        child.exitCode = null
        child.signalCode = null
        child.stdout = new EventEmitter()
        child.stderr = new EventEmitter()
        child.kill = signal => {
            setTimeout(() => {
                child.signalCode = signal
                live.delete(child.pid)
                child.emit('exit', null, signal)
            }, 20)
            return true
        }
        live.add(child.pid)
        return child
    }

    async function* builds() {
        yield { success: true, outfile: 'app.js' }
        yield { success: true, outfile: 'app.js' }
    }

    // Model the macOS failure: tree-kill reports success after signaling the
    // children, but the Electron parent is still alive and owns the ports.
    const treeKill = (_pid, _signal, callback) => callback()
    const fakeRequire = id => {
        if (id === '@nx/devkit') {
            return {
                parseTargetString: value => value,
                readTargetOptions: () => ({}),
                runExecutor: builds,
                logger: { info() {}, error() {}, warn() {} },
            }
        }
        if (id === 'child_process') return { spawn }
        if (id === 'electron') return '/fake/electron'
        if (id === 'tree-kill') return treeKill
        return require(id)
    }

    const module = { exports: {} }
    vm.runInNewContext(
        readFileSync(executorPath, 'utf8'),
        { module, exports: module.exports, require: fakeRequire, process, console, setTimeout, clearTimeout },
        { filename: executorPath },
    )

    for await (const _event of module.exports.executor({ buildTarget: 'build', watch: true, args: [] }, {})) {
        // Consume both build events so the executor reaches its restart path.
    }

    assert.deepEqual(spawnedWithOldProcessAlive, [false, false])
})

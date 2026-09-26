#!/usr/bin/env node

import { constants as osConstants } from 'node:os'
import { forwardSignals, spawnManaged } from './core.mjs'

const specification = JSON.parse(process.env['RELEASE_MAESTRO_TREE_COMMAND'] ?? 'null')
if (
    !specification ||
    typeof specification.command !== 'string' ||
    !Array.isArray(specification.args) ||
    !specification.args.every(argument => typeof argument === 'string')
) {
    throw new Error('Invalid Windows workflow command')
}

const environment = { ...process.env }
delete environment.RELEASE_MAESTRO_TREE_COMMAND
delete environment.RELEASE_MAESTRO_TREE_NODE
delete environment.RELEASE_MAESTRO_TREE_PARENT_PID
delete environment.RELEASE_MAESTRO_TREE_SCRIPT
delete environment.RELEASE_MAESTRO_TREE_JOB_HELPER

const child = spawnManaged(specification.command, specification.args, { env: environment })
const stopForwarding = forwardSignals(() => [child])
try {
    const { code, signal } = await new Promise((resolve, reject) => {
        child.once('exit', (code, signal) => resolve({ code, signal }))
        child.once('error', reject)
    })
    if (process.env['RELEASE_MAESTRO_TREE_DEBUG'] === '1') {
        process.stderr.write(`workflow command: child exit=${code} signal=${signal}\n`)
    }
    process.exitCode = signal ? 128 + (osConstants.signals[signal] ?? 0) : (code ?? 1)
} finally {
    stopForwarding()
}

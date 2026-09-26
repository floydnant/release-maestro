#!/usr/bin/env node

import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url))
const jestBin = join(dirname(require.resolve('jest/package.json')), 'bin', 'jest.js')
const expected = [
    'Windows workflow keeps its claim until an orphaned grandchild exits',
    'Windows workflow cancellation kills an orphaned grandchild before releasing its claim',
    'run-workflow passes separators and shell metacharacters as literal child arguments',
]
const result = spawnSync(
    process.execPath,
    [
        jestBin,
        '--config',
        join(repositoryRoot, 'tools/jest.config.cjs'),
        '--runInBand',
        '--testNamePattern=Windows workflow|run-workflow passes separators',
        '--json',
    ],
    { cwd: repositoryRoot, encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
)
if (result.stderr) process.stderr.write(result.stderr)
if (result.error) throw result.error
if (result.status !== 0) process.exit(result.status ?? 1)

const report = JSON.parse(result.stdout)
const passed = new Set(
    report.testResults.flatMap(suite =>
        suite.assertionResults.filter(test => test.status === 'passed').map(test => test.fullName),
    ),
)
for (const name of expected) assert.ok(passed.has(name), `Windows workflow check did not run: ${name}`)
process.stdout.write(`Verified ${expected.length} Windows workflow checks.\n`)

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, test } from '@jest/globals'
import { checkWorkflow, workflowHealth } from './health.mjs'

const repository = 'owner/repo'
const runs = (...workflow_runs) => ({ workflow_runs })
const mainSuccess = {
    head_branch: 'main',
    head_repository: { full_name: repository },
    event: 'workflow_dispatch',
    status: 'completed',
    conclusion: 'success',
}

describe('workflowHealth', () => {
    const now = new Date('2026-11-03T22:00:00Z')
    // The scheduled run failed, but it still proves the schedule fires.
    const failedReceipt = runs({ created_at: '2026-11-03T06:00:00Z', conclusion: 'failure' })

    test('recognizes recovery on main while retaining a recent scheduled-run receipt', () => {
        assert.equal(workflowHealth(failedReceipt, runs(mainSuccess), repository, now).status, 'healthy')
    })

    test.each([
        [
            'the latest completed main run failed',
            failedReceipt,
            runs({ ...mainSuccess, conclusion: 'failure' }, mainSuccess),
        ],
        ['only a pull request run succeeded', failedReceipt, runs({ ...mainSuccess, event: 'pull_request' })],
        [
            'only a fork branch named main succeeded',
            failedReceipt,
            runs({ ...mainSuccess, head_repository: { full_name: 'fork/repo' } }),
        ],
        ['there is no scheduled receipt', runs(), runs(mainSuccess)],
        [
            'the scheduled receipt is older than 36 hours',
            runs({ created_at: '2026-11-01T00:00:00Z' }),
            runs(mainSuccess),
        ],
        [
            'the scheduled receipt is in the future',
            runs({ created_at: '2026-11-04T00:00:00Z' }),
            runs(mainSuccess),
        ],
    ])('is unhealthy when %s', (_case, scheduledRuns, mainRuns) => {
        assert.equal(workflowHealth(scheduledRuns, mainRuns, repository, now).status, 'unhealthy')
    })

    test('rejects a response without a run list', () => {
        assert.throws(() => workflowHealth({}, runs(mainSuccess), repository, now), /Invalid GitHub/)
    })
})

describe('checkWorkflow', () => {
    test('reads a full workflow page larger than the default subprocess buffer', () => {
        const directory = mkdtempSync(join(tmpdir(), 'maestro-health-test-'))
        const responsePath = join(directory, 'response.json')
        // A captured GitHub response averages about 14 KB per run, mostly repository metadata.
        const run = {
            ...mainSuccess,
            event: 'schedule',
            created_at: new Date(Date.now() - 60_000).toISOString(),
            metadata: 'x'.repeat(14_000),
        }
        const response = JSON.stringify(runs(...Array.from({ length: 100 }, () => run)))
        assert(Buffer.byteLength(response) > 1024 * 1024)
        try {
            writeFileSync(responsePath, response)
            // Exercise real subprocess buffering with the options used for gh, without network access.
            const printResponse = (_command, _args, options) =>
                execFileSync(
                    process.execPath,
                    [
                        '-e',
                        'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))',
                        responsePath,
                    ],
                    options,
                )
            assert.equal(checkWorkflow('security.yml', repository, printResponse).status, 'healthy')
        } finally {
            rmSync(directory, { recursive: true, force: true })
        }
    })

    test('reports an API failure without preventing checks of the remaining workflows', () => {
        const checked = []
        const failSecurityWorkflow = (_command, args) => {
            checked.push(args[1])
            if (args[1].includes('/security.yml/')) throw new Error('HTTP 502')
            return JSON.stringify(runs())
        }
        const results = ['security.yml', 'security-remediation.yml', 'security-runtimes.yml'].map(workflow =>
            checkWorkflow(workflow, repository, failSecurityWorkflow),
        )
        assert.equal(results[0].status, 'unhealthy')
        assert.match(results[0].reason, /HTTP 502/)
        assert(checked.some(path => path.includes('/security-remediation.yml/')))
        assert(checked.some(path => path.includes('/security-runtimes.yml/')))
    })
})

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from '@jest/globals'
import { checkWorkflow, workflowHealth } from './health.mjs'

test('recognizes recovery on main while retaining a recent scheduled-run receipt', () => {
    const repository = 'owner/repo'
    const now = new Date('2026-11-03T22:00:00Z')
    const scheduled = { workflow_runs: [{ created_at: '2026-11-03T06:00:00Z', conclusion: 'failure' }] }
    const success = {
        head_branch: 'main',
        head_repository: { full_name: repository },
        event: 'workflow_dispatch',
        status: 'completed',
        conclusion: 'success',
    }
    const recent = { workflow_runs: [success] }
    assert.equal(workflowHealth(scheduled, recent, repository, now).status, 'healthy')
    assert.equal(
        workflowHealth(
            scheduled,
            { workflow_runs: [{ ...success, conclusion: 'failure' }, success] },
            repository,
            now,
        ).status,
        'unhealthy',
    )
    assert.equal(
        workflowHealth(scheduled, { workflow_runs: [{ ...success, event: 'pull_request' }] }, repository, now)
            .status,
        'unhealthy',
    )
    assert.equal(
        workflowHealth(
            scheduled,
            { workflow_runs: [{ ...success, head_repository: { full_name: 'fork/repo' } }] },
            repository,
            now,
        ).status,
        'unhealthy',
    )
    assert.equal(workflowHealth({ workflow_runs: [] }, recent, repository, now).status, 'unhealthy')
    assert.equal(
        workflowHealth({ workflow_runs: [{ created_at: '2026-11-01T00:00:00Z' }] }, recent, repository, now)
            .status,
        'unhealthy',
    )
    assert.equal(
        workflowHealth({ workflow_runs: [{ created_at: '2026-11-04T00:00:00Z' }] }, recent, repository, now)
            .status,
        'unhealthy',
    )
    assert.throws(() => workflowHealth({}, recent, repository, now), /Invalid GitHub/)
})

test('reads a full workflow page larger than the default subprocess buffer', () => {
    const directory = mkdtempSync(join(tmpdir(), 'maestro-health-test-'))
    const responsePath = join(directory, 'response.json')
    // A captured GitHub response averages about 14 KB per run, mostly repository metadata.
    const response = JSON.stringify({
        workflow_runs: Array.from({ length: 100 }, () => ({
            created_at: new Date(Date.now() - 60_000).toISOString(),
            head_branch: 'main',
            head_repository: { full_name: 'owner/repo' },
            event: 'schedule',
            status: 'completed',
            conclusion: 'success',
            metadata: 'x'.repeat(14_000),
        })),
    })
    assert(Buffer.byteLength(response) > 1024 * 1024)
    try {
        writeFileSync(responsePath, response)
        // Exercise real subprocess buffering with the options used for gh, without network access.
        const run = (_command, _args, options) =>
            execFileSync(
                process.execPath,
                [
                    '-e',
                    'process.stdout.write(require("node:fs").readFileSync(process.argv[1]))',
                    responsePath,
                ],
                options,
            )
        assert.equal(checkWorkflow('security.yml', 'owner/repo', run).status, 'healthy')
    } finally {
        rmSync(directory, { recursive: true, force: true })
    }
})

test('reports an API failure without preventing checks of the remaining workflows', () => {
    const checked = []
    const run = (_command, args) => {
        checked.push(args[1])
        if (args[1].includes('/security.yml/')) throw new Error('HTTP 502')
        return JSON.stringify({ workflow_runs: [] })
    }
    const results = ['security.yml', 'security-remediation.yml', 'security-runtimes.yml'].map(workflow =>
        checkWorkflow(workflow, 'owner/repo', run),
    )
    assert.equal(results.length, 3)
    assert.equal(results[0].status, 'unhealthy')
    assert.match(results[0].reason, /HTTP 502/)
    assert(checked.some(path => path.includes('/security-remediation.yml/')))
    assert(checked.some(path => path.includes('/security-runtimes.yml/')))
})

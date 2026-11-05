import assert from 'node:assert/strict'
import { test } from '@jest/globals'
import { workflowHealth } from './health.mjs'

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

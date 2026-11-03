import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export const workflowHealth = (scheduled, recent, repository, now = new Date()) => {
    if (!Array.isArray(scheduled.workflow_runs) || !Array.isArray(recent.workflow_runs))
        throw new Error('Invalid GitHub workflow run response')
    const receipt = scheduled.workflow_runs[0]
    const age = now - new Date(receipt?.created_at)
    if (!receipt || !Number.isFinite(age) || age > 36 * 60 * 60 * 1000 || age < 0)
        return { status: 'unhealthy', reason: 'No valid scheduled run receipt within 36 hours' }
    const latest = recent.workflow_runs.find(
        run =>
            run.head_branch === 'main' &&
            run.head_repository?.full_name === repository &&
            ['push', 'schedule', 'workflow_dispatch'].includes(run.event) &&
            run.status === 'completed',
    )
    if (!latest || latest.conclusion !== 'success')
        return {
            status: 'unhealthy',
            reason: `Latest completed main run is ${latest?.conclusion ?? 'missing'}`,
            url: latest?.html_url,
        }
    return {
        status: 'healthy',
        reason: 'Recent scheduled receipt and successful latest completed main run',
        url: latest.html_url,
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const repository = process.env.GH_REPO
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('GH_REPO must name the repository')
    const request = path => JSON.parse(execFileSync('gh', ['api', path], { encoding: 'utf8' }))
    for (const workflow of ['security.yml', 'security-remediation.yml', 'security-runtimes.yml']) {
        const base = `repos/${repository}/actions/workflows/${workflow}/runs?branch=main`
        const result = workflowHealth(
            request(`${base}&event=schedule&per_page=1`),
            request(`${base}&per_page=100`),
            repository,
        )
        const line = `${workflow}: ${result.status}. ${result.reason}. ${result.url ?? ''}`
        console.log(line)
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`)
        if (result.status !== 'healthy') process.exitCode = 1
    }
}

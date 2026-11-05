import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Checks that each scheduled security workflow still runs and that its latest result on main passed.

const monitoredWorkflows = ['security.yml', 'security-remediation.yml', 'security-runtimes.yml']
const maxReceiptAge = 36 * 60 * 60 * 1000
const mainRunEvents = ['push', 'schedule', 'workflow_dispatch']

// A receipt proves the schedule fired recently, whatever its result. A future timestamp is invalid.
const isRecentReceipt = (run, now) => {
    const age = now - new Date(run?.created_at)
    return Boolean(run) && Number.isFinite(age) && age >= 0 && age <= maxReceiptAge
}

// Pull request runs and fork branches named main do not speak for this repository's main.
const isCompletedMainRun = (run, repository) =>
    run.head_branch === 'main' &&
    run.head_repository?.full_name === repository &&
    mainRunEvents.includes(run.event) &&
    run.status === 'completed'

// `scheduled` holds the newest scheduled run; `recent` holds main runs newest first.
export const workflowHealth = (scheduled, recent, repository, now = new Date()) => {
    if (!Array.isArray(scheduled.workflow_runs) || !Array.isArray(recent.workflow_runs))
        throw new Error('Invalid GitHub workflow run response')
    if (!isRecentReceipt(scheduled.workflow_runs[0], now))
        return { status: 'unhealthy', reason: 'No valid scheduled run receipt within 36 hours' }

    const latest = recent.workflow_runs.find(run => isCompletedMainRun(run, repository))
    if (latest?.conclusion !== 'success')
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

const checkWorkflow = (workflow, repository) => {
    const runs = query =>
        JSON.parse(
            execFileSync(
                'gh',
                ['api', `repos/${repository}/actions/workflows/${workflow}/runs?branch=main${query}`],
                { encoding: 'utf8' },
            ),
        )
    return workflowHealth(runs('&event=schedule&per_page=1'), runs('&per_page=100'), repository)
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const repository = process.env.GH_REPO
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('GH_REPO must name the repository')
    for (const workflow of monitoredWorkflows) {
        const result = checkWorkflow(workflow, repository)
        const line = `${workflow}: ${result.status}. ${result.reason}. ${result.url ?? ''}`
        console.log(line)
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`)
        if (result.status !== 'healthy') process.exitCode = 1
    }
}

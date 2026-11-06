import { execFileSync } from 'node:child_process'
import { appendFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

// Checks that each scheduled security workflow still runs and that its latest result on main passed.
// A workflow is healthy when both hold:
//   - receipt: its newest scheduled run started within 36 hours, whatever its result;
//   - result: its newest completed run on this repository's main branch succeeded. A later push or
//     manual run that succeeds clears a failed scheduled run without waiting for the next schedule.

const monitoredWorkflows = ['security.yml', 'security-remediation.yml', 'security-runtimes.yml']
const maxReceiptAge = 36 * 60 * 60 * 1000
const mainRunEvents = ['push', 'schedule', 'workflow_dispatch']

// A future timestamp is invalid, not recent.
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

// Both arguments are GitHub "list workflow runs" responses for main, newest first: `scheduledRuns`
// filtered to schedule events, `mainRuns` unfiltered.
export const workflowHealth = (scheduledRuns, mainRuns, repository, now = new Date()) => {
    if (!Array.isArray(scheduledRuns.workflow_runs) || !Array.isArray(mainRuns.workflow_runs))
        throw new Error('Invalid GitHub workflow run response')
    if (!isRecentReceipt(scheduledRuns.workflow_runs[0], now))
        return { status: 'unhealthy', reason: 'No valid scheduled run receipt within 36 hours' }

    const latest = mainRuns.workflow_runs.find(run => isCompletedMainRun(run, repository))
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

export const checkWorkflow = (workflow, repository, run = execFileSync) => {
    const listMainRuns = query =>
        JSON.parse(
            run(
                'gh',
                ['api', `repos/${repository}/actions/workflows/${workflow}/runs?branch=main${query}`],
                // Full run records include repository metadata; 100 runs exceed the 1 MiB default.
                { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
            ),
        )
    try {
        return workflowHealth(
            listMainRuns('&event=schedule&per_page=1'),
            listMainRuns('&per_page=100'),
            repository,
        )
    } catch (error) {
        // One unavailable workflow must not hide the remaining workflows' health.
        return { status: 'unhealthy', reason: `Unable to check workflow: ${error.message}` }
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const repository = process.env.GH_REPO
    if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) throw new Error('GH_REPO must name the repository')
    for (const workflow of monitoredWorkflows) {
        const result = checkWorkflow(workflow, repository)
        const line = `${workflow}: ${result.status}. ${result.reason}.${result.url ? ` ${result.url}` : ''}`
        console.log(line)
        if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `- ${line}\n`)
        if (result.status !== 'healthy') process.exitCode = 1
    }
}

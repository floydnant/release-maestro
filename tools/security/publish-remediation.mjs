import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dependencyInputs as inputs } from './remediation.mjs'

const branch = 'security/automated-remediation'
const botName = 'release-maestro-ci[bot]'
// Matches Dependabot's prefix so release-please lists the merge under Dependencies.
const commitSubject = 'deps: remediate verified npm vulnerabilities'

const run = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim()

// Publishes the verified remediation in the working tree as a single bot commit on `branch`, and opens or
// updates its PR. Never overwrites commits a human pushed to the branch.
export const publishRemediation = (repo, report, runCommand = run) => {
    const gh = args => runCommand('gh', args)
    const git = args => runCommand('git', args)

    // The checkout must still be the main revision that remediation scanned.
    const main = JSON.parse(gh(['api', `repos/${repo}/git/ref/heads/main`])).object.sha
    if (main !== git(['rev-parse', 'HEAD']))
        throw new Error('main changed during remediation; retry on current main')

    const prs = JSON.parse(
        gh([
            'pr',
            'list',
            '--repo',
            repo,
            '--head',
            branch,
            '--base',
            'main',
            '--json',
            'number,author,headRefOid,isCrossRepository,url',
        ]),
    )
    // A fork can reuse the branch name; only a same-repository PR is the automation PR.
    const pr = prs.find(candidate => !candidate.isCrossRepository)
    if (pr && pr.author.login !== 'app/release-maestro-ci')
        throw new Error('The remediation PR is not owned by Release Maestro CI')

    if (!report.packages.some(p => p.status === 'fixed')) {
        // Close the PR only when nothing is left to fix. Unresolved findings keep it open for a later run.
        if (pr && report.packages.length === 0) gh(['pr', 'close', String(pr.number), '--repo', repo])
        console.log('No verified remediation changes to publish')
        return
    }

    // Every commit the branch adds on top of main must be a bot remediation commit that touches only
    // dependency inputs. Anything else is a human edit that a force-push would destroy.
    const assertOnlyBotCommits = remote => {
        const commits = git(['log', `${main}..${remote}`, '--format=%H\t%an\t%cn\t%s'])
        for (const line of commits.split('\n').filter(Boolean)) {
            const [sha, author, committer, subject] = line.split('\t')
            const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha])
                .split('\n')
                .filter(Boolean)
            if (
                author !== botName ||
                committer !== author ||
                subject !== commitSubject ||
                paths.some(path => !inputs.includes(path))
            )
                throw new Error(
                    'The remediation branch contains an unexpected commit; resolve human edits before retrying',
                )
        }
    }

    const refs = gh(['api', `repos/${repo}/git/matching-refs/heads/${branch}`])
    const remote = JSON.parse(refs).find(ref => ref.ref === `refs/heads/${branch}`)?.object.sha
    if (remote) {
        git(['fetch', 'origin', branch])
        assertOnlyBotCommits(remote)
    }

    // A failed lookup leaves some fixes unknown. Replacing the branch now could drop a fix an earlier run
    // published, so keep it until a run completes.
    const failed = report.packages.filter(p => p.status === 'failed')
    if (remote && failed.length) {
        console.log(
            `Preparation failed for ${failed.map(p => p.name).join(', ')}; keeping the existing remediation branch`,
        )
        return
    }

    // Rebuild from scanned main, but do not push an identical dependency change every day.
    if (!remote || git(['diff', remote, '--', ...inputs]) || git(['rev-list', `${remote}..${main}`])) {
        git(['checkout', '-B', branch])
        git(['config', 'user.name', botName])
        git(['config', 'user.email', `${botName}@users.noreply.github.com`])
        git(['add', '--', ...inputs])
        git(['commit', '-m', commitSubject])
        // The lease fails the push if someone moved the branch since it was checked above.
        git([
            'push',
            `--force-with-lease=refs/heads/${branch}:${remote ?? ''}`,
            'origin',
            `HEAD:refs/heads/${branch}`,
        ])
    }

    const args = ['--repo', repo, '--title', commitSubject, '--body-file', 'dist/security/remediation-pr.md']
    const url = pr
        ? gh(['pr', 'edit', String(pr.number), ...args])
        : gh(['pr', 'create', '--head', branch, '--base', 'main', ...args])
    console.log(url)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    try {
        if (!process.env.GH_REPO || !process.env.GH_TOKEN)
            throw new Error('GH_REPO and the Release Maestro CI App token are required')
        publishRemediation(
            process.env.GH_REPO,
            JSON.parse(readFileSync('dist/security/remediation.json', 'utf8')),
        )
    } catch (error) {
        console.error(error.message)
        process.exitCode = 1
    }
}

import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dependencyInputs } from './remediation.mjs'
// The Release Maestro CI App appears under one name in commits and another as a PR author.
const botName = 'release-maestro-ci[bot]'
const botLogin = 'app/release-maestro-ci'
const run = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim()

// Publishes the verified remediation in the working tree as a single bot commit on `branch`, and opens or
// updates its PR. Never overwrites commits a human pushed to the branch.
// Keep the deps: prefix so release-please lists these fixes under Dependencies.
export const publishRemediation = (repo, report, runCommand = run) => {
    if (report.mode !== 'apply') throw new Error('Only applied remediation can be published')
    const branch = 'security/automated-remediation'
    const inputs = dependencyInputs
    const commitSubject = 'deps: remediate verified security vulnerabilities'
    const legacySubject = 'deps: remediate verified npm vulnerabilities'
    const bodyFile = 'dist/security/remediation-pr.md'
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
    if (pr && pr.author.login !== botLogin)
        throw new Error('The remediation PR is not owned by Release Maestro CI')

    const failed = report.packages.filter(p => p.status === 'failed')

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
                ![commitSubject, legacySubject].includes(subject) ||
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

    if (!report.packages.some(p => p.status === 'fixed')) {
        // Preserve human work even when a completed run makes the previous bot update obsolete.
        if (pr && !failed.length) gh(['pr', 'close', String(pr.number), '--repo', repo])
        console.log('No verified remediation changes to publish')
        return
    }

    // A failed lookup leaves some fixes unknown. Replacing the branch now could drop a fix an earlier run
    // published, so keep it until a run completes.
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

    const args = ['--repo', repo, '--title', commitSubject, '--body-file', bodyFile]
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

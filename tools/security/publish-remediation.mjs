import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { dependencyInputs as inputs } from './remediation.mjs'

const branch = 'security/automated-remediation'
// Matches Dependabot's prefix so release-please lists the merge under Dependencies.
const commitSubject = 'deps: remediate verified npm vulnerabilities'
const run = (command, args) =>
    execFileSync(command, args, { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }).trim()
export const publishRemediation = (repo, report, runCommand = run) => {
    const gh = args => runCommand('gh', args)
    const git = args => runCommand('git', args)
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
            'number,author,headRefOid,url',
        ]),
    )
    const pr = prs[0]
    if (pr && pr.author.login !== 'app/release-maestro-ci')
        throw new Error('The remediation PR is not owned by Release Maestro CI')
    if (!report.packages.some(p => p.status === 'fixed')) {
        if (pr && report.packages.length === 0) gh(['pr', 'close', String(pr.number), '--repo', repo])
        console.log('No verified remediation changes to publish')
    } else {
        const refs = gh(['api', `repos/${repo}/git/matching-refs/heads/${branch}`])
        const remote = JSON.parse(refs).find(ref => ref.ref === `refs/heads/${branch}`)?.object.sha
        if (remote) {
            git(['fetch', 'origin', branch])
            const commits = git(['log', `${main}..${remote}`, '--format=%H\t%an\t%cn\t%s'])
            for (const line of commits.split('\n').filter(Boolean)) {
                const [sha, author, committer, subject] = line.split('\t')
                const paths = git(['diff-tree', '--no-commit-id', '--name-only', '-r', sha])
                    .split('\n')
                    .filter(Boolean)
                if (
                    author !== 'release-maestro-ci[bot]' ||
                    committer !== author ||
                    subject !== commitSubject ||
                    paths.some(path => !inputs.includes(path))
                )
                    throw new Error(
                        'The remediation branch contains an unexpected commit; resolve human edits before retrying',
                    )
            }
        }
        // Rebuild from scanned main, but do not push an identical dependency change every day.
        if (!remote || git(['diff', remote, '--', ...inputs]) || git(['rev-list', `${remote}..${main}`])) {
            git(['checkout', '-B', branch])
            git(['config', 'user.name', 'release-maestro-ci[bot]'])
            git(['config', 'user.email', 'release-maestro-ci[bot]@users.noreply.github.com'])
            git(['add', '--', ...inputs])
            git(['commit', '-m', commitSubject])
            git([
                'push',
                `--force-with-lease=refs/heads/${branch}:${remote ?? ''}`,
                'origin',
                `HEAD:refs/heads/${branch}`,
            ])
        }
        const args = [
            '--repo',
            repo,
            '--title',
            commitSubject,
            '--body-file',
            'dist/security/remediation-pr.md',
        ]
        const url = pr
            ? gh(['pr', 'edit', String(pr.number), ...args])
            : gh(['pr', 'create', '--head', branch, '--base', 'main', ...args])
        console.log(url)
    }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    if (!process.env.GH_REPO || !process.env.GH_TOKEN)
        throw new Error('GH_REPO and the Release Maestro CI App token are required')
    publishRemediation(
        process.env.GH_REPO,
        JSON.parse(readFileSync('dist/security/remediation.json', 'utf8')),
    )
}

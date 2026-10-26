import assert from 'node:assert/strict'
import { test } from '@jest/globals'
import { nodeRuntimePublication, publishRemediation } from './publish-remediation.mjs'

const automationCommit =
    'tip\trelease-maestro-ci[bot]\trelease-maestro-ci[bot]\tdeps: remediate verified npm vulnerabilities'

// `commits` is the `git log` output for the branch, one `sha\tauthor\tcommitter\tsubject` line per commit.
const harness = ({
    main = 'base',
    remote,
    commits = automationCommit,
    changed = true,
    pr = null,
    branch = 'security/automated-remediation',
} = {}) => {
    const calls = []
    const run = (command, args) => {
        calls.push([command, ...args])
        if (command === 'gh' && args[0] === 'api') {
            if (args[1].includes('/git/ref/heads/main')) return JSON.stringify({ object: { sha: main } })
            if (args[1].includes('/git/matching-refs/'))
                return JSON.stringify(
                    remote ? [{ ref: `refs/heads/${branch}`, object: { sha: remote } }] : [],
                )
        }
        if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') return JSON.stringify(pr ? [pr] : [])
        if (command === 'git' && args[0] === 'rev-parse') return 'base'
        if (command === 'git' && args[0] === 'log') return commits
        if (command === 'git' && args[0] === 'diff') return changed ? 'diff' : ''
        return ''
    }
    // Whether any call starts with `prefix`, such as `ran('gh', 'pr', 'close')`.
    const ran = (...prefix) => calls.some(call => prefix.every((part, index) => call[index] === part))
    return { calls, ran, run }
}
const fixed = { packages: [{ status: 'fixed' }] }
const botPr = { number: 10, author: { login: 'app/release-maestro-ci' } }

test('publishes a fix with an explicit creation lease and the generated PR body', () => {
    const { calls, run } = harness()
    publishRemediation('owner/repo', fixed, run)
    assert(calls.some(c => c.includes('--force-with-lease=refs/heads/security/automated-remediation:')))
    assert(calls.some(c => c[0] === 'gh' && c[2] === 'create' && c.includes('--body-file')))
})

test('an identical retry edits the existing PR but does not create a commit or push', () => {
    const { ran, run } = harness({ remote: 'prior', changed: false, pr: botPr })
    publishRemediation('owner/repo', fixed, run)
    assert(!ran('git', 'commit') && !ran('git', 'push'))
    assert(ran('gh', 'pr', 'edit'))
})

test('a changed fix pushes with the previously observed branch SHA as its lease', () => {
    const { calls, run } = harness({ remote: 'prior', pr: botPr })
    publishRemediation('owner/repo', fixed, run)
    assert(calls.some(c => c.includes('--force-with-lease=refs/heads/security/automated-remediation:prior')))
})

test('a moved main revision stops before PR or branch writes', () => {
    const { calls, run } = harness({ main: 'new-main' })
    assert.throws(() => publishRemediation('owner/repo', fixed, run), /main changed/)
    assert.equal(calls.length, 2)
})

test('human edits and a PR owned by another actor cannot be overwritten', () => {
    const human = harness({ remote: 'prior', commits: 'tip\tHuman\tHuman\tfix: manual change', pr: botPr })
    assert.throws(() => publishRemediation('owner/repo', fixed, human.run), /human edits/)
    const other = harness({ pr: { ...botPr, author: { login: 'human' } } })
    assert.throws(() => publishRemediation('owner/repo', fixed, other.run), /not owned/)
})

test('no fix creates no branch and closes an obsolete automation PR', () => {
    const { ran, run } = harness({ pr: botPr })
    publishRemediation('owner/repo', { packages: [] }, run)
    assert(!ran('git', 'push'))
    assert(ran('gh', 'pr', 'close'))
})

test.each(['unresolved', 'covered'])(
    'a completed run with only %s packages closes the stale remediation PR',
    status => {
        const { ran, run } = harness({ remote: 'prior', pr: botPr })
        publishRemediation('owner/repo', { packages: [{ status }] }, run)
        assert(ran('gh', 'pr', 'close'))
        assert(!ran('git', 'commit') && !ran('git', 'push'))
    },
)

test('a run with only failed packages preserves the existing remediation PR', () => {
    const { ran, run } = harness({ pr: botPr })
    publishRemediation('owner/repo', { packages: [{ status: 'failed' }] }, run)
    assert(!ran('gh', 'pr', 'close'))
    assert(!ran('git', 'commit') && !ran('git', 'push'))
})

test('a human commit below an automation tip also stops publication', () => {
    const commits = `${automationCommit}\nolder\tHuman\tHuman\tfix: manual change`
    const { ran, run } = harness({ remote: 'prior', commits, pr: botPr })
    assert.throws(() => publishRemediation('owner/repo', fixed, run), /human edits/)
    assert(!ran('git', 'push'))
})

test('a bot-authored commit with an unexpected subject stops publication', () => {
    const commits = 'tip\trelease-maestro-ci[bot]\trelease-maestro-ci[bot]\tfix: hand-written change'
    const { run } = harness({ remote: 'prior', commits, pr: botPr })
    assert.throws(() => publishRemediation('owner/repo', fixed, run), /human edits/)
})

test('a failed package keeps the existing branch so a transient error cannot drop an earlier fix', () => {
    const { ran, run } = harness({ remote: 'prior', pr: botPr })
    publishRemediation(
        'owner/repo',
        { packages: [{ status: 'fixed' }, { name: 'b', status: 'failed' }] },
        run,
    )
    assert(!ran('git', 'commit') && !ran('git', 'push'))
    assert(!ran('gh', 'pr', 'edit') && !ran('gh', 'pr', 'create'))
})

test('a fork PR from the reserved branch name neither blocks nor receives publication', () => {
    const fork = { number: 11, author: { login: 'someone' }, isCrossRepository: true }
    const { ran, run } = harness({ pr: fork })
    publishRemediation('owner/repo', fixed, run)
    assert(ran('gh', 'pr', 'create'))
})

test('runtime publication owns a separate branch, body, commit subject, and input list', () => {
    const { calls, run } = harness()
    publishRemediation('owner/repo', { ...fixed, mode: 'apply' }, run, nodeRuntimePublication)
    assert(calls.some(c => c.includes('--force-with-lease=refs/heads/security/node-runtime:')))
    assert(calls.some(c => c.includes('dist/security/node-runtime-pr.md')))
    assert.deepEqual(
        calls.find(c => c[0] === 'git' && c[1] === 'add'),
        ['git', 'add', '--', 'package.json', '.node-version'],
    )
    assert(
        calls.some(
            c => c[0] === 'git' && c[1] === 'commit' && c.includes('deps: update Node.js security releases'),
        ),
    )
})

test('runtime retries reuse the PR and do not push identical updates', () => {
    const { ran, run } = harness({
        branch: 'security/node-runtime',
        remote: 'prior',
        pr: botPr,
        changed: false,
        commits:
            'tip\trelease-maestro-ci[bot]\trelease-maestro-ci[bot]\tdeps: update Node.js security releases',
    })
    publishRemediation('owner/repo', { ...fixed, mode: 'apply' }, run, nodeRuntimePublication)
    assert(ran('gh', 'pr', 'edit'))
    assert(!ran('git', 'commit') && !ran('git', 'push'))
})

test('runtime preview reports can never create or update a PR', () => {
    const { calls, run } = harness()
    assert.throws(
        () => publishRemediation('owner/repo', { ...fixed, mode: 'plan' }, run, nodeRuntimePublication),
        /Only applied/,
    )
    assert.deepEqual(calls, [])
})

test('human commits prevent closing even an obsolete automation PR', () => {
    const { ran, run } = harness({
        remote: 'prior',
        pr: botPr,
        commits: 'tip\tHuman\tHuman\tfix: manual change',
    })
    assert.throws(() => publishRemediation('owner/repo', { packages: [] }, run), /human edits/)
    assert(!ran('gh', 'pr', 'close'))
})

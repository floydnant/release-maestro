import assert from 'node:assert/strict'
import { test } from '@jest/globals'
import { publishRemediation } from './publish-remediation.mjs'

const harness = ({
    main = 'base',
    remote,
    author = 'release-maestro-ci[bot]',
    changed = true,
    pr = null,
} = {}) => {
    const calls = []
    const run = (command, args) => {
        calls.push([command, ...args])
        if (command === 'gh' && args[0] === 'api') {
            if (args[1].includes('/git/ref/heads/main')) return JSON.stringify({ object: { sha: main } })
            if (args[1].includes('/git/matching-refs/'))
                return JSON.stringify(
                    remote
                        ? [{ ref: 'refs/heads/security/automated-remediation', object: { sha: remote } }]
                        : [],
                )
        }
        if (command === 'gh' && args[0] === 'pr' && args[1] === 'list') return JSON.stringify(pr ? [pr] : [])
        if (command === 'git' && args[0] === 'rev-parse') return 'base'
        if (command === 'git' && args[0] === 'log')
            return `prior\t${author}\t${author}\tdeps: remediate verified npm vulnerabilities`
        if (command === 'git' && args[0] === 'diff') return changed ? 'diff' : ''
        return ''
    }
    return { calls, run }
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
    const { calls, run } = harness({ remote: 'prior', changed: false, pr: botPr })
    publishRemediation('owner/repo', fixed, run)
    assert(!calls.some(c => c[0] === 'git' && ['commit', 'push'].includes(c[1])))
    assert(calls.some(c => c[0] === 'gh' && c[2] === 'edit'))
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
    const human = harness({ remote: 'prior', author: 'Human', pr: botPr })
    assert.throws(() => publishRemediation('owner/repo', fixed, human.run), /human edits/)
    const other = harness({ pr: { ...botPr, author: { login: 'human' } } })
    assert.throws(() => publishRemediation('owner/repo', fixed, other.run), /not owned/)
})

test('no fix creates no branch and closes an obsolete automation PR', () => {
    const { calls, run } = harness({ pr: botPr })
    publishRemediation('owner/repo', { packages: [] }, run)
    assert(!calls.some(c => c[0] === 'git' && c[1] === 'push'))
    assert(calls.some(c => c[0] === 'gh' && c[2] === 'close'))
})

test.each(['unresolved', 'covered'])(
    'a completed run with only %s packages closes the stale remediation PR',
    status => {
        const { calls, run } = harness({ remote: 'prior', pr: botPr })
        publishRemediation('owner/repo', { packages: [{ status }] }, run)
        assert(calls.some(c => c[0] === 'gh' && c[2] === 'close'))
        assert(!calls.some(c => c[0] === 'git' && ['commit', 'push'].includes(c[1])))
    },
)

test('a run with only failed packages preserves the existing remediation PR', () => {
    const { calls, run } = harness({ pr: botPr })
    publishRemediation('owner/repo', { packages: [{ status: 'failed' }] }, run)
    assert(!calls.some(c => c[0] === 'gh' && c[2] === 'close'))
    assert(!calls.some(c => c[0] === 'git' && ['commit', 'push'].includes(c[1])))
})

test('a human commit below an automation tip also stops publication', () => {
    const h = harness({ remote: 'prior', pr: botPr })
    const run = (command, args) =>
        command === 'git' && args[0] === 'log'
            ? 'tip\trelease-maestro-ci[bot]\trelease-maestro-ci[bot]\tdeps: remediate verified npm vulnerabilities\nolder\tHuman\tHuman\tfix: manual change'
            : h.run(command, args)
    assert.throws(() => publishRemediation('owner/repo', fixed, run), /human edits/)
    assert(!h.calls.some(c => c[0] === 'git' && c[1] === 'push'))
})

test('a bot-authored commit with an unexpected subject stops publication', () => {
    const h = harness({ remote: 'prior', pr: botPr })
    const run = (command, args) =>
        command === 'git' && args[0] === 'log'
            ? 'tip\trelease-maestro-ci[bot]\trelease-maestro-ci[bot]\tfix: hand-written change'
            : h.run(command, args)
    assert.throws(() => publishRemediation('owner/repo', fixed, run), /human edits/)
})

test('a failed package keeps the existing branch so a transient error cannot drop an earlier fix', () => {
    const { calls, run } = harness({ remote: 'prior', pr: botPr })
    publishRemediation(
        'owner/repo',
        { packages: [{ status: 'fixed' }, { name: 'b', status: 'failed' }] },
        run,
    )
    assert(!calls.some(c => c[0] === 'git' && ['commit', 'push'].includes(c[1])))
    assert(!calls.some(c => c[0] === 'gh' && c[1] === 'pr' && ['edit', 'create'].includes(c[2])))
})

test('a fork PR from the reserved branch name neither blocks nor receives publication', () => {
    const fork = { number: 11, author: { login: 'someone' }, isCrossRepository: true }
    const { calls, run } = harness()
    const forkRun = (command, args) =>
        command === 'gh' && args[0] === 'pr' && args[1] === 'list'
            ? JSON.stringify([fork])
            : run(command, args)
    publishRemediation('owner/repo', fixed, forkRun)
    assert(calls.some(c => c[0] === 'gh' && c[2] === 'create'))
})

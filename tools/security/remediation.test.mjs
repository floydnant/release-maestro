import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import prettier from 'prettier'
import { test } from '@jest/globals'
import { remediationInputs } from '../fixtures/security-remediation.mjs'
import {
    applyFirstEligibleFix,
    applyVerifiedFix,
    currentPrContainsMain,
    eligibleVersions,
    lockVersions,
    npmFindings,
    remediationBody,
    scopedOverrides,
    verifiedRemediation,
} from './remediation.mjs'

test('waits exactly three days, skips missing timestamps, prereleases, and deprecated releases', () => {
    const { group, advisories, registry, now } = remediationInputs()
    assert.deepEqual(eligibleVersions(group, advisories, registry, 4320, now), ['1.1.0', '1.1.1'])
    assert.deepEqual(eligibleVersions(group, advisories, registry, 4320, new Date('2026-10-13')), [
        '1.1.0',
        '1.1.1',
        '1.2.0',
    ])
    assert.throws(() => eligibleVersions(group, advisories, registry, undefined, now), /release age/)
})

test('an advisory without a matching published fix cannot produce a candidate', () => {
    const { group, registry, now } = remediationInputs()
    assert.deepEqual(eligibleVersions(group, [{ affected: [] }], registry, 4320, now), [])
})

test('groups accepted and blocked findings, including all vulnerable versions and advisories', () => {
    const { findings } = remediationInputs()
    assert.deepEqual(
        npmFindings([
            ...findings,
            { ...findings[0], version: '1.0.1', id: 'GHSA-other', status: 'accepted' },
        ]),
        [{ name: 'parser', versions: ['1.0.0', '1.0.1'], ids: ['GHSA-parser', 'GHSA-other'] }],
    )
    assert.throws(() => npmFindings([{ ...findings[0], name: '--config' }]), /Invalid npm/)
})

test('a partial fix or a new finding at a changed version fails verification despite exceptions', () => {
    const { group, findings } = remediationInputs()
    assert.equal(verifiedRemediation(findings, [], group), true)
    assert.equal(verifiedRemediation(findings, [{ ...findings[0], version: '1.1.0' }], group), false)
    assert.equal(
        verifiedRemediation(
            findings,
            [{ ecosystem: 'npm', name: 'other', version: '1.0.0', id: 'GHSA-new', status: 'accepted' }],
            group,
        ),
        false,
    )
})

test('another unresolved finding does not prevent publishing a verified partial remediation', () => {
    const { group, findings } = remediationInputs()
    const other = {
        ecosystem: 'npm',
        name: 'formatter',
        version: '1.0.0',
        id: 'GHSA-no-fix',
        status: 'blocked',
    }
    assert.equal(verifiedRemediation([...findings, other], [other], group), true)
})

test('reads scoped and peer-qualified versions from all lockfile documents', () => {
    assert.deepEqual(
        lockVersions(
            [
                { packages: { '@app/parser@1.0.0(peer@2.0.0)': {}, '@app/parser-extra@1.0.0': {} } },
                { packages: { '@app/parser@1.1.0': {} } },
            ],
            '@app/parser',
        ),
        ['1.0.0', '1.1.0'],
    )
})

test('PR body distinguishes verified fixes, covered findings, and findings without fixes', () => {
    const { group } = remediationInputs()
    const body = remediationBody({
        packages: [
            { ...group, target: '1.1.0', status: 'fixed', method: 'scoped override' },
            { name: 'formatter', status: 'unresolved', reason: 'No published fix' },
        ],
        otherFindings: [],
    })
    assert.match(body, /^Closes N\/A/)
    assert.match(body, /scoped override/)
    assert.match(body, /formatter.*No published fix/)
})

test('an upstream exact pin falls back to an override after restoring a failed update', () => {
    const { group, findings } = remediationInputs()
    const events = []
    let overridden = false
    const result = applyVerifiedFix(findings, group, {
        update: () => {
            events.push('update')
        },
        scan: () => (overridden ? [] : findings),
        restore: () => {
            events.push('restore')
        },
        override: () => {
            events.push('override')
            overridden = true
        },
        policy: () => {
            events.push('policy')
        },
    })
    assert.equal(result.method, 'scoped override')
    assert.deepEqual(events, ['update', 'restore', 'override', 'policy'])
})

test('failed rescans and policy checks restore all dependency inputs', () => {
    const { group, findings } = remediationInputs()
    for (const failure of ['rescan', 'policy']) {
        let state = 'original'
        assert.throws(() =>
            applyVerifiedFix(findings, group, {
                update: () => {
                    state = 'updated'
                },
                override: () => {
                    state = 'overridden'
                },
                restore: () => {
                    state = 'original'
                },
                scan: () => (failure === 'rescan' ? findings : []),
                policy: () => {
                    throw new Error('policy rejected')
                },
            }),
        )
        assert.equal(state, 'original')
    }
})

test('policy rejection tries a later eligible release instead of failing every daily run', async () => {
    const rejected = []
    const result = await applyFirstEligibleFix(['1.1.0', '1.1.1', '1.2.0'], {
        isSafe: async () => true,
        apply: target => {
            if (target === '1.1.0') throw new Error('provenance downgrade')
            return { method: 'scoped override', resolvedVersions: [target] }
        },
        rejected: target => rejected.push(target),
    })
    assert.equal(result.target, '1.1.1')
    assert.deepEqual(rejected, ['1.1.0'])
})

test('stale Dependabot heads cannot cover packages introduced on current main', () => {
    assert.equal(currentPrContainsMain({ status: 'diverged' }), false)
    assert.equal(currentPrContainsMain({ status: 'behind' }), false)
    assert.equal(currentPrContainsMain({ status: 'ahead' }), true)
})

test('the PR reports resolved versions rather than the planner candidate', () => {
    const { group } = remediationInputs()
    const body = remediationBody({
        packages: [
            {
                ...group,
                target: '1.1.0',
                resolvedVersions: ['1.1.2'],
                status: 'fixed',
                method: 'lockfile update',
            },
        ],
        otherFindings: [],
    })
    assert.match(body, /→ 1.1.2/)
    assert.doesNotMatch(body, /→ 1.1.0/)
})

test('a newly disclosed advisory in the final scan invalidates an earlier verified fix', () => {
    const { group, findings } = remediationInputs()
    assert.equal(verifiedRemediation(findings, [], group), true)
    const final = [
        {
            ecosystem: 'npm',
            name: 'later',
            version: '1.0.0',
            id: 'GHSA-disclosed-during-run',
            status: 'blocked',
        },
    ]
    assert.equal(verifiedRemediation(findings, final, group), false)
})

test('generated scoped overrides satisfy repository formatting and preserve existing policy', async () => {
    const { group } = remediationInputs()
    const input = readFileSync('pnpm-workspace.yaml', 'utf8')
    for (const selected of [group, { ...group, name: '@app/parser' }]) {
        const output = scopedOverrides(input, selected, '1.1.0')
        const formatted = await prettier.format(output, {
            ...(await prettier.resolveConfig('pnpm-workspace.yaml')),
            filepath: 'pnpm-workspace.yaml',
        })
        assert.equal(output, formatted)
        assert(output.includes(`${selected.name}@1.0.0`))
        assert.match(output, /minimumReleaseAge: 4320/)
        assert.match(output, /axios@1.18.1: 1.20.0/)
        assert.throws(() => scopedOverrides(output, selected, '1.1.1'), /Existing override/)
    }
})

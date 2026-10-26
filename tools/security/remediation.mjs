import { parseDocument } from 'yaml'

// Pure planning and verification helpers. The scripts that call them own every command and network
// request, so everything here can be tested with plain data.

// The files a remediation may change. Snapshots, restores, and the publisher's commit all use this list.
export const dependencyInputs = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml', '.node-version']

// Accepts current lowercase names and legacy mixed-case ones such as `JSONStream`.
const npmPackageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i

// Only plain `major.minor.patch` versions are planned. Prereleases need a human decision.
export const isStableVersion = version => /^\d+\.\d+\.\d+$/.test(version)

export const compareVersions = (left, right) => {
    const a = left.split('.').map(Number)
    const b = right.split('.').map(Number)
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

export const isActionable = finding => finding.status !== 'informational'

// A verdict that a candidate does not qualify, so the next candidate may be tried. Any other error leaves the
// outcome unknown, and the package is reported as failed.
export class RejectedFix extends Error {}

// Network failures say nothing about a candidate. Every other pnpm error, such as a provenance downgrade
// under `trustPolicy`, is a verdict on it.
const transientPnpmError =
    /ERR_PNPM_(?:FETCH_\d+|META_FETCH_FAIL)|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN/

export const pnpmVerdict = error =>
    transientPnpmError.test(error.message) ? error : new RejectedFix(error.message)

// Groups actionable npm findings by package, so one fix can address every advisory and installed version.
export const npmFindings = findings => {
    const groups = new Map()
    for (const finding of findings.filter(f => f.ecosystem === 'npm' && isActionable(f))) {
        if (!npmPackageName.test(finding.name)) throw new Error(`Invalid npm package name: ${finding.name}`)

        const group = groups.get(finding.name) ?? { name: finding.name, versions: [], ids: [] }
        group.versions = [...new Set([...group.versions, finding.version])]
        group.ids = [...new Set([...group.ids, finding.id])]
        groups.set(finding.name, group)
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

// Returns the published versions a group may move to, lowest first. A candidate must:
// - be at or above the lowest stable version that any advisory lists as fixed,
// - be newer than every installed version,
// - be stable and not deprecated, and
// - have been published at least `minimumReleaseAge` minutes ago.
export const eligibleVersions = (group, advisories, registry, ageMinutes, now) => {
    const fixes = advisories.flatMap(advisory =>
        (advisory.affected ?? [])
            .filter(a => a.package?.ecosystem === 'npm' && a.package.name === group.name)
            .flatMap(a => (a.ranges ?? []).flatMap(r => r.events ?? []).map(e => e.fixed))
            .filter(version => typeof version === 'string' && isStableVersion(version)),
    )
    if (!fixes.length) return []

    const minimum = fixes.sort(compareVersions)[0]
    const current = [...group.versions].sort(compareVersions).at(-1)
    const isOldEnough = version => {
        const published = Date.parse(registry.time?.[version])
        return Number.isFinite(published) && now.getTime() - published >= ageMinutes * 60_000
    }

    return Object.keys(registry.versions ?? {})
        .filter(
            version =>
                isStableVersion(version) &&
                compareVersions(version, current) > 0 &&
                compareVersions(version, minimum) >= 0 &&
                !registry.versions[version].deprecated &&
                isOldEnough(version),
        )
        .sort(compareVersions)
}

// Whether a finding is one of the advisories this group set out to fix.
export const targetsGroup = (finding, group) =>
    finding.ecosystem === 'npm' && finding.name === group.name && group.ids.includes(finding.id)

// A fix is verified when every targeted finding is gone and nothing new appeared.
export const verifiedRemediation = (before, after, group) => {
    if (after.some(finding => targetsGroup(finding, group))) return false

    // An existing finding at a different package version is conservatively treated as new.
    const key = f => JSON.stringify([f.ecosystem, f.name, f.version, f.id])
    const existing = new Set(before.filter(isActionable).map(key))
    return after.filter(isActionable).every(f => existing.has(key(f)))
}

// Lists the versions of a package that parsed `pnpm-lock.yaml` documents resolve.
// Lockfile keys look like `name@1.2.3` or `name@1.2.3(peer@4.5.6)`.
export const lockVersions = (documents, name) => [
    ...new Set(
        documents.flatMap(document =>
            Object.keys(document.packages ?? {})
                .filter(key => key.startsWith(`${name}@`))
                .map(key => key.slice(name.length + 1).split('(')[0]),
        ),
    ),
]

// Renders the remediation PR body. Its headings follow .github/pull_request_template.md.
export const remediationBody = report => {
    const reasons = statuses =>
        report.packages
            .filter(item => statuses.includes(item.status))
            .map(item => `- \`${item.name}\`: ${item.reason}`)
    const section = (heading, items) => (items.length ? ['', `## ${heading}`, '', ...items] : [])

    const fixed = report.packages
        .filter(item => item.status === 'fixed')
        .flatMap(item => {
            if (item.ecosystem === 'Node.js')
                return [
                    `- ${item.name}${item.from === item.target && item.pinFrom ? ' runtime pin' : ' minimum'}: ${item.from === item.target && item.pinFrom ? item.pinFrom : item.from} → [${item.target}](https://nodejs.org/en/blog/release/v${item.target}).`,
                ]
            const resolved = item.resolvedVersions ?? [item.target]
            // An earlier fix can remove a package from the lockfile entirely.
            const outcome = resolved.length ? `→ ${resolved.join(', ')}` : 'removed from the lockfile'
            return [
                `- \`${item.name}\`: ${item.versions.join(', ')} ${outcome}. Method: ${item.method}.`,
                `  Advisories: ${item.ids.join(', ')}.`,
            ]
        })
    const unresolved = [
        ...reasons(['unresolved', 'failed']),
        ...report.otherFindings.map(
            item =>
                `- \`${item.ecosystem} ${item.name}@${item.version}\` ${item.id}: automatic remediation supports npm only.`,
        ),
    ]

    const lines = [
        'Closes N/A',
        '',
        '## What changed',
        '',
        'This PR contains the security updates listed below.',
        'Each npm fix removes its targeted advisories and adds no other vulnerability findings.',
        'npm releases satisfy the repository freshness and provenance policy. Node security releases do not wait for the npm age delay.',
        ...(fixed.length ? ['', ...fixed] : []),
        '',
        '## Notes',
        '',
        'Normal CI checks compatibility. Review overrides before merging, especially across major versions.',
        'The automation never extends vulnerability exceptions.',
        ...section('Planned fixes', reasons(['planned'])),
        ...section('Covered by Dependabot PRs', reasons(['covered'])),
        '',
        '## Unresolved findings',
        '',
        ...(unresolved.length ? unresolved : ['None.']),
    ]
    return `${lines.join('\n')}\n`
}

// Applies one fix and proves it with a full rescan. A rejected lockfile-only update can fall back to a
// scoped override; an unknown error stops the attempt. Any failure restores its inputs, then rethrows.
export const applyVerifiedFix = (before, group, actions) => {
    // Returns the fix when a full rescan verifies it, or null.
    const rescan = method => {
        const findings = actions.scan()
        return verifiedRemediation(before, findings, group) ? { findings, method } : null
    }

    try {
        let fix = null
        try {
            actions.update()
            fix = rescan('lockfile update')
        } catch (error) {
            // An unsupported transitive update can still be fixed with a scoped override.
            if (!(error instanceof RejectedFix)) throw error
        }

        if (!fix) {
            actions.restore()
            actions.override()
            fix = rescan('scoped override')
            if (!fix)
                throw new RejectedFix('The rescan retained targeted findings or introduced other findings')
        }

        actions.policy()
        return fix
    } catch (error) {
        actions.restore()
        throw error
    }
}

// Tries candidates in order and returns the first that is advisory-free and applies cleanly. Returns null
// when every candidate is skipped or rejected. An error other than a RejectedFix stops the search, because
// a later candidate could hit the same unknown failure.
export const applyFirstEligibleFix = async (candidates, actions) => {
    for (const target of candidates) {
        if (!(await actions.isSafe(target))) continue
        try {
            return { target, ...(await actions.apply(target)) }
        } catch (error) {
            if (!(error instanceof RejectedFix)) throw error
            actions.rejected(target, error)
        }
    }
    return null
}

// A PR branch can only cover a finding if it already contains main. Otherwise its lockfile is stale.
export const currentPrContainsMain = comparison => ['ahead', 'identical'].includes(comparison.status)

// Pins each vulnerable installed version to the target, leaving other versions of the package alone.
// An existing override for the same key is never replaced, because a maintainer added it on purpose.
export const scopedOverrides = (source, group, target) => {
    const workspace = parseDocument(source)
    if (workspace.errors.length) throw workspace.errors[0]

    if (!workspace.has('overrides')) workspace.set('overrides', workspace.createNode({}))
    for (const version of group.versions) {
        const key = `${group.name}@${version}`
        if (workspace.hasIn(['overrides', key]))
            throw new RejectedFix(`Existing override needs maintainer review: ${key}`)
        workspace.setIn(['overrides', key], target)
    }
    return workspace.toString({ indent: 4, lineWidth: 0, singleQuote: true })
}

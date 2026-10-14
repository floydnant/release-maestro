import { parseDocument } from 'yaml'

// Planning and verification are independent of registry, scanner, and GitHub transports.
const stable = version => /^\d+\.\d+\.\d+$/.test(version)
export const compareVersions = (left, right) => {
    const a = left.split('.').map(Number)
    const b = right.split('.').map(Number)
    return a[0] - b[0] || a[1] - b[1] || a[2] - b[2]
}

export const npmFindings = findings => {
    const groups = new Map()
    for (const finding of findings.filter(f => f.ecosystem === 'npm' && f.status !== 'informational')) {
        if (!/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(finding.name))
            throw new Error(`Invalid npm package name: ${finding.name}`)
        if (!stable(finding.version)) throw new Error(`Unsupported npm version: ${finding.version}`)
        const group = groups.get(finding.name) ?? { name: finding.name, versions: [], ids: [] }
        group.versions = [...new Set([...group.versions, finding.version])]
        group.ids = [...new Set([...group.ids, finding.id])]
        groups.set(finding.name, group)
    }
    return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}

export const eligibleVersions = (group, advisories, registry, ageMinutes, now) => {
    if (!Number.isFinite(ageMinutes) || ageMinutes < 0) throw new Error('Invalid minimum release age')
    const fixes = advisories.flatMap(advisory =>
        (advisory.affected ?? [])
            .filter(a => a.package?.ecosystem === 'npm' && a.package.name === group.name)
            .flatMap(a => (a.ranges ?? []).flatMap(r => r.events ?? []).map(e => e.fixed))
            .filter(version => typeof version === 'string' && stable(version)),
    )
    if (!fixes.length) return []
    const minimum = fixes.sort(compareVersions)[0]
    const current = [...group.versions].sort(compareVersions).at(-1)
    return Object.keys(registry.versions ?? {})
        .filter(version => {
            const published = Date.parse(registry.time?.[version])
            return (
                stable(version) &&
                compareVersions(version, current) > 0 &&
                compareVersions(version, minimum) >= 0 &&
                !registry.versions[version].deprecated &&
                Number.isFinite(published) &&
                now.getTime() - published >= ageMinutes * 60_000
            )
        })
        .sort(compareVersions)
}

export const verifiedRemediation = (before, after, group) => {
    const relevant = finding =>
        finding.ecosystem === 'npm' && finding.name === group.name && group.ids.includes(finding.id)
    if (after.some(relevant)) return false
    // An existing finding at a different package version is conservatively treated as new.
    const key = f => JSON.stringify([f.ecosystem, f.name, f.version, f.id])
    const existing = new Set(before.filter(f => f.status !== 'informational').map(key))
    return after.filter(f => f.status !== 'informational').every(f => existing.has(key(f)))
}

export const lockVersions = (documents, name) => [
    ...new Set(
        documents.flatMap(document =>
            Object.keys(document.packages ?? {})
                .filter(key => key.startsWith(`${name}@`))
                .map(key => key.slice(name.length + 1).split('(')[0]),
        ),
    ),
]

export const remediationBody = report => {
    const lines = [
        'Closes N/A',
        '',
        '## What changed',
        '',
        'Replace vulnerable npm dependencies with verified fixes that satisfy the repository supply-chain policy.',
        '',
    ]
    for (const item of report.packages.filter(p => p.status === 'fixed')) {
        lines.push(
            `- \`${item.name}\`: ${item.versions.join(', ')} → ${(item.resolvedVersions ?? [item.target]).join(', ')}. Method: ${item.method}.`,
            `  Advisories: ${item.ids.join(', ')}.`,
        )
    }
    lines.push(
        '',
        '## Notes',
        '',
        'The scanner verifies that each targeted finding disappears without introducing other findings.',
        'Normal CI checks compatibility. Review overrides before merging.',
        'The automation does not change vulnerability exceptions or bypass package freshness and provenance policy.',
        '',
        '## Unresolved findings',
        '',
    )
    for (const item of report.packages.filter(p => p.status !== 'fixed'))
        lines.push(`- \`${item.name}\`: ${item.reason}`)
    for (const item of report.otherFindings)
        lines.push(
            `- \`${item.ecosystem} ${item.name}@${item.version}\` ${item.id}: automatic remediation supports npm only.`,
        )
    return `${lines.join('\n')}\n`
}

// Each attempt starts from the preceding verified inputs and rolls back on any failure.
export const applyVerifiedFix = (before, group, actions) => {
    try {
        let after
        let method
        try {
            actions.update()
            after = actions.scan()
            if (verifiedRemediation(before, after, group)) method = 'lockfile update'
        } catch {
            // An unsupported transitive update can still be fixed with a scoped override.
        }
        if (!method) {
            actions.restore()
            actions.override()
            after = actions.scan()
            if (!verifiedRemediation(before, after, group))
                throw new Error('The rescan retained targeted findings or introduced other findings')
            method = 'scoped override'
        }
        actions.policy()
        return { findings: after, method }
    } catch (error) {
        actions.restore()
        throw error
    }
}

export const applyFirstEligibleFix = async (candidates, actions) => {
    for (const target of candidates) {
        if (!(await actions.isSafe(target))) continue
        try {
            return { target, ...(await actions.apply(target)) }
        } catch (error) {
            actions.rejected(target, error)
        }
    }
    return null
}

export const currentPrContainsMain = comparison => ['ahead', 'identical'].includes(comparison.status)

export const scopedOverrides = (source, group, target) => {
    const workspace = parseDocument(source)
    if (workspace.errors.length) throw workspace.errors[0]
    if (!workspace.has('overrides')) workspace.set('overrides', {})
    for (const version of group.versions) {
        const key = `${group.name}@${version}`
        if (workspace.hasIn(['overrides', key]))
            throw new Error(`Existing override needs maintainer review: ${key}`)
        workspace.setIn(['overrides', key], target)
    }
    return workspace.toString({ indent: 4, lineWidth: 0, singleQuote: true })
}

const day = 24 * 60 * 60 * 1000
// Every acceptance is re-reviewed at least this often. Renewals set a new review date.
export const maxAcceptanceDays = 30

// Parses a strict UTC calendar date, or returns null.
const utcDate = value => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return null
    const date = new Date(`${value}T00:00:00Z`)
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value ? date : null
}

export const validateExceptions = (exceptions, now = new Date()) => {
    if (!Array.isArray(exceptions)) throw new Error('Security exceptions must be an array')
    const keys = new Set()
    for (const exception of exceptions) {
        for (const field of ['ecosystem', 'name', 'version', 'id', 'reason']) {
            if (typeof exception[field] !== 'string' || !exception[field].trim()) {
                throw new Error(`Security exception requires ${field}`)
            }
        }
        if (!/^\d{4}-\d{2}-\d{2}$/.test(exception.expires ?? '')) {
            throw new Error(`Security exception requires an expiry date: ${exception.id}`)
        }
        const expires = utcDate(exception.expires)
        if (!expires) throw new Error(`Invalid security exception expiry: ${exception.id}`)
        // A future review date would stretch the window, so it is rejected; an old one only shortens it.
        const reviewed = utcDate(exception.reviewed)
        if (!reviewed || reviewed > now)
            throw new Error(`Security exception requires a past review date: ${exception.id}`)
        if (expires - reviewed > maxAcceptanceDays * day)
            throw new Error(
                `Security exception expires more than ${maxAcceptanceDays} days after review: ${exception.id}`,
            )
        if ('patch' in exception) {
            const patch = exception.patch
            const since = utcDate(patch?.since)
            if (
                !patch ||
                typeof patch !== 'object' ||
                exception.ecosystem !== 'npm' ||
                !/^patches\/[a-zA-Z0-9_@.+-]+\.patch$/.test(patch.path ?? '') ||
                !/^[a-f0-9]{64}$/.test(patch.sha256 ?? '') ||
                !since ||
                since > reviewed ||
                typeof patch.advisoryModified !== 'string' ||
                !Number.isFinite(Date.parse(patch.advisoryModified)) ||
                !Array.isArray(patch.tests) ||
                !patch.tests.length ||
                new Set(patch.tests).size !== patch.tests.length ||
                patch.tests.some(test => !/^tools\/patches\/[a-zA-Z0-9_@.+-]+\.test\.mjs$/.test(test))
            )
                throw new Error(`Invalid security patch binding: ${exception.id}`)
        }
        const key = JSON.stringify([exception.ecosystem, exception.name, exception.version, exception.id])
        if (keys.has(key)) throw new Error(`Duplicate security exception: ${exception.id}`)
        keys.add(key)
    }
}

export const evaluateScan = (report, exceptions, now = new Date()) => {
    validateExceptions(exceptions, now)
    if (!Array.isArray(report.results)) throw new Error('Invalid OSV report: missing results')
    // A scan that silently drops an ecosystem must never pass the gate.
    for (const lockfile of ['pnpm-lock.yaml', 'Cargo.lock']) {
        const source = report.results.find(result =>
            result.source?.path?.replaceAll('\\', '/').endsWith(`/${lockfile}`),
        )
        if (!source?.packages?.length) throw new Error(`OSV did not report packages from ${lockfile}`)
    }
    const findings = []
    for (const result of report.results) {
        for (const entry of result.packages) {
            for (const vulnerability of entry.vulnerabilities ?? []) {
                const pkg = entry.package
                const match = exceptions.find(
                    item =>
                        item.ecosystem === pkg.ecosystem &&
                        item.name === pkg.name &&
                        item.version === pkg.version &&
                        item.id === vulnerability.id &&
                        new Date(`${item.expires}T00:00:00Z`) > now,
                )
                // A patch was reviewed against one advisory revision. An amended advisory can describe a
                // vector the patch does not block, so it needs a new review before it is accepted again.
                const advisoryChanged =
                    match?.patch && match.patch.advisoryModified !== vulnerability.modified
                const exception = advisoryChanged ? undefined : match
                // RustSec maintenance notices are useful but are not security vulnerabilities.
                const informational =
                    vulnerability.affected?.some(affected =>
                        ['unmaintained', 'notice'].includes(affected.database_specific?.informational),
                    ) &&
                    !vulnerability.severity?.length &&
                    !vulnerability.aliases?.some(alias => alias.startsWith('CVE-'))
                findings.push({
                    ...pkg,
                    id: vulnerability.id,
                    summary: vulnerability.summary,
                    status: exception ? 'accepted' : informational ? 'informational' : 'blocked',
                    ...(exception ? { expires: exception.expires, reason: exception.reason } : {}),
                    ...(advisoryChanged
                        ? {
                              reason: `Advisory modified ${vulnerability.modified ?? 'unknown'} after the patch review (${match.patch.advisoryModified})`,
                          }
                        : {}),
                })
            }
        }
    }
    return findings
}

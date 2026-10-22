export const validateExceptions = exceptions => {
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
        const expires = new Date(`${exception.expires}T00:00:00Z`)
        if (!Number.isFinite(expires.getTime()) || expires.toISOString().slice(0, 10) !== exception.expires) {
            throw new Error(`Invalid security exception expiry: ${exception.id}`)
        }
        const key = JSON.stringify([exception.ecosystem, exception.name, exception.version, exception.id])
        if (keys.has(key)) throw new Error(`Duplicate security exception: ${exception.id}`)
        keys.add(key)
    }
}

export const evaluateScan = (report, exceptions, now = new Date()) => {
    validateExceptions(exceptions)
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
                const exception = exceptions.find(
                    item =>
                        item.ecosystem === pkg.ecosystem &&
                        item.name === pkg.name &&
                        item.version === pkg.version &&
                        item.id === vulnerability.id &&
                        new Date(`${item.expires}T00:00:00Z`) > now,
                )
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
                })
            }
        }
    }
    return findings
}

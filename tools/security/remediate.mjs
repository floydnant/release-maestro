import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseAllDocuments, parseDocument } from 'yaml'
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

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const output = join(root, 'dist/security')
const inputs = ['package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml']
const run = (command, args, allowed = [0]) => {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
    if (result.error) throw result.error
    if (!allowed.includes(result.status))
        throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`)
    return result.stdout
}
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const documents = source =>
    parseAllDocuments(source).map(document => {
        if (document.errors.length) throw document.errors[0]
        return document.toJS()
    })
const request = async (url, body) => {
    const response = await fetch(url, {
        signal: AbortSignal.timeout(30_000),
        ...(body
            ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
    })
    if (!response.ok) throw new Error(`Request failed: ${response.status} ${url}`)
    return response.json()
}
const safeVersion = async (name, version) => {
    const response = await request('https://api.osv.dev/v1/query', {
        package: { name, ecosystem: 'npm' },
        version,
    })
    if (response.vulns !== undefined && !Array.isArray(response.vulns))
        throw new Error('Invalid OSV response')
    return !response.next_page_token && !(response.vulns ?? []).some(v => !v.withdrawn)
}
const scan = () => {
    // cli.mjs removes old reports and writes findings only after a complete, valid scan.
    run(process.execPath, ['tools/security/cli.mjs', 'scan'], [0, 1])
    return json(join(output, 'findings.json'))
}

const main = async () => {
    const mode = process.argv[2]
    if (!['plan', 'apply'].includes(mode)) throw new Error('Usage: remediate.mjs plan|apply')
    if (mode === 'apply' && run('git', ['status', '--porcelain', '--', ...inputs]).trim())
        throw new Error('Commit dependency input changes before applying remediation')
    run('make', ['dependency-policy-check'])
    const config = parseDocument(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'))
    if (config.errors.length) throw config.errors[0]
    const age = config.get('minimumReleaseAge')
    const originalInputs = new Map(inputs.map(path => [path, readFileSync(join(root, path))]))
    let findings = scan()
    const originalFindings = findings
    const report = {
        packages: [],
        otherFindings: findings.filter(f => f.ecosystem !== 'npm' && f.status !== 'informational'),
    }
    const groups = npmFindings(findings)
    // Read only Dependabot PRs. Never execute code or install packages from a PR branch.
    const existing = process.env.SECURITY_EXISTING_PRS ? json(process.env.SECURITY_EXISTING_PRS) : []
    const mainRevision = run('git', ['rev-parse', 'HEAD']).trim()
    const currentPrs = existing.filter(pr => {
        const comparison = JSON.parse(
            run('gh', ['api', `repos/${process.env.GH_REPO}/compare/${mainRevision}...${pr.headRefOid}`]),
        )
        return currentPrContainsMain(comparison)
    })
    const existingLocks = currentPrs.map(pr => ({
        ...pr,
        documents: documents(
            Buffer.from(
                JSON.parse(
                    run('gh', [
                        'api',
                        `repos/${process.env.GH_REPO}/contents/pnpm-lock.yaml?ref=${pr.headRefOid}`,
                    ]),
                ).content,
                'base64',
            ).toString('utf8'),
        ),
    }))
    for (const group of groups) {
        const item = { ...group, status: 'unresolved', reason: 'No eligible published fix; retry daily.' }
        report.packages.push(item)
        const snapshot = new Map(inputs.map(path => [path, readFileSync(join(root, path))]))
        const restore = () => {
            for (const [path, bytes] of snapshot) writeFileSync(join(root, path), bytes)
        }
        try {
            const advisories = await Promise.all(
                group.ids.map(id => request(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`)),
            )
            const registry = await request(`https://registry.npmjs.org/${encodeURIComponent(group.name)}`)
            const candidates = eligibleVersions(group, advisories, registry, age, new Date())
            for (const pr of existingLocks) {
                const versions = lockVersions(pr.documents, group.name)
                if (!versions.some(version => group.versions.includes(version))) {
                    let safe = true
                    for (const version of versions)
                        if (!(await safeVersion(group.name, version))) safe = false
                    if (safe) {
                        item.status = 'covered'
                        item.reason = `Existing Dependabot PR: ${pr.url}`
                        break
                    }
                }
            }
            if (item.status === 'covered') continue
            const result = await applyFirstEligibleFix(candidates, {
                isSafe: target => safeVersion(group.name, target),
                apply: target => {
                    console.log(`ATTEMPT ${group.name}@${target}`)
                    if (mode === 'plan') return {}
                    const verified = applyVerifiedFix(findings, group, {
                        update: () =>
                            run('pnpm', [
                                'update',
                                group.name,
                                '--depth',
                                '100',
                                '--lockfile-only',
                                '--ignore-scripts',
                                '--no-save',
                                '-r',
                            ]),
                        override: () => {
                            writeFileSync(
                                join(root, 'pnpm-workspace.yaml'),
                                scopedOverrides(
                                    readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'),
                                    group,
                                    target,
                                ),
                            )
                            run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'])
                        },
                        scan,
                        restore,
                        policy: () => run('make', ['dependency-policy-check']),
                    })
                    return {
                        ...verified,
                        resolvedVersions: lockVersions(
                            documents(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8')),
                            group.name,
                        ),
                    }
                },
                rejected: (target, error) => {
                    findings = scan()
                    item.reason = error.message
                    console.log(`RETRY ${group.name}@${target}: ${error.message.split('\n')[0]}`)
                },
            })
            if (result) {
                Object.assign(item, result)
                if (mode === 'plan') {
                    item.status = 'planned'
                    item.reason = `Eligible fix: ${item.target}`
                } else {
                    findings = result.findings
                    delete item.findings
                    item.status = 'fixed'
                    item.reason = 'Verified by the full scan'
                }
            }
        } catch (error) {
            restore()
            findings = scan()
            item.reason = error.message
        }
    }
    // Always leave reports describing the final inputs, including after a restored attempt.
    if (mode === 'apply') {
        const finalFindings = scan()
        const fixed = report.packages.filter(item => item.status === 'fixed')
        if (fixed.some(group => !verifiedRemediation(originalFindings, finalFindings, group))) {
            for (const [path, bytes] of originalInputs) writeFileSync(join(root, path), bytes)
            scan()
            throw new Error('The final scan invalidated remediation; all dependency changes were restored')
        }
        const finalLock = documents(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'))
        for (const item of fixed) item.resolvedVersions = lockVersions(finalLock, item.name)
    }
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'remediation.json'), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(join(output, 'remediation-pr.md'), remediationBody(report))
    for (const item of report.packages)
        console.log(`${item.status.toUpperCase()} ${item.name}: ${item.reason}`)
    console.log('Reports: dist/security/remediation.json and remediation-pr.md')
}
main().catch(error => {
    console.error(error.message)
    process.exitCode = 1
})

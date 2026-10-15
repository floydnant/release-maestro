import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseAllDocuments, parseDocument } from 'yaml'
import {
    applyFirstEligibleFix,
    applyVerifiedFix,
    currentPrContainsMain,
    dependencyInputs,
    eligibleVersions,
    isStableVersion,
    lockVersions,
    npmFindings,
    remediationBody,
    scopedOverrides,
    verifiedRemediation,
} from './remediation.mjs'

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const runIn =
    cwd =>
    (command, args, allowed = [0]) => {
        const result = spawnSync(command, args, { cwd, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 })
        if (result.error) throw result.error
        if (!allowed.includes(result.status))
            throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`)
        return result.stdout
    }
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
const json = path => JSON.parse(readFileSync(path, 'utf8'))
const documents = source =>
    parseAllDocuments(source).map(document => {
        if (document.errors.length) throw document.errors[0]
        return document.toJS()
    })

// The command, registry, and clock seams let tests drive the orchestration in a temporary checkout.
export const remediate = async (
    mode,
    {
        root = repositoryRoot,
        run = runIn(root),
        fetchJson = request,
        now = new Date(),
        log = console.log,
    } = {},
) => {
    if (!['plan', 'apply'].includes(mode)) throw new Error('Usage: remediate.mjs plan|apply')
    const output = join(root, 'dist/security')
    const read = (path, encoding) => readFileSync(join(root, path), encoding)
    const write = inputs => {
        for (const [file, bytes] of inputs) writeFileSync(join(root, file), bytes)
    }
    const snapshot = () => new Map(dependencyInputs.map(path => [path, read(path)]))
    const scan = () => {
        // cli.mjs removes old reports and writes findings only after a complete, valid scan.
        run(process.execPath, ['tools/security/cli.mjs', 'scan'], [0, 1])
        return json(join(output, 'findings.json'))
    }
    const safeVersion = async (name, version) => {
        const response = await fetchJson('https://api.osv.dev/v1/query', {
            package: { name, ecosystem: 'npm' },
            version,
        })
        if (response.vulns !== undefined && !Array.isArray(response.vulns))
            throw new Error('Invalid OSV response')
        return !response.next_page_token && !(response.vulns ?? []).some(v => !v.withdrawn)
    }

    if (mode === 'apply' && run('git', ['status', '--porcelain', '--', ...dependencyInputs]).trim())
        throw new Error('Commit dependency input changes before applying remediation')
    run('make', ['dependency-policy-check'])
    const config = parseDocument(read('pnpm-workspace.yaml', 'utf8'))
    if (config.errors.length) throw config.errors[0]
    const age = config.get('minimumReleaseAge')
    const originalInputs = snapshot()
    const originalFindings = scan()
    let findings = originalFindings
    const report = {
        packages: [],
        otherFindings: findings.filter(f => f.ecosystem !== 'npm' && f.status !== 'informational'),
    }
    // Read only Dependabot PRs. Never execute code or install packages from a PR branch.
    const existing = process.env.SECURITY_EXISTING_PRS ? json(process.env.SECURITY_EXISTING_PRS) : []
    const mainRevision = run('git', ['rev-parse', 'HEAD']).trim()
    const gh = path => JSON.parse(run('gh', ['api', `repos/${process.env.GH_REPO}/${path}`]))
    const existingLocks = existing
        .filter(pr => currentPrContainsMain(gh(`compare/${mainRevision}...${pr.headRefOid}`)))
        .map(pr => ({
            ...pr,
            documents: documents(
                Buffer.from(gh(`contents/pnpm-lock.yaml?ref=${pr.headRefOid}`).content, 'base64').toString(
                    'utf8',
                ),
            ),
        }))

    const coveringPr = async group => {
        for (const pr of existingLocks) {
            const versions = lockVersions(pr.documents, group.name)
            if (versions.some(version => group.versions.includes(version))) continue
            let safe = true
            for (const version of versions) if (!(await safeVersion(group.name, version))) safe = false
            if (safe) return pr
        }
        return null
    }

    try {
        for (const group of npmFindings(findings)) {
            const item = { ...group, status: 'unresolved', reason: 'No eligible published fix; retry daily.' }
            report.packages.push(item)
            const before = snapshot()
            try {
                const pr = await coveringPr(group)
                if (pr) {
                    item.status = 'covered'
                    item.reason = `Existing Dependabot PR: ${pr.url}`
                    continue
                }
                const unsupported = group.versions.filter(version => !isStableVersion(version))
                if (unsupported.length) {
                    item.reason = `Installed prerelease ${unsupported.join(', ')} needs manual remediation.`
                    continue
                }
                const advisories = await Promise.all(
                    group.ids.map(id => fetchJson(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`)),
                )
                const registry = await fetchJson(
                    `https://registry.npmjs.org/${encodeURIComponent(group.name)}`,
                )
                const candidates = eligibleVersions(group, advisories, registry, age, now)
                const result = await applyFirstEligibleFix(candidates, {
                    isSafe: target => safeVersion(group.name, target),
                    apply: target => {
                        log(`ATTEMPT ${group.name}@${target}`)
                        if (mode === 'plan') return {}
                        return applyVerifiedFix(findings, group, {
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
                                    scopedOverrides(read('pnpm-workspace.yaml', 'utf8'), group, target),
                                )
                                run('pnpm', ['install', '--lockfile-only', '--ignore-scripts'])
                            },
                            scan,
                            restore: () => write(before),
                            policy: () => run('make', ['dependency-policy-check']),
                        })
                    },
                    // A rejected attempt has already restored the inputs that `findings` describes.
                    rejected: (target, error) => {
                        item.reason = error.message
                        log(`RETRY ${group.name}@${target}: ${error.message.split('\n')[0]}`)
                    },
                })
                if (!result) continue
                const { findings: after, ...applied } = result
                Object.assign(item, applied)
                if (mode === 'plan') {
                    item.status = 'planned'
                    item.reason = `Eligible fix: ${item.target}`
                } else {
                    findings = after
                    item.status = 'fixed'
                    item.reason = 'Verified by the full scan'
                }
            } catch (error) {
                write(before)
                item.reason = error.message
            }
        }
        // Leave reports describing the final inputs, and re-verify every fix against them.
        if (mode === 'apply') {
            const finalFindings = scan()
            const fixed = report.packages.filter(item => item.status === 'fixed')
            if (fixed.some(group => !verifiedRemediation(originalFindings, finalFindings, group)))
                throw new Error('The final scan invalidated remediation')
            const finalLock = documents(read('pnpm-lock.yaml', 'utf8'))
            for (const item of fixed) item.resolvedVersions = lockVersions(finalLock, item.name)
        }
    } catch (error) {
        if (mode === 'apply') {
            write(originalInputs)
            error.message = `${error.message}; all dependency changes were restored`
        }
        throw error
    }
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'remediation.json'), `${JSON.stringify(report, null, 2)}\n`)
    writeFileSync(join(output, 'remediation-pr.md'), remediationBody(report))
    for (const item of report.packages) log(`${item.status.toUpperCase()} ${item.name}: ${item.reason}`)
    log('Reports: dist/security/remediation.json and remediation-pr.md')
    return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    remediate(process.argv[2]).catch(error => {
        console.error(error.message)
        process.exitCode = 1
    })
}

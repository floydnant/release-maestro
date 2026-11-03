import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseAllDocuments } from 'yaml'
import { lockVersions } from './remediation.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const sources = {
    electron: 'https://releases.electronjs.org/releases.json',
    chrome: 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json',
}
const versionParts = value => {
    if (typeof value !== 'string' || !/^\d+(\.\d+){2,3}$/.test(value))
        throw new Error(`Invalid runtime version: ${value}`)
    return value.split('.').map(Number)
}
export const compareVersions = (left, right) => {
    const a = versionParts(left)
    const b = versionParts(right)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0)
        if (difference) return Math.sign(difference)
    }
    return 0
}

// Read package data, never import or execute downloaded dependency code. Ignore stale pnpm entries
// unless their package identity exactly matches a version in the committed lockfile.
export const declaredBrowsers = (name, version, read) => {
    if (name === 'playwright-core') {
        const browsers = JSON.parse(read('browsers.json')).browsers
        const chromium = browsers?.filter(b => ['chromium', 'chromium-headless-shell'].includes(b.name))
        if (!chromium?.length) throw new Error(`Missing Chromium manifest for ${name}@${version}`)
        return chromium.map(b => ({ browser: b.name, version: b.browserVersion }))
    }
    const source = read('lib/esm/puppeteer/revisions.js')
    const chrome = source.match(/\bchrome:\s*['"]([\d.]+)['"]/)?.[1]
    if (!chrome) throw new Error(`Missing Chrome revision for ${name}@${version}`)
    return [{ browser: 'chrome', version: chrome }]
}

export const assessRuntime = (runtime, { chrome, electron }) => {
    versionParts(runtime.version)
    if (runtime.package === 'electron') {
        // Older Electron lines can backport Chromium fixes. Require the current patch on that
        // Electron line, and escalate unsupported lines, rather than guessing CVE applicability.
        const majors = [...new Set(electron.map(r => Number(r.version.split('.')[0])))].sort((a, b) => b - a)
        if (!majors.slice(0, 3).includes(Number(runtime.packageVersion.split('.')[0])))
            return {
                ...runtime,
                status: 'review-required',
                reason: 'Electron line is outside the latest three stable majors',
            }
        const latest = electron.find(r => r.version.split('.')[0] === runtime.packageVersion.split('.')[0])
        return {
            ...runtime,
            status: latest.version === runtime.packageVersion ? 'current' : 'review-required',
            latestPackageVersion: latest.version,
            reason: 'Electron patch freshness; Chromium CVE applicability requires upstream backport evidence',
        }
    }
    return {
        ...runtime,
        status: compareVersions(runtime.version, chrome) < 0 ? 'review-required' : 'current',
        latestBrowserVersion: chrome,
        reason: 'Bundled Chrome compared with Chrome for Testing Stable; freshness is not a CVE verdict',
    }
}

const request = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Upstream request failed (${response.status}): ${url}`)
    return response.json()
}

export const checkRuntimes = async ({ directory = root, fetchJson = request, now = new Date() } = {}) => {
    const output = join(directory, 'dist/security')
    mkdirSync(output, { recursive: true })
    const report = {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
        sources,
        inventoryKind: 'lockfile-matched package declarations, not installed or shipped binary attestation',
        runtimes: [],
        errors: [],
    }
    try {
        const documents = parseAllDocuments(readFileSync(join(directory, 'pnpm-lock.yaml'), 'utf8')).map(
            d => {
                if (d.errors.length) throw d.errors[0]
                return d.toJS()
            },
        )
        const results = await Promise.allSettled(Object.values(sources).map(fetchJson))
        for (const result of results) if (result.status === 'rejected') throw result.reason
        const [electronData, chromeData] = results.map(r => r.value)
        if (!Array.isArray(electronData)) throw new Error('Invalid Electron release feed')
        const electron = electronData.filter(r => /^\d+\.\d+\.\d+$/.test(r.version))
        if (!electron.length) throw new Error('Empty Electron stable release feed')
        electron.sort((a, b) => compareVersions(b.version, a.version))
        const chrome = chromeData.channels?.Stable?.version
        versionParts(chrome)
        const feedAge = now - new Date(chromeData.timestamp)
        if (!Number.isFinite(feedAge) || feedAge > 48 * 60 * 60 * 1000 || feedAge < -60 * 60 * 1000)
            throw new Error('Chrome for Testing feed timestamp is invalid or older than 48 hours')
        report.chromeFeedTimestamp = chromeData.timestamp
        const entries = readdirSync(join(directory, 'node_modules/.pnpm'))
        for (const name of ['electron', 'playwright-core', 'puppeteer-core']) {
            const versions = lockVersions(documents, name)
            if (!versions.length) throw new Error(`Runtime package missing from lockfile: ${name}`)
            for (const version of versions) {
                try {
                    let browsers
                    let node
                    if (name === 'electron') {
                        const release = electron.find(r => r.version === version)
                        if (!release) throw new Error(`Unknown Electron release: ${version}`)
                        versionParts(release.node)
                        browsers = [{ browser: 'chromium', version: release.chrome }]
                        node = release.node
                    } else {
                        const entry = entries.find(
                            e => e === `${name}@${version}` || e.startsWith(`${name}@${version}_`),
                        )
                        if (!entry) throw new Error(`Install locked package ${name}@${version} first`)
                        const base = join(directory, 'node_modules/.pnpm', entry, 'node_modules', name)
                        const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
                        if (pkg.name !== name || pkg.version !== version)
                            throw new Error('Installed package identity mismatch')
                        browsers = declaredBrowsers(name, version, path =>
                            readFileSync(join(base, path), 'utf8'),
                        )
                    }
                    for (const browser of browsers)
                        report.runtimes.push(
                            assessRuntime(
                                {
                                    package: name,
                                    packageVersion: version,
                                    ...browser,
                                    ...(node ? { node } : {}),
                                },
                                { electron, chrome },
                            ),
                        )
                } catch (error) {
                    report.errors.push(`${name}@${version}: ${error.message}`)
                }
            }
        }
    } catch (error) {
        report.errors.push(error.message)
    }
    report.status =
        report.errors.length || report.runtimes.some(r => r.status !== 'current')
            ? 'review-required'
            : 'current'
    writeFileSync(join(output, 'runtimes.json'), `${JSON.stringify(report, null, 2)}\n`)
    return report
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const report = await checkRuntimes()
    for (const runtime of report.runtimes)
        console.log(
            `${runtime.status.toUpperCase()} ${runtime.package}@${runtime.packageVersion}: ${runtime.browser} ${runtime.version}${runtime.node ? `, Node ${runtime.node}` : ''}`,
        )
    for (const error of report.errors) console.error(`UNKNOWN ${error}`)
    console.log('Runtime freshness is not proof of CVE coverage. Report: dist/security/runtimes.json')
    if (report.status !== 'current') process.exitCode = 1
}

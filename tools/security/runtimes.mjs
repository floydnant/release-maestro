import { execFileSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseAllDocuments } from 'yaml'
import { lockVersions } from './remediation.mjs'

// Inventories the browser engines that locked npm packages bundle or download, and compares them with
// upstream releases. The inventory describes package declarations, not shipped binaries, and
// freshness is a review signal, not a CVE verdict.
//
// Each report entry is one browser declared by one locked package version:
//   { package, packageVersion, browser, browserVersion, node?, status, reason, latest...Version }

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const sources = {
    electron: 'https://releases.electronjs.org/releases.json',
    chrome: 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json',
}
const runtimePackages = ['electron', 'playwright-core', 'puppeteer-core']
const requiredRuntimePackages = new Set(['electron', 'playwright-core'])
const supportedElectronMajorCount = 3
const hour = 60 * 60 * 1000
const maxChromeFeedAge = 48 * hour
const maxChromeFeedClockSkew = hour

// Versions

const parseVersion = value => {
    if (typeof value !== 'string' || !/^\d+(\.\d+){2,3}$/.test(value))
        throw new Error(`Invalid runtime version: ${value}`)
    return value.split('.').map(Number)
}
const majorOf = version => parseVersion(version)[0]
export const compareVersions = (left, right) => {
    const a = parseVersion(left)
    const b = parseVersion(right)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0)
        if (difference) return Math.sign(difference)
    }
    return 0
}

// Upstream releases

const parseElectronReleases = feed => {
    if (!Array.isArray(feed)) throw new Error('Invalid Electron release feed')
    const stable = feed.filter(release => /^\d+\.\d+\.\d+$/.test(release.version))
    if (!stable.length) throw new Error('Empty Electron stable release feed')
    return stable
}

const parseChromeStable = (feed, now) => {
    const version = feed.channels?.Stable?.version
    parseVersion(version)
    const age = now - new Date(feed.timestamp)
    if (!Number.isFinite(age) || age > maxChromeFeedAge || age < -maxChromeFeedClockSkew)
        throw new Error('Chrome for Testing feed timestamp is invalid or older than 48 hours')
    return { version, timestamp: feed.timestamp }
}

const fetchJsonFromUpstream = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Upstream request failed (${response.status}): ${url}`)
    return response.json()
}

// Waits for both feeds so a failure is reported in source order, not by which request lost the race.
const fetchUpstream = async (fetchJson, now) => {
    const results = await Promise.allSettled([fetchJson(sources.electron), fetchJson(sources.chrome)])
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
    const [electronFeed, chromeFeed] = results.map(result => result.value)
    const electron = parseElectronReleases(electronFeed)
    const chrome = parseChromeStable(chromeFeed, now)
    return { electron, chrome: chrome.version, chromeFeedTimestamp: chrome.timestamp }
}

// Declared browsers

const readLockfile = directory =>
    parseAllDocuments(readFileSync(join(directory, 'pnpm-lock.yaml'), 'utf8')).map(document => {
        if (document.errors.length) throw document.errors[0]
        return document.toJS()
    })

const playwrightBrowsers = (name, version, read) => {
    const chromium = JSON.parse(read('browsers.json')).browsers?.filter(browser =>
        ['chromium', 'chromium-headless-shell'].includes(browser.name),
    )
    if (!chromium?.length) throw new Error(`Missing Chromium manifest for ${name}@${version}`)
    return chromium.map(browser => ({ browser: browser.name, browserVersion: browser.browserVersion }))
}

const puppeteerBrowsers = (name, version, read) => {
    const chrome = read('lib/esm/puppeteer/revisions.js').match(/\bchrome:\s*['"]([\d.]+)['"]/)?.[1]
    if (!chrome) throw new Error(`Missing Chrome revision for ${name}@${version}`)
    return [{ browser: 'chrome', browserVersion: chrome }]
}

// Reads package files as text. Downloaded dependency code is never imported or executed.
export const declaredBrowsers = (name, version, read) =>
    name === 'playwright-core'
        ? playwrightBrowsers(name, version, read)
        : puppeteerBrowsers(name, version, read)

// Electron's release feed, not the installed package, maps a version to its Chromium and Node.
const electronBrowsers = (version, electronReleases) => {
    const release = electronReleases.find(r => r.version === version)
    if (!release) throw new Error(`Unknown Electron release: ${version}`)
    parseVersion(release.node)
    return [{ browser: 'chromium', browserVersion: release.chrome, node: release.node }]
}

// pnpm can keep stale store entries, so only trust one whose identity exactly matches the lockfile.
const installedBrowsers = (directory, storeEntries, name, version) => {
    const entry = storeEntries.find(e => e === `${name}@${version}` || e.startsWith(`${name}@${version}_`))
    if (!entry) throw new Error(`Install locked package ${name}@${version} first`)
    const packageDirectory = join(directory, 'node_modules/.pnpm', entry, 'node_modules', name)
    const read = path => readFileSync(join(packageDirectory, path), 'utf8')
    const manifest = JSON.parse(read('package.json'))
    if (manifest.name !== name || manifest.version !== version)
        throw new Error('Installed package identity mismatch')
    return declaredBrowsers(name, version, read)
}

// Assessment

// The newest patch of each of the latest three stable Electron majors, keyed by major.
const supportedElectronLines = electronReleases => {
    const newestByMajor = new Map()
    for (const release of electronReleases) {
        const major = majorOf(release.version)
        const newest = newestByMajor.get(major)
        if (!newest || compareVersions(release.version, newest.version) > 0) newestByMajor.set(major, release)
    }
    const majorsNewestFirst = [...newestByMajor].sort(([a], [b]) => b - a)
    return new Map(majorsNewestFirst.slice(0, supportedElectronMajorCount))
}

// Older Electron lines can backport Chromium fixes. Require the current patch on that Electron line,
// and escalate unsupported lines, rather than guessing CVE applicability.
const assessElectron = (runtime, electronReleases) => {
    const latest = supportedElectronLines(electronReleases).get(majorOf(runtime.packageVersion))
    if (!latest)
        return {
            ...runtime,
            status: 'review-required',
            reason: 'Electron line is outside the latest three stable majors',
        }
    return {
        ...runtime,
        status: latest.version === runtime.packageVersion ? 'current' : 'review-required',
        latestPackageVersion: latest.version,
        reason: 'Electron patch freshness; Chromium CVE applicability requires upstream backport evidence',
    }
}

const assessBrowser = (runtime, chrome) => ({
    ...runtime,
    status: compareVersions(runtime.browserVersion, chrome) < 0 ? 'review-required' : 'current',
    latestBrowserVersion: chrome,
    reason: 'Bundled Chrome compared with Chrome for Testing Stable; freshness is not a CVE verdict',
})

export const assessRuntime = (runtime, { chrome, electron }) => {
    parseVersion(runtime.browserVersion)
    return runtime.package === 'electron' ? assessElectron(runtime, electron) : assessBrowser(runtime, chrome)
}

// Report

// A failure for one locked version is recorded against it, and the remaining versions are still
// inventoried. The caller treats a thrown error as unknown coverage for the whole inventory.
const inventoryRuntimes = (directory, lockfile, upstream) => {
    const storeEntries = readdirSync(join(directory, 'node_modules/.pnpm'))
    const runtimes = []
    const errors = []
    for (const name of runtimePackages) {
        const versions = lockVersions(lockfile, name)
        if (!versions.length && requiredRuntimePackages.has(name))
            errors.push(`Runtime package missing from lockfile: ${name}`)
        for (const version of versions) {
            try {
                const browsers =
                    name === 'electron'
                        ? electronBrowsers(version, upstream.electron)
                        : installedBrowsers(directory, storeEntries, name, version)
                // Assess every browser before recording any, so a version is inventoried whole or not at all.
                const assessed = browsers.map(browser =>
                    assessRuntime({ package: name, packageVersion: version, ...browser }, upstream),
                )
                runtimes.push(...assessed)
            } catch (error) {
                errors.push(`${name}@${version}: ${error.message}`)
            }
        }
    }
    return { runtimes, errors }
}

export const checkRuntimes = async ({
    directory = root,
    fetchJson = fetchJsonFromUpstream,
    now = new Date(),
} = {}) => {
    const report = {
        schemaVersion: 1,
        generatedAt: now.toISOString(),
        revision: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: directory, encoding: 'utf8' }).trim(),
        sources,
        inventoryKind: 'lockfile-matched package declarations, not installed or shipped binary attestation',
        chromeFeedTimestamp: null,
        runtimes: [],
        errors: [],
    }
    try {
        const lockfile = readLockfile(directory)
        const upstream = await fetchUpstream(fetchJson, now)
        report.chromeFeedTimestamp = upstream.chromeFeedTimestamp
        Object.assign(report, inventoryRuntimes(directory, lockfile, upstream))
    } catch (error) {
        report.errors.push(error.message)
    }
    report.status =
        report.errors.length || report.runtimes.some(r => r.status !== 'current')
            ? 'review-required'
            : 'current'

    const output = join(directory, 'dist/security')
    mkdirSync(output, { recursive: true })
    writeFileSync(join(output, 'runtimes.json'), `${JSON.stringify(report, null, 2)}\n`)
    return report
}

// Gate policy. Unknown coverage (any inventory error) fails every run. PR runs pass `inventoryOnly`:
// they report every freshness review, including newly introduced stale runtimes, without failing on
// them. Main, scheduled, and manual runs also fail on freshness reviews.
export const runtimeGateFailed = (report, { inventoryOnly }) =>
    report.errors.length > 0 || (!inventoryOnly && report.status !== 'current')

export const describeRuntime = runtime =>
    `${runtime.status.toUpperCase()} ${runtime.package}@${runtime.packageVersion}: ` +
    `${runtime.browser} ${runtime.browserVersion}${runtime.node ? `, Node ${runtime.node}` : ''}`

export const stepSummary = (report, { inventoryOnly }) => {
    const reviews = report.runtimes.filter(runtime => runtime.status !== 'current').length
    const enforcement = inventoryOnly
        ? 'This PR reports freshness findings. Main and scheduled scans enforce them.'
        : 'This run enforces freshness findings.'
    return (
        `Runtime inventory: ${reviews} freshness reviews, ${report.errors.length} inventory errors. ` +
        `See the runtime-security artifact.\n${enforcement}\n`
    )
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const policy = { inventoryOnly: process.argv.includes('--inventory-only') }
    const report = await checkRuntimes()
    for (const runtime of report.runtimes) console.log(describeRuntime(runtime))
    for (const error of report.errors) console.error(`UNKNOWN ${error}`)
    console.log('Runtime freshness is not proof of CVE coverage. Report: dist/security/runtimes.json')
    if (process.env.GITHUB_STEP_SUMMARY)
        appendFileSync(process.env.GITHUB_STEP_SUMMARY, stepSummary(report, policy))
    if (runtimeGateFailed(report, policy)) process.exitCode = 1
}

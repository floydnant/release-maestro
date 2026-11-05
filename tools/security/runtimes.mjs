import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseAllDocuments } from 'yaml'
import { lockVersions } from './remediation.mjs'

// Inventories the browser engines that locked npm packages bundle or download, and compares them with
// upstream releases. Freshness is a review signal, not a CVE verdict.

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
export const sources = {
    electron: 'https://releases.electronjs.org/releases.json',
    chrome: 'https://googlechromelabs.github.io/chrome-for-testing/last-known-good-versions.json',
}
const runtimePackages = ['electron', 'playwright-core', 'puppeteer-core']
const supportedElectronMajors = 3
const hour = 60 * 60 * 1000
const maxChromeFeedAge = 48 * hour
const maxChromeFeedClockSkew = hour

const versionParts = value => {
    if (typeof value !== 'string' || !/^\d+(\.\d+){2,3}$/.test(value))
        throw new Error(`Invalid runtime version: ${value}`)
    return value.split('.').map(Number)
}
const majorOf = version => versionParts(version)[0]
export const compareVersions = (left, right) => {
    const a = versionParts(left)
    const b = versionParts(right)
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const difference = (a[i] ?? 0) - (b[i] ?? 0)
        if (difference) return Math.sign(difference)
    }
    return 0
}

// Upstream feeds

const isStableElectron = release => /^\d+\.\d+\.\d+$/.test(release.version)

const parseUpstream = (electronFeed, chromeFeed, now) => {
    if (!Array.isArray(electronFeed)) throw new Error('Invalid Electron release feed')
    const electron = electronFeed.filter(isStableElectron)
    if (!electron.length) throw new Error('Empty Electron stable release feed')

    const chrome = chromeFeed.channels?.Stable?.version
    versionParts(chrome)
    const feedAge = now - new Date(chromeFeed.timestamp)
    if (!Number.isFinite(feedAge) || feedAge > maxChromeFeedAge || feedAge < -maxChromeFeedClockSkew)
        throw new Error('Chrome for Testing feed timestamp is invalid or older than 48 hours')

    return { electron, chrome, chromeFeedTimestamp: chromeFeed.timestamp }
}

const request = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Upstream request failed (${response.status}): ${url}`)
    return response.json()
}

// Waits for both feeds so a failure is reported in source order, not by which request lost the race.
const fetchFeeds = async fetchJson => {
    const results = await Promise.allSettled([fetchJson(sources.electron), fetchJson(sources.chrome)])
    const failure = results.find(result => result.status === 'rejected')
    if (failure) throw failure.reason
    return results.map(result => result.value)
}

// Inventory

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
    return chromium.map(browser => ({ browser: browser.name, version: browser.browserVersion }))
}

const puppeteerBrowsers = (name, version, read) => {
    const chrome = read('lib/esm/puppeteer/revisions.js').match(/\bchrome:\s*['"]([\d.]+)['"]/)?.[1]
    if (!chrome) throw new Error(`Missing Chrome revision for ${name}@${version}`)
    return [{ browser: 'chrome', version: chrome }]
}

// Read package data, never import or execute downloaded dependency code.
export const declaredBrowsers = (name, version, read) =>
    name === 'playwright-core'
        ? playwrightBrowsers(name, version, read)
        : puppeteerBrowsers(name, version, read)

// Electron's release feed, not the installed package, maps a version to its Chromium and Node.
const electronBrowsers = (version, electron) => {
    const release = electron.find(r => r.version === version)
    if (!release) throw new Error(`Unknown Electron release: ${version}`)
    versionParts(release.node)
    return [{ browser: 'chromium', version: release.chrome, node: release.node }]
}

// pnpm can keep stale store entries, so only trust one whose identity exactly matches the lockfile.
const installedBrowsers = (directory, installed, name, version) => {
    const entry = installed.find(e => e === `${name}@${version}` || e.startsWith(`${name}@${version}_`))
    if (!entry) throw new Error(`Install locked package ${name}@${version} first`)
    const base = join(directory, 'node_modules/.pnpm', entry, 'node_modules', name)
    const pkg = JSON.parse(readFileSync(join(base, 'package.json'), 'utf8'))
    if (pkg.name !== name || pkg.version !== version) throw new Error('Installed package identity mismatch')
    return declaredBrowsers(name, version, path => readFileSync(join(base, path), 'utf8'))
}

// Assessment

// Older Electron lines can backport Chromium fixes. Require the current patch on that Electron line,
// and escalate unsupported lines, rather than guessing CVE applicability.
const assessElectron = (runtime, electron) => {
    const major = majorOf(runtime.packageVersion)
    const supportedMajors = [...new Set(electron.map(r => majorOf(r.version)))]
        .sort((a, b) => b - a)
        .slice(0, supportedElectronMajors)
    if (!supportedMajors.includes(major))
        return {
            ...runtime,
            status: 'review-required',
            reason: 'Electron line is outside the latest three stable majors',
        }
    const latest = electron
        .filter(r => majorOf(r.version) === major)
        .reduce((newest, r) => (compareVersions(r.version, newest.version) > 0 ? r : newest))
    return {
        ...runtime,
        status: latest.version === runtime.packageVersion ? 'current' : 'review-required',
        latestPackageVersion: latest.version,
        reason: 'Electron patch freshness; Chromium CVE applicability requires upstream backport evidence',
    }
}

const assessBrowser = (runtime, chrome) => ({
    ...runtime,
    status: compareVersions(runtime.version, chrome) < 0 ? 'review-required' : 'current',
    latestBrowserVersion: chrome,
    reason: 'Bundled Chrome compared with Chrome for Testing Stable; freshness is not a CVE verdict',
})

export const assessRuntime = (runtime, { chrome, electron }) => {
    versionParts(runtime.version)
    return runtime.package === 'electron' ? assessElectron(runtime, electron) : assessBrowser(runtime, chrome)
}

// Report

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
    // A failure here leaves the whole inventory unknown. A failure for one locked version is recorded
    // against that version, and the remaining versions are still inventoried.
    try {
        const lockfile = readLockfile(directory)
        const upstream = parseUpstream(...(await fetchFeeds(fetchJson)), now)
        report.chromeFeedTimestamp = upstream.chromeFeedTimestamp
        const installed = readdirSync(join(directory, 'node_modules/.pnpm'))
        const browsersOf = (name, version) =>
            name === 'electron'
                ? electronBrowsers(version, upstream.electron)
                : installedBrowsers(directory, installed, name, version)

        for (const name of runtimePackages) {
            const versions = lockVersions(lockfile, name)
            if (!versions.length) throw new Error(`Runtime package missing from lockfile: ${name}`)
            for (const version of versions) {
                try {
                    const assessed = browsersOf(name, version).map(browser =>
                        assessRuntime({ package: name, packageVersion: version, ...browser }, upstream),
                    )
                    report.runtimes.push(...assessed)
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

const describeRuntime = runtime =>
    `${runtime.status.toUpperCase()} ${runtime.package}@${runtime.packageVersion}: ` +
    `${runtime.browser} ${runtime.version}${runtime.node ? `, Node ${runtime.node}` : ''}`

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
    const report = await checkRuntimes()
    for (const runtime of report.runtimes) console.log(describeRuntime(runtime))
    for (const error of report.errors) console.error(`UNKNOWN ${error}`)
    console.log('Runtime freshness is not proof of CVE coverage. Report: dist/security/runtimes.json')
    if (report.status !== 'current') process.exitCode = 1
}

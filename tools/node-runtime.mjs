import { readFileSync, writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { compareVersions, isStableVersion } from './security/remediation.mjs'

export const nodeRuntimeInputs = ['package.json', '.node-version']
const minimumFloors = ['22.23.4', '24.22.1']
const rangeError =
    'engines.node must require Node 22.23.4–22.x or Node 24.22.1–24.x, allowing newer floors within these majors'

export const formatNodeRange = floors =>
    floors.map(version => `>= ${version} < ${Number(version.split('.')[0]) + 1}`).join(' || ')

// Keep the major-line policy, but let the security bot raise its patch/minor floors without editing code.
export const parseNodeRange = range => {
    if (typeof range !== 'string') throw new Error(rangeError)
    const branches = range.split(' || ')
    const floors = branches.map((branch, index) => {
        const match = /^>= (\d+\.\d+\.\d+) < (\d+)$/.exec(branch)
        const minimum = minimumFloors[index]
        if (
            !match ||
            !minimum ||
            match[1].split('.')[0] !== minimum.split('.')[0] ||
            Number(match[2]) !== Number(minimum.split('.')[0]) + 1 ||
            compareVersions(match[1], minimum) < 0
        )
            throw new Error(rangeError)
        return match[1]
    })
    if (floors.length !== minimumFloors.length) throw new Error(rangeError)
    return floors
}

export const nodeRuntimeErrors = (range, pin) => {
    try {
        const floors = parseNodeRange(range)
        const floor = floors.find(version => version.split('.')[0] === pin.split('.')[0])
        if (!isStableVersion(pin) || !floor || compareVersions(pin, floor) < 0)
            return ['.node-version must pin a stable release inside the supported Node range']
        return []
    } catch (error) {
        return [error.message]
    }
}

const dateValue = value => {
    const time =
        typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
            ? Date.parse(`${value}T00:00:00Z`)
            : NaN
    if (!Number.isFinite(time) || new Date(time).toISOString().slice(0, 10) !== value)
        throw new Error('Invalid date in Node release metadata')
    return time
}

export const planNodeSecurityUpdate = (range, pin, releases, schedule, now = new Date()) => {
    const floors = parseNodeRange(range)
    if (!isStableVersion(pin) || !floors.some(f => f.split('.')[0] === pin.split('.')[0]))
        throw new Error('The Node pin must belong to a supported major line')
    if (!Array.isArray(releases) || !schedule || !Number.isFinite(now.getTime()))
        throw new Error('Invalid Node release metadata or clock')

    const packages = floors.map(floor => {
        const major = floor.split('.')[0]
        const lifecycle = schedule[`v${major}`]
        if (
            !lifecycle ||
            dateValue(lifecycle.lts) > now.getTime() ||
            dateValue(lifecycle.end) <= now.getTime()
        )
            throw new Error(`Node ${major} is not a maintained LTS line; review the supported majors`)
        const candidates = []
        for (const release of releases) {
            if (!release || typeof release.version !== 'string')
                throw new Error('Invalid Node release record')
            const version = release.version.replace(/^v/, '')
            if (!isStableVersion(version) || version.split('.')[0] !== major) continue
            const published = dateValue(release.date)
            if (
                typeof release.security !== 'boolean' ||
                (release.lts !== false && typeof release.lts !== 'string')
            )
                throw new Error('Invalid Node security release metadata')
            if (release.security && release.lts && published <= now.getTime()) candidates.push(version)
        }
        if (!candidates.length) throw new Error(`No published LTS security release found for Node ${major}`)
        const latest = candidates.sort(compareVersions).at(-1)
        const target = compareVersions(latest, floor) > 0 ? latest : floor
        const changesPin = pin.split('.')[0] === major && compareVersions(target, pin) > 0
        return {
            name: `Node.js ${major}`,
            from: floor,
            target,
            status: target !== floor || changesPin ? 'fixed' : 'current',
        }
    })
    const pinnedFloor = packages.find(p => p.target.split('.')[0] === pin.split('.')[0]).target
    return {
        packages,
        range: formatNodeRange(packages.map(p => p.target)),
        pin: compareVersions(pinnedFloor, pin) > 0 ? pinnedFloor : pin,
    }
}

const fetchJson = async url => {
    const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
    if (!response.ok) throw new Error(`Node metadata request failed: ${response.status} ${url}`)
    return response.json()
}

export const updateNodeRuntime = async (mode, root, { request = fetchJson, now = new Date() } = {}) => {
    if (!['plan', 'apply'].includes(mode)) throw new Error('Usage: node-runtime.mjs plan|apply')
    const output = join(root, 'dist/security')
    mkdirSync(output, { recursive: true })
    const reportPath = join(output, 'node-runtime.json')
    const bodyPath = join(output, 'node-runtime-pr.md')
    // A failed lookup must never leave a publishable report from an earlier run.
    rmSync(reportPath, { force: true })
    rmSync(bodyPath, { force: true })
    const originals = new Map(nodeRuntimeInputs.map(path => [path, readFileSync(join(root, path), 'utf8')]))
    try {
        const manifest = JSON.parse(originals.get('package.json'))
        const pin = originals.get('.node-version').trim()
        const [releases, schedule] = await Promise.all([
            request('https://nodejs.org/dist/index.json'),
            request('https://raw.githubusercontent.com/nodejs/Release/main/schedule.json'),
        ])
        const report = {
            ...planNodeSecurityUpdate(manifest.engines?.node, pin, releases, schedule, now),
            mode,
        }
        const changed = report.packages.some(p => p.status === 'fixed')
        if (mode === 'plan') {
            for (const item of report.packages) if (item.status === 'fixed') item.status = 'planned'
        }
        const body = [
            'Closes N/A',
            '',
            '## What changed',
            '',
            changed
                ? 'Update the supported Node.js minimums to official LTS security releases.'
                : 'No Node.js LTS security update is needed.',
            pin === report.pin
                ? `The development and CI runtime pin remains ${pin}.`
                : `The development and CI runtime pin changes from ${pin} to ${report.pin}.`,
            '',
            ...report.packages
                .filter(p => p.status !== 'current')
                .map(
                    p =>
                        `- ${p.name}: ${p.from} to [${p.target}](https://nodejs.org/en/blog/release/v${p.target}).`,
                ),
            '',
            '## Notes',
            '',
            'Sources: [Node release index](https://nodejs.org/dist/index.json) and [LTS schedule](https://github.com/nodejs/Release/blob/main/schedule.json).',
            'Major upgrades and end-of-life decisions require maintainer review. Electron bundles its own runtime and is not updated here.',
            '',
        ].join('\n')
        if (mode === 'apply' && changed) {
            manifest.engines.node = report.range
            writeFileSync(join(root, 'package.json'), JSON.stringify(manifest, null, 4) + '\n')
            writeFileSync(join(root, '.node-version'), report.pin + '\n')
        }
        writeFileSync(bodyPath, body)
        writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
        return report
    } catch (error) {
        for (const [path, bytes] of originals) writeFileSync(join(root, path), bytes)
        rmSync(reportPath, { force: true })
        rmSync(bodyPath, { force: true })
        throw error
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    updateNodeRuntime(process.argv[2], resolve(dirname(fileURLToPath(import.meta.url)), '..'))
        .then(report => console.log(JSON.stringify(report, null, 2)))
        .catch(error => {
            console.error(error.message)
            process.exitCode = 1
        })
}

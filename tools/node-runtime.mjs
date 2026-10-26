import { compareVersions, isStableVersion } from './security/remediation.mjs'

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

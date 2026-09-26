import { spawn, spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, readlinkSync } from 'node:fs'
import { appendFile, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import net from 'node:net'
import { homedir } from 'node:os'
import { basename, delimiter, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { formatLogEvent } from './presentation.mjs'

export const registryVersion = 1
export const manifestVersion = 1
export const defaultGraceMs = 20 * 60 * 1000
const defaultPorts = Object.freeze({ renderer: 4200, cdp: 9222, inspector: 5858 })
const manifestName = '.release-maestro-instance.json'
const lockWaitMs = 60_000
const lockStaleMs = 10_000
const defaultLogLimitBytes = 5 * 1024 * 1024
const retainedLogs = 3

/** @typedef {{renderer: number, cdp: number, inspector: number}} PortBundle */
/**
 * @typedef {{
 *   id: string,
 *   role: string,
 *   pid: number,
 *   startIdentity: string,
 *   heartbeatAt: string,
 *   worktreeId: string,
 *   parentHolderId?: string,
 *   processGroup?: boolean
 * }} ProcessHolder
 */
/**
 * The state is derived from holders and time, so contradictory stored flags cannot exist.
 * @typedef {
 *   | {kind: 'unallocated'}
 *   | {kind: 'reserved'}
 *   | {kind: 'active', holders: [ProcessHolder, ...ProcessHolder[]]}
 *   | {kind: 'inactive', inactiveSince: string, expiresAt: string}
 *   | {kind: 'expired'}
 *   | {kind: 'reclaimable'}
 * } DevelopmentAllocationState
 */

const sleep = ms => new Promise(done => setTimeout(done, ms))
const iso = value => new Date(value).toISOString()
const nowMs = () => Date.now()

export const developmentSlot = bundle => {
    const offsets = [
        bundle.renderer - defaultPorts.renderer,
        bundle.cdp - defaultPorts.cdp,
        bundle.inspector - defaultPorts.inspector,
    ]
    return offsets[0] >= 0 && offsets.every(offset => offset === offsets[0]) ? offsets[0] : null
}

export class InstanceError extends Error {
    constructor(message, code = 'INSTANCE_ERROR') {
        super(message)
        this.name = 'InstanceError'
        this.code = code
    }
}

export const getStatePaths = () => {
    const root = resolve(
        process.env['RELEASE_MAESTRO_INSTANCE_STATE_DIR'] ??
            join(homedir(), '.release-maestro', 'dev-instances'),
    )
    return {
        root,
        registry: join(root, 'registry.json'),
        registryBackup: join(root, 'registry.backup.json'),
        lock: join(root, 'registry.lock'),
        log: join(root, 'orchestration.jsonl'),
        settings: join(root, 'settings.json'),
    }
}

const runGit = (cwd, args) => {
    const result = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
    if (result.status !== 0) {
        throw new InstanceError(`Not a Git worktree: ${cwd}`, 'NOT_A_WORKTREE')
    }
    return result.stdout.trim()
}

export const resolveWorktree = async (cwd = process.cwd()) => {
    const root = await realpath(runGit(cwd, ['rev-parse', '--show-toplevel']))
    const branch = runGit(root, ['branch', '--show-current']) || '(detached)'
    const gitEntry = await stat(join(root, '.git'))
    const identity = `${gitEntry.dev}:${gitEntry.ino}:${gitEntry.birthtimeMs}`
    return { root, branch, identity, manifestPath: join(root, manifestName) }
}

export const parseUnixProcessIdentity = output => {
    const [state, ...started] = output.trim().split(/\s+/)
    if (!state || started.length === 0 || /[ZE]/.test(state)) return null
    return started.join(' ')
}

const processExists = pid => {
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        if (error?.code === 'ESRCH') return false
        if (error?.code === 'EPERM' || error?.code === 'EACCES') {
            throw new InstanceError(
                `Could not verify process identity for PID ${pid}`,
                'PROCESS_IDENTITY_UNKNOWN',
            )
        }
        throw error
    }
}

const processStartIdentity = pid => {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null
    let started = ''
    if (process.platform === 'linux') {
        try {
            const statLine = readFileSync(`/proc/${pid}/stat`, 'utf8')
            const afterName = statLine
                .slice(statLine.lastIndexOf(')') + 2)
                .trim()
                .split(/\s+/)
            if (/[ZX]/.test(afterName[0] ?? '')) return null
            started = afterName[19] ?? ''
        } catch (error) {
            if (error?.code === 'ENOENT' && !processExists(pid)) return null
            if (error?.code === 'EACCES' || error?.code === 'EPERM') {
                throw new InstanceError(
                    `Could not verify process identity for PID ${pid}`,
                    'PROCESS_IDENTITY_UNKNOWN',
                )
            }
            throw error
        }
    } else if (process.platform === 'win32') {
        const result = spawnSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                `(Get-CimInstance Win32_Process -Filter "ProcessId = ${pid}" -ErrorAction Stop).CreationDate.ToUniversalTime().Ticks`,
            ],
            { encoding: 'utf8', windowsHide: true },
        )
        if (result.status !== 0) {
            if (!processExists(pid)) return null
            throw new InstanceError(
                `Could not read process start identity for PID ${pid}`,
                'PROCESS_IDENTITY_UNKNOWN',
            )
        }
        started = result.stdout.trim()
    } else {
        const result = spawnSync('ps', ['-p', String(pid), '-o', 'state=', '-o', 'lstart='], {
            encoding: 'utf8',
        })
        if (result.status !== 0) {
            if (!processExists(pid)) return null
            throw new InstanceError(
                `Could not read process start identity for PID ${pid}`,
                'PROCESS_IDENTITY_UNKNOWN',
            )
        }
        const state = result.stdout.trim().split(/\s+/)[0] ?? ''
        if (/[ZE]/.test(state)) return null
        started = parseUnixProcessIdentity(result.stdout) ?? ''
    }
    if (!started && processExists(pid)) {
        throw new InstanceError(
            `Could not read process start identity for PID ${pid}`,
            'PROCESS_IDENTITY_UNKNOWN',
        )
    }
    return started || null
}

export const currentProcessIdentity = () => {
    const startIdentity = processStartIdentity(process.pid)
    if (!startIdentity) throw new InstanceError('Could not determine this process start identity')
    return { pid: process.pid, startIdentity }
}

export const holderIsLive = holder => {
    try {
        return processStartIdentity(holder.pid) === holder.startIdentity
    } catch (error) {
        if (error?.code === 'PROCESS_IDENTITY_UNKNOWN') return true
        throw error
    }
}

export const rootProcessHolders = holders => {
    const holderIds = new Set(holders.map(holder => holder.id))
    return holders.filter(holder => !holder.parentHolderId || !holderIds.has(holder.parentHolderId))
}

const processTable = () => {
    if (process.platform === 'win32') {
        const result = spawnSync(
            'powershell.exe',
            [
                '-NoProfile',
                '-NonInteractive',
                '-Command',
                'Get-CimInstance Win32_Process | ForEach-Object { [pscustomobject]@{ ProcessId=$_.ProcessId; ParentProcessId=$_.ParentProcessId; StartTicks=[string]$_.CreationDate.ToUniversalTime().Ticks } } | ConvertTo-Json -Compress',
            ],
            { encoding: 'utf8', windowsHide: true },
        )
        if (result.status !== 0) throw new InstanceError('Could not read Windows process table')
        const rows = JSON.parse(result.stdout || '[]')
        return (Array.isArray(rows) ? rows : [rows]).map(row => ({
            pid: Number(row.ProcessId),
            parentPid: Number(row.ParentProcessId),
            startIdentity: row.StartTicks,
        }))
    }
    const columns = process.platform === 'darwin' ? 'pid=,ppid=,state=,lstart=' : 'pid=,ppid='
    const result = spawnSync('ps', ['-axo', columns], { encoding: 'utf8' })
    if (result.status !== 0) throw new InstanceError('Could not read process table')
    return result.stdout
        .trim()
        .split('\n')
        .map(line => {
            const [pidValue, parentPidValue, state, ...started] = line.trim().split(/\s+/)
            const pid = Number(pidValue)
            const parentPid = Number(parentPidValue)
            return {
                pid,
                parentPid,
                ...(process.platform === 'darwin'
                    ? { startIdentity: parseUnixProcessIdentity(`${state} ${started.join(' ')}`) }
                    : {}),
            }
        })
        .filter(row => Number.isSafeInteger(row.pid) && Number.isSafeInteger(row.parentPid))
}

export const snapshotProcessTree = rootPid => {
    const rows = processTable()
    const rowsByPid = new Map(rows.map(row => [row.pid, row]))
    const childrenByParent = new Map()
    for (const row of rows) {
        const children = childrenByParent.get(row.parentPid) ?? []
        children.push(row.pid)
        childrenByParent.set(row.parentPid, children)
    }
    const result = []
    const visit = (pid, depth) => {
        const record = rowsByPid.get(pid)
        const startIdentity = record?.startIdentity ?? processStartIdentity(pid)
        if (!startIdentity) return
        result.push({ pid, startIdentity, depth })
        for (const childPid of childrenByParent.get(pid) ?? []) visit(childPid, depth + 1)
    }
    visit(rootPid, 0)
    return result.sort((left, right) => right.depth - left.depth)
}

const signalProcessSnapshot = (snapshot, signal) => {
    for (const processRecord of snapshot) {
        if (processStartIdentity(processRecord.pid) !== processRecord.startIdentity) continue
        try {
            process.kill(processRecord.pid, signal)
        } catch (error) {
            if (error?.code !== 'ESRCH') throw error
        }
    }
}

const snapshotHasLiveProcess = snapshot => {
    if (process.platform === 'darwin') {
        const identities = new Map(processTable().map(record => [record.pid, record.startIdentity]))
        return snapshot.some(record => identities.get(record.pid) === record.startIdentity)
    }
    return snapshot.some(record => processStartIdentity(record.pid) === record.startIdentity)
}

export const signalProcessTree = (rootPid, signal, expectedStartIdentity) => {
    if (!expectedStartIdentity) return
    const snapshot = snapshotProcessTree(rootPid)
    if (
        !snapshot.some(
            processRecord =>
                processRecord.pid === rootPid && processRecord.startIdentity === expectedStartIdentity,
        )
    ) {
        return
    }
    signalProcessSnapshot(snapshot, signal)
}

export const stopProcessTree = async (rootPid, expectedStartIdentity, signal = 'SIGTERM') => {
    if (!expectedStartIdentity) return
    const snapshot = snapshotProcessTree(rootPid)
    if (
        !snapshot.some(
            processRecord =>
                processRecord.pid === rootPid && processRecord.startIdentity === expectedStartIdentity,
        )
    ) {
        return
    }
    const descendants = snapshot.filter(processRecord => processRecord.pid !== rootPid)
    signalProcessSnapshot(descendants, signal)
    if (descendants.length > 0) {
        const naturalExitDeadline = nowMs() + 500
        while (processStartIdentity(rootPid) === expectedStartIdentity && nowMs() < naturalExitDeadline) {
            await sleep(100)
        }
    }
    signalProcessSnapshot(
        snapshot.filter(processRecord => processRecord.pid === rootPid),
        signal,
    )
    const deadline = nowMs() + 5_000
    while (snapshotHasLiveProcess(snapshot) && nowMs() < deadline) {
        await sleep(process.platform === 'win32' ? 500 : 200)
    }
    signalProcessSnapshot(snapshot, 'SIGKILL')
}

export const stopProcessGroup = async (rootPid, expectedStartIdentity) => {
    if (process.platform === 'win32') {
        if (processStartIdentity(rootPid) === expectedStartIdentity) {
            spawnSync('taskkill.exe', ['/PID', String(rootPid), '/T', '/F'], {
                encoding: 'utf8',
                windowsHide: true,
            })
        }
        return
    }
    const currentStartIdentity = processStartIdentity(rootPid)
    if (currentStartIdentity && currentStartIdentity !== expectedStartIdentity) return
    const signalGroup = signal => {
        try {
            process.kill(-rootPid, signal)
            return true
        } catch (error) {
            if (error?.code !== 'ESRCH') throw error
            return false
        }
    }
    if (!signalGroup('SIGTERM')) return
    const deadline = nowMs() + 250
    while (nowMs() < deadline) {
        try {
            process.kill(-rootPid, 0)
        } catch (error) {
            if (error?.code === 'ESRCH') return
            if (error?.code !== 'EPERM') throw error
        }
        await sleep(50)
    }
    signalGroup('SIGKILL')
}

const isRecord = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const isPort = value => Number.isSafeInteger(value) && value >= 1024 && value <= 65535
const isTimestamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value))
const isBundle = value =>
    isRecord(value) &&
    isPort(value.renderer) &&
    isPort(value.cdp) &&
    isPort(value.inspector) &&
    new Set([value.renderer, value.cdp, value.inspector]).size === 3

const parseManifest = value => {
    if (
        !isRecord(value) ||
        value.version !== manifestVersion ||
        typeof value.worktreeId !== 'string' ||
        !Number.isSafeInteger(value.registryGeneration) ||
        value.registryGeneration < 0 ||
        typeof value.path !== 'string' ||
        typeof value.branch !== 'string' ||
        !isBundle(value.bundle)
    ) {
        throw new InstanceError('Invalid worktree manifest', 'CORRUPT_MANIFEST')
    }
    return value
}

const emptyRegistry = () => ({
    version: registryVersion,
    generation: 0,
    allocations: {},
    transients: {},
})

const parseHolder = value => {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.role !== 'string' ||
        !Number.isSafeInteger(value.pid) ||
        typeof value.startIdentity !== 'string' ||
        !isTimestamp(value.heartbeatAt) ||
        typeof value.worktreeId !== 'string'
    ) {
        throw new InstanceError('Invalid holder', 'CORRUPT_REGISTRY')
    }
    if (value.processGroup !== undefined && typeof value.processGroup !== 'boolean') {
        throw new InstanceError('Invalid holder process group', 'CORRUPT_REGISTRY')
    }
    return value
}

const parseAllocation = value => {
    if (
        !isRecord(value) ||
        typeof value.worktreeId !== 'string' ||
        typeof value.path !== 'string' ||
        (value.worktreeIdentity !== undefined && typeof value.worktreeIdentity !== 'string') ||
        typeof value.branch !== 'string' ||
        !isTimestamp(value.createdAt) ||
        !isTimestamp(value.updatedAt) ||
        !Number.isSafeInteger(value.generation) ||
        value.generation < 0 ||
        !isBundle(value.bundle) ||
        typeof value.appDataPath !== 'string' ||
        !Array.isArray(value.holders) ||
        !Array.isArray(value.claims) ||
        !value.claims.every(claim => typeof claim === 'string') ||
        !(value.inactiveSince === null || isTimestamp(value.inactiveSince)) ||
        (value.missingSince !== undefined && !isTimestamp(value.missingSince)) ||
        typeof value.releaseWhenIdle !== 'boolean' ||
        typeof value.wasActive !== 'boolean' ||
        !value.holders.every(holder => {
            try {
                parseHolder(holder)
                return true
            } catch {
                return false
            }
        })
    ) {
        throw new InstanceError('Invalid allocation', 'CORRUPT_REGISTRY')
    }
    return value
}

const parseTransient = value => {
    if (
        !isRecord(value) ||
        typeof value.id !== 'string' ||
        typeof value.worktreeId !== 'string' ||
        (value.worktreeIdentity !== undefined && typeof value.worktreeIdentity !== 'string') ||
        typeof value.workflow !== 'string' ||
        typeof value.path !== 'string' ||
        !isTimestamp(value.createdAt) ||
        !isBundle(value.bundle) ||
        !Array.isArray(value.claims) ||
        !value.claims.every(claim => typeof claim === 'string') ||
        !isRecord(value.holder)
    ) {
        throw new InstanceError('Invalid transient allocation', 'CORRUPT_REGISTRY')
    }
    parseHolder(value.holder)
    if (value.childHolder !== undefined) parseHolder(value.childHolder)
    if (value.listenerHolder !== undefined) parseHolder(value.listenerHolder)
    return value
}

const parseRegistry = value => {
    if (
        !isRecord(value) ||
        value.version !== registryVersion ||
        !Number.isSafeInteger(value.generation) ||
        value.generation < 0 ||
        !isRecord(value.allocations) ||
        !isRecord(value.transients)
    ) {
        throw new InstanceError('Invalid instance registry', 'CORRUPT_REGISTRY')
    }
    Object.entries(value.allocations).forEach(([id, allocation]) => {
        parseAllocation(allocation)
        if (allocation.worktreeId !== id)
            throw new InstanceError('Allocation key mismatch', 'CORRUPT_REGISTRY')
    })
    Object.entries(value.transients).forEach(([id, transient]) => {
        parseTransient(transient)
        if (
            transient.id !== id ||
            transient.holder.worktreeId !== transient.worktreeId ||
            (transient.childHolder && transient.childHolder.worktreeId !== transient.worktreeId) ||
            (transient.listenerHolder && transient.listenerHolder.worktreeId !== transient.worktreeId)
        ) {
            throw new InstanceError('Transient key mismatch', 'CORRUPT_REGISTRY')
        }
    })
    return value
}

const readJson = async path => JSON.parse(await readFile(path, 'utf8'))

const quarantine = async path => {
    if (!existsSync(path)) return null
    const quarantined = `${path}.corrupt-${Date.now()}-${randomUUID()}`
    await rename(path, quarantined)
    return quarantined
}

const atomicWriteJson = async (path, value) => {
    await mkdir(dirname(path), { recursive: true })
    const temporary = `${path}.tmp-${process.pid}-${randomUUID()}`
    const handle = await open(temporary, 'wx', 0o600)
    try {
        await handle.writeFile(`${JSON.stringify(value, null, 2)}\n`)
        await handle.sync()
    } finally {
        await handle.close()
    }
    await rename(temporary, path)
}

const configuredLockWaitMs = () => {
    const value = process.env['RELEASE_MAESTRO_INSTANCE_LOCK_WAIT_MS']
    if (value === undefined) return lockWaitMs
    const parsed = Number(value)
    if (!Number.isSafeInteger(parsed) || parsed < 0) {
        throw new InstanceError('RELEASE_MAESTRO_INSTANCE_LOCK_WAIT_MS must be a non-negative integer')
    }
    return parsed
}

const acquireLock = async paths => {
    await mkdir(paths.root, { recursive: true })
    const waitMs = configuredLockWaitMs()
    const deadline = nowMs() + waitMs
    const owner = { token: randomUUID(), ...currentProcessIdentity(), acquiredAt: iso(nowMs()) }
    for (;;) {
        try {
            await mkdir(paths.lock)
            await atomicWriteJson(join(paths.lock, 'owner.json'), owner)
            return async () => {
                try {
                    const current = await readJson(join(paths.lock, 'owner.json'))
                    if (current.token === owner.token) {
                        await rm(paths.lock, { recursive: true, force: true })
                    }
                } catch (error) {
                    if (error?.code !== 'ENOENT') throw error
                }
            }
        } catch (error) {
            if (error?.code !== 'EEXIST') throw error
        }

        let staleOwner = null
        try {
            staleOwner = await readJson(join(paths.lock, 'owner.json'))
        } catch (error) {
            if (error?.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error
        }
        let lockStat
        try {
            lockStat = await stat(paths.lock)
        } catch (error) {
            if (error?.code === 'ENOENT') continue
            throw error
        }
        const ownerIsDead =
            staleOwner &&
            typeof staleOwner.token === 'string' &&
            processStartIdentity(staleOwner.pid) !== staleOwner.startIdentity
        const corruptAndStale = !staleOwner && nowMs() - lockStat.mtimeMs >= lockStaleMs
        if (ownerIsDead || corruptAndStale) {
            const observed = staleOwner?.token ?? `${lockStat.dev}-${lockStat.ino}`
            const recovery = `${paths.lock}.recover-${observed}`
            try {
                await mkdir(recovery)
                try {
                    const current = await readJson(join(paths.lock, 'owner.json')).catch(() => null)
                    const currentStat = await stat(paths.lock).catch(() => null)
                    const unchanged = staleOwner
                        ? current?.token === staleOwner.token
                        : current === null &&
                          currentStat?.dev === lockStat.dev &&
                          currentStat?.ino === lockStat.ino
                    if (unchanged) {
                        await rename(paths.lock, join(recovery, 'stale-lock'))
                    }
                } finally {
                    await rm(recovery, { recursive: true, force: true })
                }
                continue
            } catch (error) {
                if (error?.code !== 'EEXIST' && error?.code !== 'ENOENT') throw error
            }
        }
        if (nowMs() >= deadline) {
            throw new InstanceError(
                `Timed out waiting for instance registry lock at ${paths.lock}`,
                'LOCK_TIMEOUT',
            )
        }
        await sleep(50 + Math.floor(Math.random() * 25))
    }
}

const readRegistryCopy = async path => {
    try {
        return parseRegistry(await readJson(path))
    } catch (error) {
        if (error?.code === 'ENOENT') return null
        if (error instanceof SyntaxError || error?.code === 'CORRUPT_REGISTRY') {
            await quarantine(path)
            return null
        }
        throw error
    }
}

const readRegistry = async paths => {
    const [primary, backup] = await Promise.all([
        readRegistryCopy(paths.registry),
        readRegistryCopy(paths.registryBackup),
    ])
    if (!primary) return backup ?? emptyRegistry()
    if (!backup) return primary
    return primary.generation >= backup.generation ? primary : backup
}

const rotateLog = async path => {
    const configuredLimit = Number(
        process.env['RELEASE_MAESTRO_INSTANCE_LOG_LIMIT_BYTES'] ?? defaultLogLimitBytes,
    )
    const logLimitBytes =
        Number.isSafeInteger(configuredLimit) && configuredLimit > 0 ? configuredLimit : defaultLogLimitBytes
    try {
        if ((await stat(path)).size < logLimitBytes) return
    } catch (error) {
        if (error?.code === 'ENOENT') return
        throw error
    }
    await rm(`${path}.${retainedLogs}`, { force: true })
    for (let index = retainedLogs; index >= 1; index -= 1) {
        const source = index === 1 ? path : `${path}.${index - 1}`
        const target = `${path}.${index}`
        try {
            await rename(source, target)
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
        }
    }
}

const redact = value => {
    if (typeof value === 'string') {
        return value
            .replace(/([?&](?:token|key|secret|password)=)[^&\s]+/gi, '$1[redacted]')
            .replace(/\b(?:sk|ghp|github_pat)_[A-Za-z0-9_-]+\b/g, '[redacted]')
    }
    if (Array.isArray(value)) return value.map(redact)
    if (!isRecord(value)) return value
    return Object.fromEntries(
        Object.entries(value).map(([key, item]) => [
            key,
            /token|secret|password|environment|arguments|command/i.test(key) ? '[redacted]' : redact(item),
        ]),
    )
}

const appendEvent = async (paths, event, details = {}) => {
    await mkdir(paths.root, { recursive: true })
    await rotateLog(paths.log)
    const entry = redact({ at: iso(nowMs()), event, ...details })
    await appendFile(paths.log, `${JSON.stringify(entry)}\n`, { mode: 0o600 })
}

export const logDiagnostic = async (event, details = {}) => {
    const paths = getStatePaths()
    const releaseLock = await acquireLock(paths)
    try {
        await appendEvent(paths, event, details)
    } finally {
        await releaseLock()
    }
}

const canonicalizePath = async path => {
    let cursor = resolve(path)
    const tail = []
    for (;;) {
        try {
            const existing = await realpath(cursor)
            const canonical = join(existing, ...tail.reverse())
            return process.platform === 'win32' ? canonical.toLowerCase() : canonical
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
            const parent = dirname(cursor)
            if (parent === cursor) {
                const canonical = resolve(path)
                return process.platform === 'win32' ? canonical.toLowerCase() : canonical
            }
            tail.push(basename(cursor))
            cursor = parent
        }
    }
}

const sameCanonicalPath = (left, right) =>
    process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right

const appDataFor = worktree =>
    canonicalizePath(process.env['RELEASE_MAESTRO_APP_DATA_DIR'] ?? join(worktree.root, '.app-data.dev'))

const allocationState = (allocation, at = nowMs(), graceMs = defaultGraceMs) => {
    if (allocation.holders.length > 0) return 'active'
    if (allocation.inactiveSince) {
        return at - Date.parse(allocation.inactiveSince) >= graceMs ? 'expired' : 'inactive'
    }
    return 'reserved'
}

const holdersHealth = holders =>
    holders.every(holder => nowMs() - Date.parse(holder.heartbeatAt) < 60_000) ? 'healthy' : 'degraded'

const describeDevelopmentAllocation = allocation => ({
    ...allocation,
    state: allocationState(allocation, nowMs(), configuredGraceMs()),
    ...(allocation.inactiveSince
        ? { expiresAt: iso(Date.parse(allocation.inactiveSince) + configuredGraceMs()) }
        : {}),
    health: holdersHealth(allocation.holders),
    ageMs: nowMs() - Date.parse(allocation.createdAt),
    slot: developmentSlot(allocation.bundle),
})

const activeClaims = registry => {
    const claims = []
    for (const allocation of Object.values(registry.allocations)) {
        const developmentHolders = allocation.holders.filter(holder =>
            ['dev-supervisor', 'dev-renderer', 'dev-electron'].includes(holder.role),
        )
        for (const resource of allocation.claims) {
            const holders = resource.startsWith('electron-development-bundle:')
                ? developmentHolders
                : allocation.holders
            if (holders.length === 0) continue
            claims.push({
                resource,
                workflow: 'dev',
                worktreeId: allocation.worktreeId,
                path: allocation.path,
                holders,
                startedAt: allocation.createdAt,
            })
        }
    }
    for (const transient of Object.values(registry.transients)) {
        for (const resource of transient.claims) {
            claims.push({
                resource,
                workflow: transient.workflow,
                worktreeId: transient.worktreeId,
                path: transient.path,
                holders: [transient.listenerHolder, transient.childHolder, transient.holder].filter(Boolean),
                startedAt: transient.createdAt,
            })
        }
    }
    return claims
}

const describeConflict = conflict => {
    const holder = conflict.holders[0]
    return (
        `Resource ${conflict.resource} is held by ${conflict.workflow} in ${conflict.path} ` +
        `(worktree ${conflict.worktreeId}, PID ${holder.pid}, process start ${holder.startIdentity}, since ${conflict.startedAt}).`
    )
}

const assertClaimsAvailable = (registry, claims, worktreeId, allowedWorkflow = null) => {
    const conflict = activeClaims(registry).find(
        active =>
            claims.includes(active.resource) &&
            !(
                active.worktreeId === worktreeId &&
                allowedWorkflow !== null &&
                active.workflow === allowedWorkflow
            ),
    )
    if (conflict) throw new InstanceError(describeConflict(conflict), 'RESOURCE_CONFLICT')
}

const reconcileRegistry = (registry, at = nowMs(), graceMs = configuredGraceMs()) => {
    const processIdentities =
        process.platform === 'darwin'
            ? new Map(processTable().map(row => [row.pid, row.startIdentity]))
            : null
    const isLive = holder =>
        processIdentities?.get(holder.pid)
            ? processIdentities.get(holder.pid) === holder.startIdentity
            : holderIsLive(holder)
    for (const allocation of Object.values(registry.allocations)) {
        allocation.holders = allocation.holders.filter(isLive)
        if (!existsSync(allocation.path) && allocation.holders.length === 0) {
            allocation.missingSince ??= iso(at)
            if (at - Date.parse(allocation.missingSince) >= graceMs) {
                delete registry.allocations[allocation.worktreeId]
                continue
            }
        } else {
            delete allocation.missingSince
        }
        if (allocation.holders.length === 0 && allocation.wasActive && !allocation.inactiveSince) {
            allocation.inactiveSince = iso(at)
        }
        if (allocation.holders.length > 0) {
            allocation.wasActive = true
            allocation.inactiveSince = null
        }
        if (allocation.releaseWhenIdle && allocation.holders.length === 0) {
            delete registry.allocations[allocation.worktreeId]
            continue
        }
        if (allocationState(allocation, at, graceMs) === 'expired') {
            delete registry.allocations[allocation.worktreeId]
        }
    }
    for (const [id, transient] of Object.entries(registry.transients)) {
        const wrapperIsLive = isLive(transient.holder)
        const childIsLive = transient.childHolder ? isLive(transient.childHolder) : false
        const listenerIsLive = transient.listenerHolder ? isLive(transient.listenerHolder) : false
        if (!wrapperIsLive && !childIsLive && !listenerIsLive) {
            delete registry.transients[id]
        } else {
            if (!childIsLive) delete transient.childHolder
            if (!listenerIsLive) delete transient.listenerHolder
        }
    }
    return registry
}

const configuredGraceMs = () => {
    let value = process.env['RELEASE_MAESTRO_INSTANCE_GRACE_MS']
    if (value === undefined) {
        const settingsPath = getStatePaths().settings
        if (existsSync(settingsPath)) {
            let settings
            try {
                settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
            } catch {
                throw new InstanceError(`${settingsPath} must contain valid JSON`, 'INVALID_CONFIG')
            }
            if (!isRecord(settings) || Object.keys(settings).some(key => key !== 'graceMs')) {
                throw new InstanceError(`${settingsPath} must contain only graceMs`, 'INVALID_CONFIG')
            }
            value = settings.graceMs
        }
    }
    if (value === undefined) return defaultGraceMs
    const parsed = Number(value)
    if (
        !['string', 'number'].includes(typeof value) ||
        (typeof value === 'string' && !/^\d+$/.test(value)) ||
        !Number.isSafeInteger(parsed) ||
        parsed < 0
    ) {
        throw new InstanceError('graceMs must be a non-negative integer', 'INVALID_CONFIG')
    }
    return parsed
}

const withRegistry = async action => {
    const paths = getStatePaths()
    const releaseLock = await acquireLock(paths)
    try {
        const registry = reconcileRegistry(await readRegistry(paths))
        const result = await action(registry, paths)
        registry.generation += 1
        await atomicWriteJson(paths.registryBackup, registry)
        await atomicWriteJson(paths.registry, registry)
        return result
    } finally {
        await releaseLock()
    }
}

export const reconcileInstances = async source => {
    const worktree = await resolveWorktree()
    await withRegistry(async (registry, paths) => {
        await appendEvent(paths, 'session-start-reconciled', {
            path: worktree.root,
            source: typeof source === 'string' ? source : 'unknown',
            allocations: Object.keys(registry.allocations).length,
            transients: Object.keys(registry.transients).length,
        })
    })
}

const readManifest = async worktree => {
    try {
        return parseManifest(await readJson(worktree.manifestPath))
    } catch (error) {
        if (error?.code === 'ENOENT') return null
        if (error instanceof SyntaxError || error?.code === 'CORRUPT_MANIFEST') {
            await quarantine(worktree.manifestPath)
            return null
        }
        throw error
    }
}

const writeManifest = async (worktree, allocation, generation) =>
    atomicWriteJson(worktree.manifestPath, {
        version: manifestVersion,
        worktreeId: allocation.worktreeId,
        registryGeneration: generation,
        path: worktree.root,
        branch: worktree.branch,
        bundle: allocation.bundle,
    })

const manualBundle = () => {
    const values = [
        process.env['RELEASE_MAESTRO_RENDERER_PORT'],
        process.env['RELEASE_MAESTRO_CDP_PORT'],
        process.env['RELEASE_MAESTRO_INSPECTOR_PORT'],
    ]
    const supplied = values.filter(value => value !== undefined).length
    if (supplied === 0) return null
    if (supplied !== values.length) {
        throw new InstanceError(
            'Manual port configuration requires RELEASE_MAESTRO_RENDERER_PORT, RELEASE_MAESTRO_CDP_PORT, and RELEASE_MAESTRO_INSPECTOR_PORT together.',
            'PARTIAL_BUNDLE',
        )
    }
    const bundle = { renderer: Number(values[0]), cdp: Number(values[1]), inspector: Number(values[2]) }
    if (!isBundle(bundle) || new Set(Object.values(bundle)).size !== 3) {
        throw new InstanceError(
            'Manual ports must be three distinct integers from 1024 through 65535.',
            'INVALID_BUNDLE',
        )
    }
    return bundle
}

const canBind = (port, host) =>
    new Promise(resolvePromise => {
        const server = net.createServer()
        server.unref()
        server.once('error', error => resolvePromise(error?.code === 'EADDRNOTAVAIL'))
        server.listen({ port, host, exclusive: true, ipv6Only: host.includes(':') }, () =>
            server.close(() => resolvePromise(true)),
        )
    })

export const portIsAvailable = async port =>
    (await canBind(port, '127.0.0.1')) &&
    (await canBind(port, '::1')) &&
    (await canBind(port, '0.0.0.0')) &&
    (await canBind(port, '::'))

const bundleIsAvailable = async bundle => {
    for (const port of Object.values(bundle)) {
        if (!(await portIsAvailable(port))) return false
    }
    return true
}

const listenerPids = port => {
    if (process.platform === 'win32') {
        const result = spawnSync('netstat.exe', ['-ano', '-p', 'tcp'], {
            encoding: 'utf8',
            windowsHide: true,
        })
        return result.stdout
            .split('\n')
            .map(line => line.trim().split(/\s+/))
            .filter(parts => parts.length >= 5 && parts[1]?.endsWith(`:${port}`) && parts[3] === 'LISTENING')
            .map(parts => Number(parts[4]))
            .filter(Number.isSafeInteger)
    }
    const lsof = process.platform === 'darwin' ? '/usr/sbin/lsof' : 'lsof'
    const result = spawnSync(lsof, ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {
        encoding: 'utf8',
    })
    if (result.error?.code === 'ENOENT' && process.platform === 'linux') {
        const hexPort = port.toString(16).toUpperCase().padStart(4, '0')
        const socketInodes = new Set()
        for (const table of ['/proc/net/tcp', '/proc/net/tcp6']) {
            try {
                for (const line of readFileSync(table, 'utf8').trim().split('\n').slice(1)) {
                    const fields = line.trim().split(/\s+/)
                    if (fields[1]?.endsWith(`:${hexPort}`) && fields[3] === '0A' && fields[9]) {
                        socketInodes.add(fields[9])
                    }
                }
            } catch {}
        }
        if (socketInodes.size === 0) return []
        const pids = []
        for (const entry of readdirSync('/proc', { withFileTypes: true })) {
            if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue
            try {
                const ownsSocket = readdirSync(`/proc/${entry.name}/fd`).some(fd => {
                    try {
                        const target = readlinkSync(`/proc/${entry.name}/fd/${fd}`)
                        const match = /^socket:\[(\d+)]$/.exec(target)
                        return match ? socketInodes.has(match[1]) : false
                    } catch {
                        return false
                    }
                })
                if (ownsSocket) pids.push(Number(entry.name))
            } catch {}
        }
        return pids
    }
    if (result.error?.code === 'ENOENT') return []
    return result.stdout
        .split('\n')
        .filter(line => line.startsWith('p'))
        .map(line => Number(line.slice(1)))
        .filter(Number.isSafeInteger)
}

const ownedListenerProcess = (rootPid, rootStartIdentity, ports) => {
    const candidates = ports
        .map(port => new Set(listenerPids(port)))
        .reduce((intersection, pids) => new Set([...intersection].filter(pid => pids.has(pid))))
    if (candidates.size === 0) return null
    const snapshot = snapshotProcessTree(rootPid)
    if (!snapshot.some(record => record.pid === rootPid && record.startIdentity === rootStartIdentity)) {
        return null
    }
    return snapshot.find(record => candidates.has(record.pid)) ?? null
}

const assertPersistedBundleUsable = async (allocation, registeringHolder) => {
    const liveHolders = [
        ...allocation.holders.filter(holderIsLive),
        ...(registeringHolder ? [registeringHolder] : []),
    ]
    const ownedListenerPids = new Map()
    for (const holder of liveHolders) {
        if (!['dev-renderer', 'dev-electron'].includes(holder.role)) continue
        const owned = ownedListenerPids.get(holder.role) ?? new Set()
        snapshotProcessTree(holder.pid).forEach(record => owned.add(record.pid))
        ownedListenerPids.set(holder.role, owned)
    }
    for (const [name, port] of Object.entries(allocation.bundle)) {
        if (await portIsAvailable(port)) continue
        const listeners = listenerPids(port)
        const owningRole = name === 'renderer' ? 'dev-renderer' : 'dev-electron'
        const owned = listeners.some(listenerPid => ownedListenerPids.get(owningRole)?.has(listenerPid))
        if (owned) continue
        const pid = listeners[0]
        const started = pid ? processStartIdentity(pid) : 'unknown'
        throw new InstanceError(
            `Persisted ${name} port ${port} for dev in ${allocation.path} is occupied by an unrelated process` +
                `${pid ? `, PID ${pid}, process start ${started}` : ''}. Run make dev-reallocate after stopping or identifying it.`,
            'PORT_CONFLICT',
        )
    }
}

const occupiedPorts = registry => {
    const ports = new Set()
    for (const allocation of Object.values(registry.allocations)) {
        Object.values(allocation.bundle).forEach(port => ports.add(port))
    }
    for (const transient of Object.values(registry.transients)) {
        Object.values(transient.bundle).forEach(port => ports.add(port))
    }
    return ports
}

const allocateBundle = async (registry, requested = null, excludeWorktreeId = null) => {
    const reserved = occupiedPorts({
        ...registry,
        allocations: Object.fromEntries(
            Object.entries(registry.allocations).filter(([id]) => id !== excludeWorktreeId),
        ),
    })
    if (requested) {
        if (
            Object.values(requested).some(port => reserved.has(port)) ||
            !(await bundleIsAvailable(requested))
        ) {
            throw new InstanceError(
                `Requested port bundle is unavailable: ${JSON.stringify(requested)}`,
                'PORT_CONFLICT',
            )
        }
        return requested
    }
    for (let slot = 0; slot < 60_000; slot += 1) {
        const bundle = {
            renderer: defaultPorts.renderer + slot,
            cdp: defaultPorts.cdp + slot,
            inspector: defaultPorts.inspector + slot,
        }
        if (Object.values(bundle).some(port => port > 65535 || reserved.has(port))) continue
        if (await bundleIsAvailable(bundle)) return bundle
    }
    throw new InstanceError('No complete loopback port bundle is available.', 'PORT_EXHAUSTED')
}

const newHolder = async (
    worktreeId,
    role,
    pid = process.pid,
    parentHolderId = null,
    processGroup = false,
    knownStartIdentity = null,
) => {
    const startIdentity = knownStartIdentity ?? processStartIdentity(pid)
    if (!startIdentity) throw new InstanceError(`PID ${pid} is not running`, 'PROCESS_NOT_FOUND')
    return {
        id: randomUUID(),
        role,
        pid,
        startIdentity,
        heartbeatAt: iso(nowMs()),
        worktreeId,
        ...(parentHolderId ? { parentHolderId } : {}),
        ...(processGroup ? { processGroup: true } : {}),
    }
}

const manifestPathBelongsElsewhere = (manifest, worktree) =>
    manifest && !sameCanonicalPath(manifest.path, worktree.root) && existsSync(manifest.path)

const allocationForManifest = (registry, manifest, worktree, rejectCopied = true) => {
    const allocation = manifest ? registry.allocations[manifest.worktreeId] : null
    if (!allocation) {
        if (rejectCopied && manifestPathBelongsElsewhere(manifest, worktree)) {
            throw new InstanceError(
                `Manifest belongs to ${manifest.path}, not ${worktree.root}. Allocate a new instance in this worktree.`,
                'MANIFEST_OWNERSHIP_CONFLICT',
            )
        }
        return null
    }
    if (allocation.worktreeIdentity && allocation.worktreeIdentity !== worktree.identity) {
        if (rejectCopied) {
            throw new InstanceError(
                `Manifest belongs to another checkout, not ${worktree.root}. Allocate a new instance in this worktree.`,
                'MANIFEST_OWNERSHIP_CONFLICT',
            )
        }
        return null
    }
    if (
        allocation.worktreeIdentity === worktree.identity ||
        sameCanonicalPath(allocation.path, worktree.root) ||
        (!existsSync(allocation.path) && allocation.holders.length === 0)
    ) {
        return allocation
    }
    if (rejectCopied) {
        throw new InstanceError(
            `Manifest belongs to ${allocation.path}, not ${worktree.root}. Allocate a new instance in this worktree.`,
            'MANIFEST_OWNERSHIP_CONFLICT',
        )
    }
    return null
}

const allocationForWorktree = (registry, manifest, worktree, rejectCopied = true) => {
    if (manifest) {
        const ownedByManifest = allocationForManifest(registry, manifest, worktree, rejectCopied)
        if (ownedByManifest) return ownedByManifest
    }
    const matches = Object.values(registry.allocations).filter(
        allocation => allocation.worktreeIdentity === worktree.identity,
    )
    if (matches.length > 1) {
        throw new InstanceError('Multiple allocations match this worktree', 'REGISTRY_CONFLICT')
    }
    return matches[0] ?? null
}

const updateAllocationLocation = async (allocation, worktree) => {
    if (!sameCanonicalPath(allocation.path, worktree.root)) {
        const oldDefaultAppDataPath = await canonicalizePath(join(allocation.path, '.app-data.dev'))
        if (allocation.appDataPath === oldDefaultAppDataPath) {
            allocation.appDataPath = await canonicalizePath(join(worktree.root, '.app-data.dev'))
            allocation.claims = [
                `electron-development-bundle:${allocation.worktreeId}`,
                `app-data:${allocation.appDataPath}`,
            ]
        }
    }
    allocation.path = worktree.root
    delete allocation.missingSince
    allocation.worktreeIdentity = worktree.identity
    allocation.branch = worktree.branch
}

const allocateDevelopmentWithResult = async ({ reallocate = false } = {}) => {
    const worktree = await resolveWorktree()
    const initialManifest = await readManifest(worktree)
    const requestedAppDataPath = await appDataFor(worktree)
    const hasAppDataOverride = process.env['RELEASE_MAESTRO_APP_DATA_DIR'] !== undefined
    let result
    let created = false
    await withRegistry(async (registry, paths) => {
        const manifest = (await readManifest(worktree)) ?? initialManifest
        const manifestId = manifest?.worktreeId
        const persisted = manifestId ? registry.allocations[manifestId] : null
        const existing = allocationForWorktree(registry, manifest, worktree, false)
        const worktreeId = existing
            ? existing.worktreeId
            : persisted || manifestPathBelongsElsewhere(manifest, worktree)
              ? randomUUID()
              : (manifestId ?? randomUUID())
        const oldDefaultAppDataPath = existing
            ? await canonicalizePath(join(existing.path, '.app-data.dev'))
            : null
        const appDataPath =
            existing && !hasAppDataOverride && existing.appDataPath !== oldDefaultAppDataPath
                ? existing.appDataPath
                : requestedAppDataPath
        const appDataClaim = `app-data:${appDataPath}`
        if (existing?.holders.length && hasAppDataOverride && existing.appDataPath !== requestedAppDataPath) {
            throw new InstanceError(
                `The active development allocation uses app data ${existing.appDataPath}; refusing to replace it with ${requestedAppDataPath}. Stop the stack before changing RELEASE_MAESTRO_APP_DATA_DIR.`,
                'APP_DATA_CONFLICT',
            )
        }
        assertClaimsAvailable(registry, [appDataClaim], worktreeId, 'dev')

        const requestedBundle = manualBundle()
        if (existing && !reallocate) {
            existing.path = worktree.root
            delete existing.missingSince
            existing.worktreeIdentity = worktree.identity
            existing.branch = worktree.branch
            existing.appDataPath = appDataPath
            existing.claims = [`electron-development-bundle:${worktreeId}`, appDataClaim]
            existing.updatedAt = iso(nowMs())
            existing.generation = registry.generation + 1
            result = existing
            await writeManifest(worktree, existing, registry.generation + 1)
            await appendEvent(paths, 'dev-allocation-reused', {
                worktreeId,
                path: worktree.root,
                ports: existing.bundle,
            })
            return
        }

        if (existing?.holders.length) {
            throw new InstanceError(
                'Cannot reallocate while validated holders remain. Run make dev-stop first.',
                'LIVE_HOLDERS',
            )
        }
        const bundle = await allocateBundle(
            registry,
            requestedBundle,
            requestedBundle ? existing?.worktreeId : null,
        )
        const allocation = {
            worktreeId,
            generation: registry.generation + 1,
            path: worktree.root,
            worktreeIdentity: worktree.identity,
            branch: worktree.branch,
            bundle,
            appDataPath,
            claims: [`electron-development-bundle:${worktreeId}`, appDataClaim],
            holders: [],
            createdAt: existing?.createdAt ?? iso(nowMs()),
            updatedAt: iso(nowMs()),
            inactiveSince: null,
            releaseWhenIdle: false,
            wasActive: false,
        }
        registry.allocations[worktreeId] = allocation
        result = allocation
        created = !existing
        await writeManifest(worktree, allocation, registry.generation + 1)
        await appendEvent(paths, reallocate ? 'dev-allocation-reallocated' : 'dev-allocation-created', {
            worktreeId,
            path: worktree.root,
            ports: bundle,
        })
    })
    return { allocation: result, created }
}

export const allocateDevelopment = async options => (await allocateDevelopmentWithResult(options)).allocation

export const getDevelopment = async ({ allocate = false } = {}) => {
    const worktree = await resolveWorktree()
    const manifest = await readManifest(worktree)
    if (!manifest) return allocate ? allocateDevelopment() : null
    let result = null
    let generation = null
    await withRegistry(async registry => {
        const allocation = allocationForManifest(registry, manifest, worktree)
        if (!allocation) return
        await updateAllocationLocation(allocation, worktree)
        allocation.updatedAt = iso(nowMs())
        allocation.generation = registry.generation + 1
        result = allocation
        generation = registry.generation + 1
    })
    if (!result && allocate) return allocateDevelopment()
    if (result && manifest.registryGeneration !== generation)
        await writeManifest(worktree, result, generation)
    return result
}

export const registerDevelopmentHolder = async (
    role,
    pid = process.pid,
    parentHolderId = null,
    processGroup = false,
) => {
    let allocation = await allocateDevelopment()
    const holder = await newHolder(allocation.worktreeId, role, pid, parentHolderId, processGroup)
    await assertPersistedBundleUsable(allocation, holder)
    await withRegistry(async (registry, paths) => {
        const current = registry.allocations[allocation.worktreeId]
        if (!current) throw new InstanceError('Development allocation disappeared during registration')
        if (
            current.bundle.renderer !== allocation.bundle.renderer ||
            current.bundle.cdp !== allocation.bundle.cdp ||
            current.bundle.inspector !== allocation.bundle.inspector
        ) {
            throw new InstanceError(
                'Development allocation changed during holder registration. Retry the command.',
                'ALLOCATION_CHANGED',
            )
        }
        allocation = current
        if (role === 'dev-supervisor') {
            const other = current.holders.find(
                item =>
                    ['dev-supervisor', 'dev-renderer', 'dev-electron'].includes(item.role) &&
                    holderIsLive(item),
            )
            if (other) {
                throw new InstanceError(
                    `The dev workflow already owns ${current.path}: ${other.role}, PID ${other.pid}, process start ${other.startIdentity}, since ${other.heartbeatAt}.`,
                    'DUPLICATE_WORKFLOW',
                )
            }
        }
        assertClaimsAvailable(registry, current.claims, current.worktreeId, 'dev')
        current.holders.push(holder)
        current.inactiveSince = null
        current.wasActive = true
        current.updatedAt = iso(nowMs())
        await appendEvent(paths, 'holder-registered', {
            worktreeId: current.worktreeId,
            path: current.path,
            role,
            holder: { id: holder.id, pid: holder.pid, startIdentity: holder.startIdentity },
        })
    })
    return { allocation, holder }
}

export const registerDevelopmentListenerHolder = async (
    role,
    ports,
    launcherPid,
    launcherStartIdentity,
    parentHolderId,
    signal = null,
    timeoutMs = 5_000,
) => {
    const deadline = nowMs() + timeoutMs
    do {
        if (signal?.aborted) return null
        let pid = null
        try {
            if (processStartIdentity(launcherPid) !== launcherStartIdentity) break
            pid = ownedListenerProcess(launcherPid, launcherStartIdentity, ports)?.pid ?? null
        } catch (error) {
            if (error?.code !== 'PROCESS_IDENTITY_UNKNOWN') throw error
        }
        if (pid) {
            if (signal?.aborted) return null
            return registerDevelopmentHolder(role, pid, parentHolderId)
        }
        await sleep(100)
    } while (nowMs() < deadline)
    if (signal?.aborted) return null
    const listeners = ports.map(port => `${port}: ${listenerPids(port).join(',') || 'none'}`)
    throw new InstanceError(
        `Could not identify the ${role} listener under launcher PID ${launcherPid} (${listeners.join('; ')}).`,
        'LISTENER_OWNER_NOT_FOUND',
    )
}

export const heartbeatDevelopmentHolder = async holderId => {
    await heartbeatDevelopmentHolders([holderId])
}

export const heartbeatDevelopmentHolders = async holderIds => {
    const ids = new Set(holderIds)
    await withRegistry(async registry => {
        for (const allocation of Object.values(registry.allocations)) {
            for (const holder of allocation.holders) {
                if (!ids.has(holder.id) || !holderIsLive(holder)) continue
                holder.heartbeatAt = iso(nowMs())
                allocation.updatedAt = holder.heartbeatAt
            }
        }
    })
}

export const removeDevelopmentHolder = async holderId => {
    await withRegistry(async (registry, paths) => {
        for (const allocation of Object.values(registry.allocations)) {
            const before = allocation.holders.length
            allocation.holders = allocation.holders.filter(holder => holder.id !== holderId)
            if (allocation.holders.length === before) continue
            allocation.updatedAt = iso(nowMs())
            if (allocation.holders.length === 0) allocation.inactiveSince = iso(nowMs())
            await appendEvent(paths, 'holder-removed', { worktreeId: allocation.worktreeId, holderId })
            if (allocation.releaseWhenIdle && allocation.holders.length === 0) {
                delete registry.allocations[allocation.worktreeId]
                await appendEvent(paths, 'dev-allocation-released', {
                    worktreeId: allocation.worktreeId,
                    reason: 'release-when-idle',
                })
            }
            return
        }
    })
}

export const releaseDevelopment = async ({ force = false, requestWhenIdle = false } = {}) => {
    const worktree = await resolveWorktree()
    const manifest = await readManifest(worktree)
    return withRegistry(async (registry, paths) => {
        const ownedByManifest = allocationForWorktree(registry, manifest, worktree, !force)
        const allocation =
            ownedByManifest ??
            (force
                ? Object.values(registry.allocations).find(candidate =>
                      sameCanonicalPath(candidate.path, worktree.root),
                  )
                : null)
        if (!allocation) return { released: false, reason: 'unallocated' }
        if (allocation.holders.length > 0) {
            if (requestWhenIdle) {
                allocation.releaseWhenIdle = true
                await appendEvent(paths, 'release-when-idle-requested', {
                    worktreeId: allocation.worktreeId,
                    holders: allocation.holders.map(({ id, role, pid, startIdentity }) => ({
                        id,
                        role,
                        pid,
                        startIdentity,
                    })),
                })
                return { released: false, reason: 'live-holders', requested: true }
            }
            const details = allocation.holders
                .map(holder => `${holder.role} PID ${holder.pid} started ${holder.startIdentity}`)
                .join(', ')
            throw new InstanceError(
                `Refusing release while validated holders remain: ${details}`,
                'LIVE_HOLDERS',
            )
        }
        delete registry.allocations[allocation.worktreeId]
        await appendEvent(paths, 'dev-allocation-released', {
            worktreeId: allocation.worktreeId,
            reason: force ? 'forced-corrupt-metadata-release' : 'explicit',
        })
        return { released: true }
    })
}

export const statusDevelopment = async () => {
    const worktree = await resolveWorktree()
    const manifest = await readManifest(worktree)
    let status
    await withRegistry(async registry => {
        const allocation = allocationForWorktree(registry, manifest, worktree)
        if (!allocation) {
            status = manifest
                ? { state: 'reclaimable', path: worktree.root, branch: worktree.branch, manifest }
                : { state: 'unallocated', path: worktree.root, branch: worktree.branch }
            return
        }
        await updateAllocationLocation(allocation, worktree)
        allocation.updatedAt = iso(nowMs())
        allocation.generation = registry.generation + 1
        await writeManifest(worktree, allocation, registry.generation + 1)
        status = describeDevelopmentAllocation(allocation)
    })
    return status
}

export const listInstances = async () => {
    let instances = []
    await withRegistry(async registry => {
        const development = Object.values(registry.allocations).map(allocation => ({
            kind: 'development',
            ...describeDevelopmentAllocation(allocation),
        }))
        const workflows = Object.values(registry.transients).map(transient => {
            const holders = [transient.holder, transient.childHolder, transient.listenerHolder].filter(
                Boolean,
            )
            return {
                ...transient,
                kind: 'workflow',
                state: 'active',
                health: holdersHealth(holders),
                ageMs: nowMs() - Date.parse(transient.createdAt),
                slot: developmentSlot(transient.bundle),
                holders,
            }
        })
        instances = [...development, ...workflows].sort(
            (left, right) => left.bundle.renderer - right.bundle.renderer,
        )
    })
    return { instances }
}

export const stopDevelopment = async () => {
    const worktree = await resolveWorktree()
    const manifest = await readManifest(worktree)
    const stopped = []
    let holders = []
    let targets = []
    await withRegistry(async (registry, paths) => {
        const allocation = allocationForWorktree(registry, manifest, worktree)
        const developmentHolders = allocation
            ? allocation.holders.filter(holder => holder.worktreeId === allocation.worktreeId)
            : []
        const orphanedWorkflowHolders = Object.values(registry.transients)
            .filter(
                transient =>
                    transient.worktreeIdentity === worktree.identity && !holderIsLive(transient.holder),
            )
            .flatMap(transient => [transient.childHolder, transient.listenerHolder].filter(Boolean))
        holders = [...developmentHolders, ...orphanedWorkflowHolders]
        if (holders.length === 0) return
        targets = rootProcessHolders(holders)
        await appendEvent(paths, 'dev-stop-requested', {
            worktreeId: holders[0].worktreeId,
            targets: targets.map(({ role, pid, startIdentity }) => ({ role, pid, startIdentity })),
        })
    })
    await Promise.all(
        targets.map(holder =>
            holderIsLive(holder) ? stopProcessTree(holder.pid, holder.startIdentity) : undefined,
        ),
    )
    const survivors = [
        ...new Map(
            holders.filter(holderIsLive).map(holder => [`${holder.pid}:${holder.startIdentity}`, holder]),
        ).values(),
    ]
    for (const holder of survivors) {
        signalProcessTree(holder.pid, 'SIGKILL', holder.startIdentity)
    }
    const hardStopDeadline = nowMs() + 2_000
    while (survivors.some(holderIsLive) && nowMs() < hardStopDeadline) {
        await sleep(25)
    }
    await withRegistry(async () => {})
    const failed = holders.filter(holderIsLive)
    if (failed.length > 0) {
        const details = failed
            .map(holder => `${holder.role} PID ${holder.pid} started ${holder.startIdentity}`)
            .join(', ')
        throw new InstanceError(`Failed to stop validated holders: ${details}`, 'STOP_FAILED')
    }
    stopped.push(...holders.map(({ role, pid, startIdentity }) => ({ role, pid, startIdentity })))
    return stopped
}

const workflowClaims = (workflow, appDataPath, worktreeId) => {
    switch (workflow) {
        case 'electron-e2e':
            return [
                `electron-development-bundle:${worktreeId}`,
                `workflow:electron-e2e:${worktreeId}`,
                `app-data:${appDataPath}`,
            ]
        case 'renderer-e2e':
            return [`workflow:renderer-e2e:${worktreeId}`]
        default:
            throw new InstanceError(`Unknown workflow: ${workflow}`, 'INVALID_WORKFLOW')
    }
}

export const allocateTransient = async workflow => {
    const worktree = await resolveWorktree()
    const appDataPath = await canonicalizePath(join(worktree.root, '.app-data.e2e', workflow))
    let manifest = await readManifest(worktree)
    const copiedManifest = manifest
        ? manifestPathBelongsElsewhere(manifest, worktree) ||
          (await withRegistry(async registry =>
              Boolean(
                  registry.allocations[manifest.worktreeId] &&
                  !allocationForManifest(registry, manifest, worktree, false),
              ),
          ))
        : false
    if (!manifest || copiedManifest) {
        const { allocation, created } = await allocateDevelopmentWithResult()
        if (created) {
            await withRegistry(async (registry, paths) => {
                const current = registry.allocations[allocation.worktreeId]
                if (!current || current.holders.length > 0) return
                delete registry.allocations[allocation.worktreeId]
                await appendEvent(paths, 'dev-allocation-released', {
                    worktreeId: allocation.worktreeId,
                    reason: 'transient-identity-initialization',
                })
            })
        }
        manifest = await readManifest(worktree)
    }
    if (!manifest) throw new InstanceError('Could not create the worktree identity manifest')
    let transient
    await withRegistry(async (registry, paths) => {
        const allocation = allocationForWorktree(registry, manifest, worktree)
        const worktreeId = allocation?.worktreeId ?? manifest.worktreeId
        if (allocation) {
            await updateAllocationLocation(allocation, worktree)
        }
        if (allocation && manifest.worktreeId !== worktreeId) {
            await writeManifest(worktree, allocation, registry.generation + 1)
        }
        const claims = workflowClaims(workflow, appDataPath, worktreeId)
        assertClaimsAvailable(registry, claims, worktreeId)
        const id = randomUUID()
        transient = {
            id,
            worktreeId,
            worktreeIdentity: worktree.identity,
            workflow,
            path: worktree.root,
            createdAt: iso(nowMs()),
            bundle: await allocateBundle(registry),
            appDataPath,
            claims,
            holder: await newHolder(worktreeId, `workflow:${workflow}`),
        }
        registry.transients[id] = transient
        await appendEvent(paths, 'transient-allocation-created', {
            transientId: id,
            worktreeId,
            workflow,
            ports: transient.bundle,
        })
    })
    return transient
}

export const heartbeatTransient = async id => {
    await withRegistry(async registry => {
        const transient = registry.transients[id]
        if (transient && holderIsLive(transient.holder)) transient.holder.heartbeatAt = iso(nowMs())
        if (transient?.childHolder && holderIsLive(transient.childHolder)) {
            transient.childHolder.heartbeatAt = iso(nowMs())
        }
        if (transient?.listenerHolder && holderIsLive(transient.listenerHolder)) {
            transient.listenerHolder.heartbeatAt = iso(nowMs())
        }
    })
}

export const setTransientChildHolder = async (id, pid, startIdentity = null) => {
    const childStartIdentity = startIdentity ?? processStartIdentity(pid)
    if (!childStartIdentity) return false
    await withRegistry(async registry => {
        const transient = registry.transients[id]
        if (!transient) throw new InstanceError(`Transient allocation ${id} no longer exists`)
        transient.childHolder = await newHolder(
            transient.worktreeId,
            `workflow:${transient.workflow}`,
            pid,
            null,
            false,
            childStartIdentity,
        )
    })
    return true
}

export const registerTransientListenerHolder = async (id, launcherPid, launcherStartIdentity, port) => {
    const listener = ownedListenerProcess(launcherPid, launcherStartIdentity, [port])
    if (!listener) return null
    let holder = null
    await withRegistry(async registry => {
        const transient = registry.transients[id]
        if (!transient) return
        if (processStartIdentity(listener.pid) !== listener.startIdentity) return
        if (
            transient.listenerHolder?.pid === listener.pid &&
            transient.listenerHolder.startIdentity === listener.startIdentity
        ) {
            holder = transient.listenerHolder
            return
        }
        holder = await newHolder(
            transient.worktreeId,
            `workflow-listener:${transient.workflow}`,
            listener.pid,
            null,
            false,
            listener.startIdentity,
        )
        transient.listenerHolder = holder
    })
    return holder
}

export const releaseTransient = async id => {
    await withRegistry(async (registry, paths) => {
        const transient = registry.transients[id]
        if (!transient) return
        if (transient.listenerHolder && holderIsLive(transient.listenerHolder)) return
        delete registry.transients[id]
        await appendEvent(paths, 'transient-allocation-released', {
            transientId: id,
            worktreeId: transient.worktreeId,
            workflow: transient.workflow,
        })
    })
}

export const bundleEnvironment = (bundle, appDataPath = null) => ({
    RELEASE_MAESTRO_RENDERER_PORT: String(bundle.renderer),
    RELEASE_MAESTRO_CDP_PORT: String(bundle.cdp),
    RELEASE_MAESTRO_INSPECTOR_PORT: String(bundle.inspector),
    ...(appDataPath ? { RELEASE_MAESTRO_APP_DATA_DIR: appDataPath } : {}),
})

const windowsMetaCharacters = /([()\][%!^"`<>&|;, *?])/g
const escapeWindowsCommand = command => command.replace(windowsMetaCharacters, '^$1')
const escapeWindowsArgument = (argument, doubleEscape) => {
    let value = String(argument)
    value = value.replace(/(?=(\\+?)?)\1"/g, '$1$1\\"')
    value = value.replace(/(?=(\\+?)?)\1$/g, '$1$1')
    value = `"${value}"`.replace(windowsMetaCharacters, '^$1')
    if (doubleEscape) value = value.replace(windowsMetaCharacters, '^$1')
    return value
}

const resolveWindowsCommand = command => {
    if (command.includes('/') || command.includes('\\')) return command
    const extensions = (process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean)
    for (const directory of (process.env['PATH'] ?? '').split(';')) {
        if (/\.(?:com|exe|bat|cmd)$/i.test(command)) {
            const candidate = join(directory, command)
            if (existsSync(candidate)) return candidate
            continue
        }
        for (const extension of extensions) {
            const candidate = join(directory, `${command}${extension}`)
            if (existsSync(candidate)) return candidate
        }
        const unextended = join(directory, command)
        if (existsSync(unextended)) {
            try {
                if (/^#!\s*(?:\/usr\/bin\/env\s+)?node(?:\s|$)/.test(readFileSync(unextended, 'utf8'))) {
                    return unextended
                }
            } catch {
                // A directory or unreadable shim cannot be launched as a Node script.
            }
        }
    }
    return command
}

const spawnPortable = (command, args, options) => {
    if (process.platform !== 'win32') return spawn(command, args, options)
    const resolved = resolveWindowsCommand(command)
    if (!/\.(?:cmd|bat)$/i.test(resolved)) {
        if (!/\.(?:com|exe)$/i.test(resolved) && existsSync(resolved)) {
            const shebang = readFileSync(resolved, 'utf8').match(/^#!\s*(?:\/usr\/bin\/env\s+)?([^\s]+)/)
            if (shebang && basename(shebang[1]).toLowerCase() === 'node') {
                return spawn(process.execPath, [resolved, ...args], options)
            }
        }
        return spawn(resolved, args, options)
    }
    const doubleEscape = basename(dirname(resolved)).toLowerCase() === '.bin'
    const commandLine = [
        escapeWindowsCommand(resolved),
        ...args.map(argument => escapeWindowsArgument(argument, doubleEscape)),
    ].join(' ')
    return spawn(process.env['COMSPEC'] ?? 'cmd.exe', ['/d', '/s', '/c', `"${commandLine}"`], {
        ...options,
        windowsVerbatimArguments: true,
    })
}

const windowsTreeCommand = `
$ErrorActionPreference = 'Stop'
try {
Add-Type -Path $env:RELEASE_MAESTRO_TREE_JOB_HELPER
$parentPid = [uint32]$env:RELEASE_MAESTRO_TREE_PARENT_PID
$parent = [ReleaseMaestro.Job]::OpenParent($parentPid)
if ([ReleaseMaestro.Job]::ParentExited($parent)) { exit 143 }
$parentProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $parentPid" -ErrorAction Stop
if (-not $parentProcess) { exit 143 }
if ([string]$parentProcess.CreationDate.ToUniversalTime().Ticks -ne $env:RELEASE_MAESTRO_TREE_PARENT_START) { exit 143 }
if ([ReleaseMaestro.Job]::ParentExited($parent)) { exit 143 }
$job = [ReleaseMaestro.Job]::CreateAndAssignCurrentProcess()
$arguments = '"' + $env:RELEASE_MAESTRO_TREE_SCRIPT + '"'
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = $env:RELEASE_MAESTRO_TREE_NODE
$startInfo.Arguments = $arguments
$startInfo.UseShellExecute = $false
$child = New-Object System.Diagnostics.Process
$child.StartInfo = $startInfo
if (-not $child.Start()) { throw 'Failed to start workflow command' }
while (-not $child.WaitForExit(100)) {
    if ([ReleaseMaestro.Job]::ParentExited($parent)) { exit 143 }
}
$child.WaitForExit()
$exitCode = $child.ExitCode
if ($env:RELEASE_MAESTRO_TREE_DEBUG -eq '1') {
    [Console]::Error.WriteLine("workflow tree: child exit=$exitCode active=$([ReleaseMaestro.Job]::ActiveProcessCount($job))")
}
while ([ReleaseMaestro.Job]::ActiveProcessCount($job) -gt 1) {
    if ([ReleaseMaestro.Job]::ParentExited($parent)) { exit 143 }
    Start-Sleep -Milliseconds 100
}
exit $exitCode
} catch {
    [Console]::Error.WriteLine($_.Exception.ToString())
    exit 1
}
`

export const spawnManaged = (command, args, options = {}) => {
    const { waitForTree = false, ...spawnOptions } = options
    const child =
        waitForTree && process.platform === 'win32'
            ? spawn(
                  'powershell.exe',
                  [
                      '-NoProfile',
                      '-NonInteractive',
                      '-EncodedCommand',
                      Buffer.from(windowsTreeCommand, 'utf16le').toString('base64'),
                  ],
                  {
                      stdio: 'inherit',
                      windowsHide: true,
                      ...spawnOptions,
                      env: {
                          ...process.env,
                          ...spawnOptions.env,
                          RELEASE_MAESTRO_TREE_NODE: process.execPath,
                          RELEASE_MAESTRO_TREE_PARENT_PID: String(process.pid),
                          RELEASE_MAESTRO_TREE_PARENT_START: currentProcessIdentity().startIdentity,
                          RELEASE_MAESTRO_TREE_SCRIPT: join(
                              dirname(fileURLToPath(import.meta.url)),
                              'windows-tree.mjs',
                          ),
                          RELEASE_MAESTRO_TREE_JOB_HELPER: join(
                              dirname(fileURLToPath(import.meta.url)),
                              'windows-job.cs',
                          ),
                          RELEASE_MAESTRO_TREE_COMMAND: JSON.stringify({ command, args }),
                      },
                  },
              )
            : spawnPortable(command, args, {
                  stdio: 'inherit',
                  detached: process.platform !== 'win32',
                  ...spawnOptions,
              })
    try {
        child.releaseMaestroStartIdentity = processStartIdentity(child.pid)
    } catch (error) {
        child.releaseMaestroStartIdentity = null
        child.releaseMaestroIdentityError = error
        if (child.pid) child.kill('SIGKILL')
    }
    return child
}

export const spawnPackageBinary = (binary, args, options = {}) => {
    const configured = process.env['RELEASE_MAESTRO_PNPM_COMMAND']?.trim()
    if (configured) return spawnManaged(configured, ['exec', binary, ...args], options)
    const npmExecPath = process.env['npm_execpath']?.trim()
    if (npmExecPath && existsSync(npmExecPath) && /(?:^|[/\\])pnpm(?:\.c?js)?$/i.test(npmExecPath)) {
        return spawnManaged(process.execPath, [npmExecPath, 'exec', binary, ...args], options)
    }
    const executableNames = process.platform === 'win32' ? ['pnpm.cmd', 'pnpm.exe', 'pnpm'] : ['pnpm']
    const available = (process.env['PATH'] ?? '')
        .split(delimiter)
        .some(directory => executableNames.some(name => existsSync(join(directory, name))))
    if (!available) {
        throw new InstanceError(
            'pnpm is unavailable. Install pnpm or set RELEASE_MAESTRO_PNPM_COMMAND.',
            'PNPM_NOT_FOUND',
        )
    }
    return spawnManaged('pnpm', ['exec', binary, ...args], options)
}

export const forwardSignals = (children, onSignal = () => {}) => {
    const listeners = new Map()
    for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
        const listener = () => {
            onSignal(signal)
            for (const child of children()) {
                if (!child?.pid || child.exitCode !== null || child.signalCode !== null) continue
                if (child.releaseMaestroStartIdentity) {
                    signalProcessTree(child.pid, signal, child.releaseMaestroStartIdentity)
                } else {
                    child.kill(signal)
                }
            }
        }
        process.on(signal, listener)
        listeners.set(signal, listener)
    }
    return () => listeners.forEach((listener, signal) => process.off(signal, listener))
}

export const startHeartbeat = callback => {
    const timer = setInterval(() => void callback().catch(() => {}), 15_000)
    timer.unref()
    return () => clearInterval(timer)
}

export const waitForPort = async (port, timeoutMs = 120_000, signal = null) => {
    const deadline = nowMs() + timeoutMs
    while (nowMs() < deadline) {
        if (signal?.aborted) return
        for (const host of ['::1', '127.0.0.1']) {
            const connected = await new Promise(resolvePromise => {
                const socket = net.connect({ host, port })
                let settled = false
                const finish = connectedValue => {
                    if (settled) return
                    settled = true
                    signal?.removeEventListener('abort', abort)
                    socket.destroy()
                    resolvePromise(connectedValue)
                }
                const abort = () => finish(false)
                socket.once('connect', () => {
                    finish(true)
                })
                socket.once('error', () => finish(false))
                socket.setTimeout(250, () => finish(false))
                signal?.addEventListener('abort', abort, { once: true })
            })
            if (connected) return
            if (signal?.aborted) return
        }
        await new Promise(resolvePromise => {
            const finish = () => {
                clearTimeout(timer)
                signal?.removeEventListener('abort', finish)
                resolvePromise()
            }
            const timer = setTimeout(finish, 100)
            signal?.addEventListener('abort', finish, { once: true })
        })
    }
    if (signal?.aborted) return
    throw new InstanceError(`Timed out waiting for loopback port ${port}`, 'PORT_TIMEOUT')
}

export const followLog = async ({ follow = false, json = false, color = false } = {}) => {
    const { log } = getStatePaths()
    let offset = 0
    let fileIdentity = null
    const printNew = async () => {
        let content = ''
        try {
            const handle = await open(log, 'r')
            try {
                const info = await handle.stat()
                const identity = `${info.dev}:${info.ino}`
                if (fileIdentity !== null && identity !== fileIdentity) offset = 0
                fileIdentity = identity
                content = await handle.readFile('utf8')
            } finally {
                await handle.close()
            }
        } catch (error) {
            if (error?.code !== 'ENOENT') throw error
            fileIdentity = null
            offset = 0
        }
        if (content.length < offset) offset = 0
        const next = content.slice(offset)
        offset = content.length
        for (const line of next.split('\n').filter(Boolean)) {
            try {
                const event = JSON.parse(line)
                process.stdout.write(
                    json ? `${JSON.stringify(event)}\n` : `${formatLogEvent(event, { color })}\n\n`,
                )
            } catch {
                process.stdout.write(`${line}\n`)
            }
        }
    }
    await printNew()
    if (!follow) return
    for (;;) {
        await sleep(500)
        await printNew()
    }
}

export const releaseRemovedWorktree = async (worktreePath, worktreeId = null) => {
    const canonical = await canonicalizePath(worktreePath)
    if (existsSync(canonical)) return { released: false, reason: 'worktree-still-exists' }
    return withRegistry(async (registry, paths) => {
        let match
        for (const allocation of Object.values(registry.allocations)) {
            if (
                sameCanonicalPath(await canonicalizePath(allocation.path), canonical) &&
                (!worktreeId || allocation.worktreeId === worktreeId)
            ) {
                match = allocation
                break
            }
        }
        if (!match) return { released: false, reason: 'unallocated' }
        if (match.holders.length > 0) return { released: false, reason: 'live-holders' }
        delete registry.allocations[match.worktreeId]
        await appendEvent(paths, 'removed-worktree-released', {
            worktreeId: match.worktreeId,
            path: canonical,
        })
        return { released: true }
    })
}

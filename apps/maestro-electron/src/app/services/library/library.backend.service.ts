import { Observable } from 'rxjs'
import { readdir, stat, lstat } from 'node:fs/promises'
import { basename, dirname, relative, isAbsolute, parse, join } from 'node:path'
import {
    LibraryScanUpdate,
    MetadataPrescanUpdate,
    MetadataScanUpdate,
    PrescanFileFact,
} from '@release-maestro/core'
import { MetadataBackendService } from '../metadata/metadata.backend.service'
import { LibraryBackendRepository, MovedSongCandidate } from './library.backend.repository'

const DEEP_READ_BATCH_SIZE = 100

export class LibraryBackendService {
    constructor(
        private readonly repository: LibraryBackendRepository,
        private readonly metadata: MetadataBackendService,
    ) {}

    scan(
        paths: string[],
        abortSignal?: AbortSignal,
        initialScan = false,
        unavailableFolders: string[] = [],
    ): Observable<LibraryScanUpdate> {
        return new Observable<LibraryScanUpdate>(subscriber => {
            const run = async () => {
                const scanStartedAt = this.repository.nextScanSeenAt()
                let prescanCount = 0
                let unchanged = 0
                let changed = 0
                let newCount = 0
                let errors = 0
                let prescanErrors = 0
                let normalizationIssues = 0
                let ingested = 0
                const changedPaths = new Set<string>()
                const moves: MovedSongCandidate[] = []
                const failedReads = new Map<string, ReturnType<LibraryBackendRepository['getReadIdentity']>>()

                try {
                    await new Promise<void>((resolve, reject) => {
                        this.metadata.prescan(paths, abortSignal).subscribe({
                            next: (update: MetadataPrescanUpdate) => {
                                if (update.phase == 'batch') {
                                    const comparison = this.repository.processPrescanBatch(
                                        update.items,
                                        scanStartedAt,
                                        initialScan,
                                    )
                                    unchanged += comparison.unchanged
                                    changed += comparison.changed
                                    newCount += comparison.new
                                    for (const path of comparison.changedPaths) changedPaths.add(path)
                                    subscriber.next({
                                        phase: 'discovery',
                                        discovered: unchanged + changed + newCount,
                                        new: newCount,
                                        changed,
                                        unchanged,
                                    })
                                } else if (update.phase == 'completed') {
                                    prescanCount = update.count
                                    prescanErrors = update.errors
                                } else if (update.phase == 'itemError') {
                                    errors += 1
                                    subscriber.next(update)
                                } else if (update.phase == 'error') {
                                    subscriber.next(update)
                                    reject(new Error(update.error.message))
                                }
                            },
                            error: reject,
                            complete: resolve,
                        })
                    })

                    if (abortSignal?.aborted) return
                    await this.queueMissingCovers(scanStartedAt, abortSignal, (path, error) => {
                        errors += 1
                        subscriber.next({
                            phase: 'itemError',
                            path,
                            error: error instanceof Error ? error.message : String(error),
                        })
                    })
                    if (abortSignal?.aborted) return
                    const { extractorVersion } = await this.metadata.ping()
                    if (abortSignal?.aborted) return
                    const metadataReadTotal = this.repository.countSongsNeedingMetadata(
                        scanStartedAt,
                        extractorVersion,
                    )
                    const refreshTotal = this.repository.countSongsNeedingVersionRefresh(
                        scanStartedAt,
                        extractorVersion,
                    )
                    let metadataReadDone = 0
                    let afterPath: string | null = null

                    subscriber.next({ phase: 'started', total: metadataReadTotal, refreshTotal })

                    while (!abortSignal?.aborted) {
                        const facts = this.repository.listSongsNeedingMetadata(
                            scanStartedAt,
                            afterPath,
                            DEEP_READ_BATCH_SIZE,
                            extractorVersion,
                        )
                        if (facts.length == 0) break
                        const lastFact = facts[facts.length - 1]
                        if (!lastFact) break
                        afterPath = lastFact.path
                        const factsByPath = new Map(facts.map(fact => [fact.path, fact]))

                        await this.readAndIngestBatch(facts, abortSignal, update => {
                            if (update.phase == 'item') {
                                const fact = factsByPath.get(update.metadata.path)
                                if (!fact) {
                                    errors += 1
                                    failedReads.set(update.metadata.path, null)
                                    subscriber.next({
                                        phase: 'itemError',
                                        path: update.metadata.path,
                                        code: 'INTERNAL_ERROR',
                                        error: 'Prescan facts missing for metadata result',
                                    })
                                } else {
                                    const openIssues = this.repository.ingestMetadata(
                                        update.metadata,
                                        fact,
                                        new Date(Math.max(Date.now(), scanStartedAt.getTime())),
                                        extractorVersion,
                                    )
                                    ingested += 1
                                    subscriber.next(update)
                                    if (openIssues > 0) {
                                        // Count distinct tracks with issues, not the issues themselves.
                                        normalizationIssues += 1
                                        subscriber.next({ phase: 'normalization', normalizationIssues })
                                    }
                                }
                                metadataReadDone += 1
                                subscriber.next({
                                    phase: 'progress',
                                    done: metadataReadDone,
                                    total: metadataReadTotal,
                                })
                            } else if (update.phase == 'itemError') {
                                failedReads.set(update.path, this.repository.getReadIdentity(update.path))
                                errors += 1
                                metadataReadDone += 1
                                subscriber.next(update)
                                subscriber.next({
                                    phase: 'progress',
                                    done: metadataReadDone,
                                    total: metadataReadTotal,
                                })
                            } else if (update.phase == 'error') {
                                subscriber.next(update)
                            }
                        })
                    }
                } finally {
                    this.repository.invalidateCoexistingMoves(scanStartedAt)
                    // Positive proof of coexistence survives failures and cancellation too.
                    // Only applying moves depends on a complete scan; losing this evidence could
                    // incorrectly merge a known copy after its original disappears before retry.
                    for (const probe of this.repository.findAvailabilityProbes(scanStartedAt)) {
                        if (
                            (await compareLocations(
                                probe.originalPath,
                                probe.foundPath,
                                unavailableFolders,
                            )) == 'copy'
                        )
                            this.repository.recordSongAvailable(probe.songId, scanStartedAt)
                    }
                    for (const candidate of this.repository.findMovedSongCandidates(scanStartedAt)) {
                        let proven = true
                        for (const previous of [candidate.original, ...(candidate.intermediate ?? [])]) {
                            if (previous.id == candidate.found.id) continue
                            const location = await compareLocations(
                                previous.path,
                                candidate.found.path,
                                unavailableFolders,
                            )
                            if (location == 'copy')
                                this.repository.recordSongAvailable(previous.id, scanStartedAt)
                            if (location != 'moved') proven = false
                        }
                        if (proven) {
                            this.repository.recordPendingMove(candidate)
                            moves.push(candidate)
                        }
                    }
                }

                if (abortSignal?.aborted) return

                // Discovery must complete. Read failures defer only candidates whose
                // uniqueness they could invalidate. Cancelled scans never apply moves.
                if (prescanErrors == 0) {
                    for (const candidate of moves) {
                        // Unknown or changed same-size files can hide another candidate.
                        if (
                            [...failedReads.values()].some(
                                identity =>
                                    identity == null ||
                                    (identity.size == candidate.found.size &&
                                        (candidate.original.contentHash == null ||
                                            identity.contentHash == null ||
                                            identity.contentHash == candidate.found.contentHash)),
                            )
                        )
                            continue
                        this.repository.reconcileMovedSong(candidate)
                        if (candidate.found.firstSeenAt?.getTime() == scanStartedAt.getTime()) {
                            newCount -= 1
                            changed += 1
                        } else if (!changedPaths.has(candidate.found.path)) {
                            unchanged -= 1
                            changed += 1
                        }
                    }
                    if (moves.length > 0) {
                        normalizationIssues = this.repository.countOpenIssuesForReadSongs(scanStartedAt)
                        subscriber.next({ phase: 'normalization', normalizationIssues })
                    }
                }
                // Retain the ADR 0003 guard: discovery errors are not proof of absence.
                const missing = prescanErrors == 0 ? this.repository.markNotSeenPresent(scanStartedAt) : 0

                this.repository.removeUnusedCatalogEntities()

                subscriber.next({
                    phase: 'completed',
                    count: ingested,
                    total: prescanCount,
                    unchanged,
                    changed,
                    new: newCount,
                    missing,
                    errors,
                })
            }

            run().then(
                () => subscriber.complete(),
                error => subscriber.error(error),
            )
        })
    }

    private async queueMissingCovers(
        seenAt: Date,
        abortSignal: AbortSignal | undefined,
        onError: (path: string, error: unknown) => void,
    ): Promise<void> {
        let afterPath: string | null = null
        while (!abortSignal?.aborted) {
            const songs = this.repository.listSeenSongCovers(seenAt, afterPath, DEEP_READ_BATCH_SIZE)
            const lastSong = songs.at(-1)
            if (lastSong === undefined) return
            afterPath = lastSong.path
            const coverPaths = [...new Set(songs.map(song => song.coverPath))]
            const inspectionErrors = new Map<string, unknown>()
            const missing = await Promise.all(
                coverPaths.map(async coverPath => {
                    try {
                        return (await stat(coverPath)).isFile() ? [] : [coverPath]
                    } catch (error) {
                        if (
                            typeof error === 'object' &&
                            error !== null &&
                            'code' in error &&
                            (error.code === 'ENOENT' || error.code === 'ENOTDIR')
                        ) {
                            return [coverPath]
                        }
                        inspectionErrors.set(coverPath, error)
                        return []
                    }
                }),
            )
            if (abortSignal?.aborted) return
            for (const song of songs) {
                if (inspectionErrors.has(song.coverPath)) {
                    onError(song.path, inspectionErrors.get(song.coverPath))
                }
            }
            const missingCoverPaths = new Set(missing.flat())
            this.repository.queueSongsWithMissingCovers(
                seenAt,
                songs.filter(song => missingCoverPaths.has(song.coverPath)).map(song => song.path),
            )
        }
    }

    private readAndIngestBatch(
        facts: PrescanFileFact[],
        abortSignal: AbortSignal | undefined,
        onUpdate: (update: MetadataScanUpdate) => void,
    ): Promise<void> {
        return new Promise<void>((resolve, reject) => {
            let terminalError: Error | null = null
            this.metadata
                .readFiles(
                    facts.map(fact => fact.path),
                    abortSignal,
                )
                .subscribe({
                    next: update => {
                        if (update.phase == 'error') {
                            terminalError = new Error(update.error.message)
                        } else if (update.phase == 'item' || update.phase == 'itemError') {
                            onUpdate(update)
                        }
                    },
                    error: reject,
                    complete: () => (terminalError ? reject(terminalError) : resolve()),
                })
        })
    }
}

/** Distinguish an independent original from case aliases on case-insensitive filesystems. */
const compareLocations = async (
    original: string,
    found: string,
    unavailableFolders: string[],
): Promise<'moved' | 'copy' | 'unknown'> => {
    if (
        unavailableFolders.some(folder => {
            const child = relative(folder, original)
            return (
                child == '' ||
                (!isAbsolute(child) && child != '..' && !child.startsWith('../') && !child.startsWith('..\\'))
            )
        })
    )
        return 'unknown'
    const volume = await sourceVolumeRoot(original)
    if (volume) {
        try {
            const root = await stat(volume)
            if (!root.isDirectory()) return 'unknown'
            // A removable Unix mount can leave an empty directory after unmounting.
            if (process.platform != 'win32' && root.dev == (await stat(dirname(volume))).dev) {
                return 'unknown'
            }
        } catch {
            return 'unknown'
        }
    }
    const entry = await lstat(original).catch(error => (isAbsent(error) ? 'absent' : 'unknown'))
    if (entry == 'absent') return 'moved'
    if (entry == 'unknown') return 'unknown'
    try {
        const after = await lstat(found)
        if (
            original.toLowerCase() == found.toLowerCase() &&
            entry.ino != 0 &&
            entry.ino == after.ino &&
            entry.dev == after.dev
        ) {
            // realpath preserves input casing on macOS. Directory entries reveal the actual spelling.
            // Independent hardlinks and symlinks still have their own entry and remain copies.
            for (let path = original; dirname(path) != path; path = dirname(path)) {
                if (!(await readdir(dirname(path))).includes(basename(path))) return 'moved'
            }
        }
        return 'copy'
    } catch {
        return 'unknown'
    }
}

/** Standard external-volume roots remain relevant after their folder leaves settings. */
const sourceVolumeRoot = async (path: string): Promise<string | null> => {
    if (process.platform == 'win32') return parse(path).root || null
    const parts = path.split('/')
    if (parts[1] == 'Volumes' || parts[1] == 'mnt') return parts[2] ? join('/', parts[1], parts[2]) : null
    if (parts[1] == 'media' && parts[2]) {
        const directRoot = join('/', 'media', parts[2])
        try {
            // Linux desktops use both /media/<volume> and /media/<user>/<volume>.
            if ((await stat(directRoot)).dev != (await stat('/media')).dev) return directRoot
        } catch {
            return directRoot
        }
        return parts[3] ? join('/', ...parts.slice(1, 4)) : directRoot
    }
    if (parts[1] == 'run' && parts[2] == 'media') {
        return parts[4] ? join('/', ...parts.slice(1, 5)) : null
    }
    return null
}

const isAbsent = (error: unknown): boolean =>
    typeof error == 'object' &&
    error != null &&
    'code' in error &&
    (error.code == 'ENOENT' || error.code == 'ENOTDIR')

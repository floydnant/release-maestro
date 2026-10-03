import { Observable } from 'rxjs'
import {
    LibraryScanUpdate,
    MetadataPrescanUpdate,
    MetadataScanUpdate,
    PrescanFileFact,
} from '@release-maestro/core'
import { MetadataBackendService } from '../metadata/metadata.backend.service'
import { LibraryBackendRepository } from './library.backend.repository'

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
                let discoveryComplete = false
                let readsComplete = false
                let normalizationIssues = 0
                let ingested = 0
                let missing = 0
                const changedPaths = new Set<string>()
                const failedReadPaths = new Set<string | null>()

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
                                    discoveryComplete = update.errors == 0
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
                                    failedReadPaths.add(null)
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
                                failedReadPaths.add(update.path)
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
                    readsComplete = true
                } finally {
                    const reconciliation = await this.repository.reconcileScan({
                        seenAt: scanStartedAt,
                        complete: discoveryComplete && readsComplete,
                        changedPaths,
                        failedReadPaths,
                        unavailableFolders,
                        abortSignal,
                    })
                    newCount += reconciliation.adjustments.new
                    changed += reconciliation.adjustments.changed
                    unchanged += reconciliation.adjustments.unchanged
                    missing = reconciliation.missing
                    if (reconciliation.normalizationIssues != null) {
                        normalizationIssues = reconciliation.normalizationIssues
                        subscriber.next({ phase: 'normalization', normalizationIssues })
                    }
                }

                if (abortSignal?.aborted) return

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
                        if (isAbsent(error)) {
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

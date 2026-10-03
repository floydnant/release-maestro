import { Observable } from 'rxjs'
import { stat } from 'node:fs/promises'
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

    scan(paths: string[], abortSignal?: AbortSignal, initialScan = false): Observable<LibraryScanUpdate> {
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
                const { extractorVersion } = await this.metadata.ping()
                if (abortSignal?.aborted) return
                const metadataReadTotal = this.repository.countSongsNeedingMetadata(scanStartedAt, extractorVersion)
                const refreshTotal = this.repository.countSongsNeedingVersionRefresh(scanStartedAt, extractorVersion)
                let metadataReadDone = 0
                let ingested = 0
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

                if (abortSignal?.aborted) return
                // A cancelled scan may have ingested a song before it stopped. A later
                // scan must collect entities left behind even when it reads no files.
                this.repository.removeUnusedCatalogEntities()

                // A complete scan is needed to distinguish moves from copies in later batches.
                // Failed/cancelled reads leave their discovery rows for the next scan to retry.
                if (errors == 0 && prescanErrors == 0) {
                    const moves = []
                    for (const candidate of this.repository.findMovedSongCandidates(scanStartedAt)) {
                        const absent = await pathIsAbsent(candidate.missing.path)
                        if (abortSignal?.aborted) return
                        if (absent) moves.push(candidate)
                    }
                    for (const candidate of moves) {
                        this.repository.reconcileMovedSong(candidate)
                        if (candidate.found.addedAt?.getTime() == scanStartedAt.getTime()) {
                            newCount -= 1
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

/** An excluded but reachable original is a copy, not a move. Permission failures are inconclusive. */
const pathIsAbsent = async (path: string): Promise<boolean> => {
    try {
        await stat(path)
        return false
    } catch (error) {
        return (
            typeof error == 'object' &&
            error != null &&
            'code' in error &&
            (error.code == 'ENOENT' || error.code == 'ENOTDIR')
        )
    }
}

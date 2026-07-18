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

    scan(paths: string[], abortSignal?: AbortSignal): Observable<LibraryScanUpdate> {
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

                // Absent-file reconciliation only runs when it is provably safe:
                //  - not cancelled (a cancelled discovery has not seen every file), and
                //  - discovery had no errors (an unreadable subtree must not mark
                //    its files as missing).
                if (abortSignal?.aborted) return
                const missing = prescanErrors == 0 ? this.repository.markNotSeenPresent(scanStartedAt) : 0
                const metadataReadTotal = this.repository.countSongsNeedingMetadata()
                let metadataReadDone = 0
                let ingested = 0
                let afterPath: string | null = null

                subscriber.next({ phase: 'started', total: metadataReadTotal })

                while (!abortSignal?.aborted) {
                    const facts = this.repository.listSongsNeedingMetadata(afterPath, DEEP_READ_BATCH_SIZE)
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
                                    new Date(),
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

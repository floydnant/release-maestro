import { setTimeout as waitForRetry } from 'node:timers/promises'
import {
    catchError,
    concat,
    concatMap,
    connect,
    defer,
    dematerialize,
    EMPTY,
    endWith,
    filter,
    ignoreElements,
    map,
    materialize,
    merge,
    mergeAll,
    mergeMap,
    Observable,
} from 'rxjs'
import {
    EmailImportProgress,
    EmailImportStreamPacket,
    EmailVendor,
    FetchFailedException,
} from '@release-maestro/core'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import {
    BandcampApiFailedToFetchTralbumException,
    BandcampApiMalformedTralbumDataException,
    BandcampApiRedirectException,
} from '../bandcamp/bandcamp-api.exceptions'
import { parseBandcampEmail } from '../bandcamp/bandcamp.email-parser'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { EmailImportQueue, EmailSaveBatch } from './email-import-queue'
import { FeedBackendRepository } from './feed.backend.repository'

/**
 * How far before the import checkpoint the next import starts reading. A message can land in the
 * mailbox after a newer one already has (sync lag, a Mac that was offline), and its date received is
 * then older than the checkpoint. Re-reading this window catches it; dedupe keeps the re-read from
 * creating duplicate feed items.
 */
const EMAIL_IMPORT_CHECKPOINT_OVERLAP_MS = 1000 * 60 * 60 * 24
// Keeps the request gate's background slots filled; the gate owns the network limit.
const MAX_PARENT_ALBUM_LOOKUPS = 8
const PARENT_ALBUM_LOOKUP_RETRY_MS = [250, 1000]

/** The track page cannot name its album: it is gone, malformed, or its redirects fail. */
const parentAlbumIsUnknowable = (error: unknown) =>
    error instanceof BandcampApiRedirectException ||
    error instanceof BandcampApiMalformedTralbumDataException ||
    (error instanceof BandcampApiFailedToFetchTralbumException && [404, 410].includes(error.status))

/**
 * Worth another attempt: the network or Bandcamp's servers failed. A rate limit is not retried
 * here, because the HTTP client already waits out cooldowns for imports.
 */
const isTransientFailure = (error: unknown) =>
    error instanceof FetchFailedException ||
    (error instanceof BandcampApiFailedToFetchTralbumException && [500, 502, 503, 504].includes(error.status))

/** A track's parent album, or the track itself when it is standalone or its page cannot say. */
const findParentAlbum = async (
    bandcampApi: BandcampApiBackendService,
    trackUrl: string,
    signal: AbortSignal,
): Promise<string> => {
    for (let attempt = 0; ; attempt++) {
        try {
            const track = await bandcampApi.scrapeTralbumInfo(trackUrl, signal, 'import')
            return track.parentAlbumUrl ?? trackUrl
        } catch (error) {
            if (parentAlbumIsUnknowable(error)) return trackUrl
            const retryDelay = PARENT_ALBUM_LOOKUP_RETRY_MS[attempt]
            if (signal.aborted || retryDelay === undefined || !isTransientFailure(error)) throw error
            await waitForRetry(retryDelay, undefined, { signal })
        }
    }
}

/** What can make the front of the import queue ready to save. */
type QueueChange = 'email-queued' | 'track-resolved' | 'export-ended'

/**
 * One import: exports the configured mailbox, turns its Bandcamp notifications into feed items and
 * saves them, then advances the mailbox's import checkpoint when the pass covered every email.
 *
 * Its progress stream has three parts, in this order of responsibility:
 *
 * 1. Export progress: `processing` for each exported email, then `finishing` when the export ends.
 * 2. Save progress: parent album lookups run concurrently, while saves follow export order. Once the
 *    export has ended, each save reports `finishing` with the number of emails saved so far.
 * 3. Exactly one terminal update, `completed`, `cancelled` or `error`, once the export has stopped
 *    and every queued save has settled.
 *
 * A processing failure stops the export too, because the remaining emails could not be saved in
 * order. Only a completed pass without skipped emails advances the checkpoint.
 */
export class EmailImportPass {
    private readonly vendor: EmailVendor = 'APPLE_MAIL'
    private readonly startedAt = new Date()
    /** The mailbox when the import starts, which is the one it exports and checkpoints. */
    private readonly mailboxName: string | null
    private readonly queue = new EmailImportQueue()
    private readonly processingFailure = new AbortController()
    /** Stops the export, the lookups and the saves: the user cancelled, or processing failed. */
    private readonly signal: AbortSignal

    // What the export delivered.
    private exported = 0
    private skipped = 0
    private newestReceivedAt: Date | null = null

    // What has been saved.
    private exportEnded = false
    private saved = 0
    private imported = 0
    private failure: { error: unknown } | null = null

    constructor(
        private readonly emailRepo: EmailBackendRepository,
        private readonly feedRepository: FeedBackendRepository,
        private readonly bandcampApi: BandcampApiBackendService,
        private readonly cancellation: AbortSignal,
    ) {
        this.mailboxName = emailRepo.getMailboxName(this.vendor)
        this.signal = AbortSignal.any([cancellation, this.processingFailure.signal])
    }

    async start(): Promise<Observable<EmailImportProgress>> {
        const checkpoint = this.mailboxName
            ? await this.feedRepository.getEmailImportCheckpoint(this.vendor, this.mailboxName)
            : null
        const receivedSince = checkpoint
            ? new Date(checkpoint.getTime() - EMAIL_IMPORT_CHECKPOINT_OVERLAP_MS)
            : null
        const emails$ = await this.emailRepo.loadEmails(
            this.vendor,
            this.signal,
            this.mailboxName,
            receivedSince,
        )

        return concat(
            merge(this.exportProgress(emails$), this.saveProgress(emails$)),
            defer(() => this.finish()),
        )
    }

    private exportProgress(emails$: Observable<EmailImportStreamPacket>): Observable<EmailImportProgress> {
        return concat(
            emails$.pipe(map(packet => this.recordExported(packet))),
            defer(() => (this.exported > 0 && !this.signal.aborted ? [this.finishingUpdate()] : [])),
        ).pipe(
            // A failed export also ends the save progress, which reports it once.
            catchError(() => EMPTY),
        )
    }

    private recordExported({ current, total, email }: EmailImportStreamPacket): EmailImportProgress {
        this.exported++
        if (email === null) {
            this.skipped++
        } else {
            const receivedAt = new Date(email.dateReceived)
            if (receivedAt.getTime() > (this.newestReceivedAt?.getTime() ?? -Infinity)) {
                this.newestReceivedAt = receivedAt
            }
        }
        return {
            phase: 'processing',
            current,
            total,
            // @TODO: this needs to be localized
            message: email?.subject.replace(/�/g, '') ?? '',
        }
    }

    private saveProgress(emails$: Observable<EmailImportStreamPacket>): Observable<EmailImportProgress> {
        return this.readyBatches(emails$).pipe(
            // Saves run one at a time, in export order. The end of the stream queues behind them,
            // so a lookup failure cannot end the import while an earlier save is still writing.
            materialize(),
            concatMap(async notification => {
                if (notification.kind === 'N') await this.save(notification.value)
                return notification
            }),
            dematerialize(),
            filter(() => this.exportEnded && !this.signal.aborted),
            map(() => this.finishingUpdate()),
            catchError((error: unknown) => {
                this.failure = { error }
                // The remaining emails cannot be saved in order. Stop the export; once it has
                // stopped, the terminal update reports the failure.
                this.processingFailure.abort()
                return EMPTY
            }),
        )
    }

    /** Save batches in export order, released as the export and the parent album lookups allow. */
    private readyBatches(emails$: Observable<EmailImportStreamPacket>): Observable<EmailSaveBatch> {
        return emails$.pipe(
            // Each exported email joins the queue, and names the tracks that need a lookup.
            map(({ email }) => this.queue.enqueue(email && parseBandcampEmail(email))),
            // Share the export between the queue, the lookups, and the end of the export.
            connect(trackLookups$ =>
                merge(
                    trackLookups$.pipe(map((): QueueChange => 'email-queued')),
                    trackLookups$.pipe(
                        mergeAll(),
                        mergeMap(trackUrl => this.resolveTrack(trackUrl), MAX_PARENT_ALBUM_LOOKUPS),
                        map((): QueueChange => 'track-resolved'),
                    ),
                    trackLookups$.pipe(ignoreElements(), endWith<QueueChange>('export-ended')),
                ),
            ),
            mergeMap(change => {
                if (change === 'export-ended') this.exportEnded = true
                return this.signal.aborted ? [] : this.queue.takeReady(this.exportEnded)
            }),
        )
    }

    private async resolveTrack(trackUrl: string): Promise<void> {
        this.queue.resolveTrack(trackUrl, await findParentAlbum(this.bandcampApi, trackUrl, this.signal))
    }

    private async save({ emailCount, feedItems }: EmailSaveBatch): Promise<void> {
        // A cancelled or failed import saves nothing more.
        this.signal.throwIfAborted()
        await this.feedRepository.ingestFeedItems(feedItems)
        this.imported += feedItems.length
        this.saved += emailCount
    }

    private finishingUpdate(): EmailImportProgress {
        return { phase: 'finishing', current: this.saved, total: this.exported }
    }

    private async finish(): Promise<EmailImportProgress> {
        // A cancelled export completes too, but only a full pass covers the mailbox.
        if (this.cancellation.aborted) return { phase: 'cancelled' }

        // Never checkpoint past an exported email that was not saved.
        const failure =
            this.failure ??
            (this.queue.size > 0 ? { error: new Error('Email import ended with unresolved emails') } : null)
        if (failure) {
            console.error('Error during email import:', failure.error)
            return {
                phase: 'error',
                errorMessage:
                    failure.error instanceof Error
                        ? failure.error.message
                        : 'Unknown error during email import',
            }
        }

        await this.advanceCheckpoint()
        return {
            phase: 'completed',
            totalProcessed: this.saved,
            totalImported: this.imported,
            newlyImported: await this.feedRepository.countItemsIngestedAfterDate(this.startedAt),
            ...(this.skipped > 0 ? { skippedEmails: this.skipped } : {}),
        }
    }

    private async advanceCheckpoint(): Promise<void> {
        // Skipped emails are retried by the next import, which must therefore start before them.
        if (!this.mailboxName || !this.newestReceivedAt || this.skipped > 0) return

        // A message dated in the future (a bad server clock) must not hide the mail that really
        // arrives before then
        const coveredUntil = new Date(Math.min(this.newestReceivedAt.getTime(), this.startedAt.getTime()))
        // The import itself succeeded; without a checkpoint the next one is just slower
        await this.feedRepository
            .advanceEmailImportCheckpoint(this.vendor, this.mailboxName, coveredUntil)
            .catch(error => console.error('Failed to save the email import checkpoint:', error))
    }
}

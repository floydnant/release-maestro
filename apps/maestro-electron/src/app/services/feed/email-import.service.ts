import {
    diagnosticErrorSummary,
    EmailImportProgress,
    EmailImportProgressUpdate,
    EmailImportTrigger,
    toRendererEmitter,
} from '@release-maestro/core'
import { BrowserWindow } from 'electron'
import { lastValueFrom, tap } from 'rxjs'
import { PersistentStore } from '../../utils/persistent-store.util'
import { createMainLogger } from '../../logging/logger'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { FeedBackendService } from './feed.backend.service'

/** How long after an import starts before an auto import runs again. */
export const EMAIL_AUTO_IMPORT_INTERVAL_MS = 1000 * 60 * 60
const log = createMainLogger('email-import')

export interface EmailImportState extends Record<string, unknown> {
    /** When the last import started, in ms since the epoch. */
    lastStartedAt?: number | null
}

/** Parse persisted JSON before it enters the import throttle. Invalid state makes an import due. */
export function deserializeEmailImportState(json: string): EmailImportState {
    const state: unknown = JSON.parse(json)
    const lastStartedAt =
        state !== null && typeof state === 'object' && 'lastStartedAt' in state ? state.lastStartedAt : null

    return {
        lastStartedAt:
            typeof lastStartedAt === 'number' && Number.isFinite(lastStartedAt) ? lastStartedAt : null,
    }
}

type BroadcastProgress = (update: EmailImportProgressUpdate) => void

const broadcastToAllWindows: BroadcastProgress = update => {
    for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) toRendererEmitter(win.webContents).send('email-import-progress', update)
    }
}

interface RunningImport {
    startedAt: number
    /** Mutable: a manual request takes over the reporting of a running auto import. */
    trigger: EmailImportTrigger
    abortController: AbortController
    /** The mailbox when the import started, which is the one it exports. */
    mailboxName: string | null
    /** Re-sent on a takeover, so the renderer moves the progress without waiting for the next email. */
    latest: EmailImportProgress
}

/**
 * Main-process owner of the email import lifecycle.
 *
 * Exactly one import runs at a time. A second request joins the running one, and a manual request
 * takes over an auto import, so the renderer reports it as the user's import from then on.
 *
 * Auto imports are throttled by when the last import *started*, not when it finished, so a
 * cancelled or failing import is not retried on every window focus.
 */
export class EmailImportService {
    private running: RunningImport | null = null
    private settled: Promise<void> = Promise.resolve()
    private stopping = false

    constructor(
        private readonly feed: FeedBackendService,
        private readonly email: EmailBackendRepository,
        /** Lives in the data dir next to the library state; wired in di.ts. */
        private readonly stateStore: PersistentStore<EmailImportState>,
        private readonly broadcast: BroadcastProgress = broadcastToAllWindows,
        private readonly now: () => number = () => Date.now(),
        private readonly platform: NodeJS.Platform = process.platform,
    ) {}

    /** Starts an import, or joins the one running. Resolves when it settles, and never rejects. */
    start(trigger: EmailImportTrigger): Promise<void> {
        if (this.stopping) return this.settled

        const running = this.running
        if (running) {
            if (trigger === 'auto') return this.settled
            if (running.mailboxName !== this.mailboxName()) {
                // The user switched mailbox since this import started: the export is of the wrong one
                running.abortController.abort()
                return this.settled.then(() => this.start(trigger))
            }
            if (running.trigger === 'auto') {
                running.trigger = 'manual'
                this.report(running, running.latest)
            }
            return this.settled
        }
        if (trigger === 'auto' && !this.isAutoImportDue()) return Promise.resolve()

        const started: RunningImport = {
            startedAt: this.now(),
            trigger,
            abortController: new AbortController(),
            mailboxName: this.mailboxName(),
            latest: { phase: 'started' },
        }
        this.running = started
        log.info('feed.import.started', { trigger })
        this.settled = this.run(started)
            .catch(error => log.errorEvent('feed.import.reporting-failed', diagnosticErrorSummary(error)))
            .finally(() => {
                this.running = null
            })
        return this.settled
    }

    cancel(): void {
        this.running?.abortController.abort()
    }

    /** Abort and drain before the app closes the database. Further starts are ignored. */
    stop(): Promise<void> {
        this.stopping = true
        this.cancel()
        return this.settled
    }

    private isAutoImportDue(): boolean {
        // Apple Mail is the only vendor, and an unconfigured mailbox would only fail the export
        if (this.platform !== 'darwin' || !this.mailboxName()) return false

        const lastStartedAt = this.stateStore.get('lastStartedAt')
        if (lastStartedAt == null) return true
        const elapsed = this.now() - lastStartedAt
        // A negative elapsed time is a clock that moved back, which must not block imports until it catches up
        return elapsed < 0 || elapsed >= EMAIL_AUTO_IMPORT_INTERVAL_MS
    }

    private mailboxName(): string | null {
        return this.email.getMailboxName('APPLE_MAIL')
    }

    private report(running: RunningImport, progress: EmailImportProgress): void {
        running.latest = progress
        this.broadcast({ ...progress, trigger: running.trigger })
        const fields = { trigger: running.trigger, durationMs: this.now() - running.startedAt }
        if (progress.phase === 'completed') {
            log.info('feed.import.completed', {
                ...fields,
                processed: progress.totalProcessed,
                imported: progress.totalImported,
                newlyImported: progress.newlyImported,
                skipped: progress.skippedEmails ?? 0,
            })
        } else if (progress.phase === 'cancelled') {
            log.info('feed.import.cancelled', fields)
        } else if (progress.phase === 'error') {
            log.warn('feed.import.failed', fields)
        }
    }

    private async run(running: RunningImport): Promise<void> {
        const report = (progress: EmailImportProgress) => this.report(running, progress)

        report({ phase: 'started' })
        try {
            this.stateStore.set('lastStartedAt', this.now())
            const progress$ = await this.feed.triggerEmailImport(running.abortController.signal)
            await lastValueFrom(progress$.pipe(tap(report)), { defaultValue: undefined })
        } catch (error) {
            log.errorEvent('feed.import.run.failed', {
                ...diagnosticErrorSummary(error),
                trigger: running.trigger,
            })
            report({
                phase: 'error',
                errorMessage: error instanceof Error ? error.message : 'Unknown error during email import',
            })
        }
    }
}

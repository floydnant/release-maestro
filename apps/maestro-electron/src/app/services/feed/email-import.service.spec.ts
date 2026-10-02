import { EmailImportProgress, EmailImportProgressUpdate } from '@release-maestro/core'
import { Subject } from 'rxjs'
import { InMemoryStore } from '../../utils/persistent-store.util'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { EMAIL_AUTO_IMPORT_INTERVAL_MS, EmailImportService, EmailImportState } from './email-import.service'
import { FeedBackendService } from './feed.backend.service'

jest.mock('electron', () => ({
    BrowserWindow: { getAllWindows: () => [] },
}))

const NOW = new Date('2026-10-02T12:00:00Z').getTime()

describe('EmailImportService', () => {
    let progress$: Subject<EmailImportProgress>
    let triggerEmailImport: jest.Mock
    let mailboxName: string | null
    let stateStore: InMemoryStore<EmailImportState>
    let updates: EmailImportProgressUpdate[]
    let now: number
    let platform: NodeJS.Platform

    const createService = () =>
        new EmailImportService(
            { triggerEmailImport } as unknown as FeedBackendService,
            { getMailboxName: () => mailboxName } as unknown as EmailBackendRepository,
            stateStore,
            update => updates.push(update),
            () => now,
            platform,
        )

    beforeEach(() => {
        progress$ = new Subject()
        triggerEmailImport = jest.fn(async () => progress$)
        mailboxName = 'Bandcamp'
        stateStore = new InMemoryStore()
        updates = []
        now = NOW
        platform = 'darwin'
    })

    it('runs an auto import when no import has run yet', async () => {
        const service = createService()

        const settled = service.start('auto')
        await Promise.resolve()
        progress$.next({ phase: 'completed', totalProcessed: 2, totalImported: 1, newlyImported: 1 })
        progress$.complete()
        await settled

        expect(updates).toEqual([
            { phase: 'started', trigger: 'auto' },
            { phase: 'completed', totalProcessed: 2, totalImported: 1, newlyImported: 1, trigger: 'auto' },
        ])
        expect(stateStore.get('lastStartedAt')).toBe(NOW)
    })

    it('skips an auto import until the interval has passed since the last import started', async () => {
        stateStore.set('lastStartedAt', NOW - EMAIL_AUTO_IMPORT_INTERVAL_MS + 1)
        const service = createService()

        await service.start('auto')
        expect(triggerEmailImport).not.toHaveBeenCalled()

        now = NOW + 1
        void service.start('auto')
        expect(triggerEmailImport).toHaveBeenCalledTimes(1)
    })

    it('always runs a manual import', async () => {
        stateStore.set('lastStartedAt', NOW)
        mailboxName = null
        const service = createService()

        void service.start('manual')

        expect(triggerEmailImport).toHaveBeenCalledTimes(1)
        expect(updates).toEqual([{ phase: 'started', trigger: 'manual' }])
    })

    it.each([
        ['no mailbox is configured', () => (mailboxName = null)],
        ['Apple Mail is unavailable', () => (platform = 'linux')],
    ])('skips an auto import when %s', async (_reason, arrange) => {
        arrange()

        await createService().start('auto')

        expect(triggerEmailImport).not.toHaveBeenCalled()
        expect(updates).toEqual([])
    })

    it('joins the running import, and a manual request takes over its reporting', async () => {
        const service = createService()

        const auto = service.start('auto')
        await Promise.resolve()
        progress$.next({ phase: 'processing', current: 1, total: 2, message: 'one' })
        const manual = service.start('manual')
        progress$.next({ phase: 'processing', current: 2, total: 2, message: 'two' })
        progress$.complete()
        await Promise.all([auto, manual])

        expect(triggerEmailImport).toHaveBeenCalledTimes(1)
        expect(updates).toEqual([
            { phase: 'started', trigger: 'auto' },
            { phase: 'processing', current: 1, total: 2, message: 'one', trigger: 'auto' },
            // The takeover re-sends the latest update, so the renderer moves it without waiting
            { phase: 'processing', current: 1, total: 2, message: 'one', trigger: 'manual' },
            { phase: 'processing', current: 2, total: 2, message: 'two', trigger: 'manual' },
        ])
    })

    it('restarts the import when a manual request comes after a mailbox switch', async () => {
        const service = createService()

        const auto = service.start('auto')
        await Promise.resolve()
        mailboxName = 'New Releases'
        const manual = service.start('manual')

        const [firstSignal] = triggerEmailImport.mock.calls[0] as [AbortSignal]
        expect(firstSignal.aborted).toBe(true)
        progress$.next({ phase: 'cancelled' })
        // Completed, so the restarted import also completes as soon as it subscribes
        progress$.complete()
        await Promise.all([auto, manual])

        expect(triggerEmailImport).toHaveBeenCalledTimes(2)
        expect(updates).toEqual([
            { phase: 'started', trigger: 'auto' },
            { phase: 'cancelled', trigger: 'auto' },
            { phase: 'started', trigger: 'manual' },
        ])
    })

    it('reports a failure to save the import state as an error', async () => {
        stateStore.set = () => {
            throw new Error('disk full')
        }

        await createService().start('manual')

        expect(triggerEmailImport).not.toHaveBeenCalled()
        expect(updates.at(-1)).toEqual({ phase: 'error', errorMessage: 'disk full', trigger: 'manual' })
    })

    it('runs an auto import when the clock moved back past the last start', () => {
        stateStore.set('lastStartedAt', NOW + EMAIL_AUTO_IMPORT_INTERVAL_MS)

        void createService().start('auto')

        expect(triggerEmailImport).toHaveBeenCalledTimes(1)
    })

    it('starts a new import once the running one has settled', async () => {
        const service = createService()

        const first = service.start('manual')
        await Promise.resolve()
        progress$.complete()
        await first
        void service.start('manual')

        expect(triggerEmailImport).toHaveBeenCalledTimes(2)
    })

    it('aborts the running import on cancel', async () => {
        const service = createService()

        void service.start('manual')
        service.cancel()

        const [signal] = triggerEmailImport.mock.calls[0] as [AbortSignal]
        expect(signal.aborted).toBe(true)
    })

    it('reports an import that fails to start as an error', async () => {
        triggerEmailImport.mockRejectedValue(new Error('database is locked'))

        await createService().start('manual')

        expect(updates.at(-1)).toEqual({
            phase: 'error',
            errorMessage: 'database is locked',
            trigger: 'manual',
        })
    })
})

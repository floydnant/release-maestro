import { lastValueFrom, Subject, toArray } from 'rxjs'
import { Email, EmailImportStreamPacket } from '@release-maestro/core'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { WebScrapingService } from '../web-scraping/web-scraping.service'
import { FeedBackendRepository } from './feed.backend.repository'
import { FeedBackendService } from './feed.backend.service'

const DAY_MS = 24 * 60 * 60 * 1000

const packet = (dateReceived: string, current = 1, total = 1): EmailImportStreamPacket => ({
    current,
    total,
    email: {
        messageId: `<${dateReceived}@example.com>`,
        subject: 'Not a Bandcamp notification',
        dateReceived,
        sender: 'someone@example.com',
        plainBody: '',
        htmlBody: '',
        isRead: false,
        vendor: 'APPLE_MAIL',
    } satisfies Email,
})

describe('FeedBackendService email import', () => {
    let feedRepository: FeedBackendRepository
    let emails$: Subject<EmailImportStreamPacket>
    let loadEmails: jest.Mock
    let mailboxName: string | null
    let service: FeedBackendService

    beforeEach(() => {
        feedRepository = new FeedBackendRepository(createMigratedTestDatabase().client)
        emails$ = new Subject()
        loadEmails = jest.fn(async () => emails$)
        mailboxName = 'Bandcamp'
        const emailRepository = {
            loadEmails,
            getMailboxName: () => mailboxName,
        } as unknown as EmailBackendRepository
        service = new FeedBackendService(
            emailRepository,
            {} as BandcampApiBackendService,
            {} as WebScrapingService,
            feedRepository,
        )
    })

    const runImport = async (abortController = new AbortController()) => {
        const updates = lastValueFrom(
            (await service.triggerEmailImport(abortController.signal)).pipe(toArray()),
        )
        return { updates, abortController }
    }

    it('reads the whole mailbox on the first import and checkpoints the newest email', async () => {
        const { updates } = await runImport()

        expect(loadEmails).toHaveBeenCalledWith('APPLE_MAIL', expect.any(AbortSignal), null)
        emails$.next(packet('2026-09-30T08:15:00', 1, 3))
        emails$.next(packet('2026-10-01T21:40:12', 2, 3))
        emails$.next(packet('2026-09-12T10:00:00', 3, 3))
        emails$.complete()

        await expect(updates).resolves.toContainEqual(
            expect.objectContaining({ phase: 'completed', totalProcessed: 3 }),
        )
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toEqual(
            new Date('2026-10-01T21:40:12'),
        )
    })

    it('only reads mail received since a day before the checkpoint', async () => {
        const checkpoint = new Date('2026-10-01T21:40:12')
        await feedRepository.advanceEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp', checkpoint)

        const { updates } = await runImport()
        emails$.complete()
        await updates

        expect(loadEmails).toHaveBeenCalledWith(
            'APPLE_MAIL',
            expect.any(AbortSignal),
            new Date(checkpoint.getTime() - DAY_MS),
        )
    })

    it('keeps the checkpoint when nothing new arrived', async () => {
        const checkpoint = new Date('2026-10-01T21:40:12')
        await feedRepository.advanceEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp', checkpoint)

        const { updates } = await runImport()
        emails$.next(packet('2026-09-30T23:00:00'))
        emails$.complete()
        await updates

        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toEqual(
            checkpoint,
        )
    })

    it('never checkpoints past the start of the import', async () => {
        const { updates } = await runImport()

        emails$.next(packet('2099-01-01T00:00:00'))
        emails$.complete()
        await updates

        const checkpoint = await feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')
        expect(checkpoint?.getTime()).toBeLessThanOrEqual(Date.now())
    })

    it('does not checkpoint a cancelled import', async () => {
        const { updates, abortController } = await runImport()

        emails$.next(packet('2026-10-01T21:40:12'))
        abortController.abort()
        // The exporter completes, rather than errors, when it is aborted
        emails$.complete()
        await updates

        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
    })

    it('does not checkpoint a failed import', async () => {
        const { updates } = await runImport()

        emails$.next(packet('2026-10-01T21:40:12'))
        emails$.error(new Error('Mail got an error'))

        await expect(updates).resolves.toContainEqual(expect.objectContaining({ phase: 'error' }))
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
    })

    it('does not apply one mailbox checkpoint to another mailbox', async () => {
        await feedRepository.advanceEmailImportCheckpoint(
            'APPLE_MAIL',
            'Bandcamp',
            new Date('2026-10-01T21:40:12'),
        )
        mailboxName = 'Releases'

        const { updates } = await runImport()
        emails$.complete()
        await updates

        expect(loadEmails).toHaveBeenCalledWith('APPLE_MAIL', expect.any(AbortSignal), null)
    })
})

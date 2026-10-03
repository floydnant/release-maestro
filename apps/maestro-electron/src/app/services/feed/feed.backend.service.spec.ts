import { lastValueFrom, Subject, toArray } from 'rxjs'
import { fromPartial } from '@total-typescript/shoehorn'
import { Email, EmailImportStreamPacket } from '@release-maestro/core'
import {
    fansBoughtMusicEmail,
    newReleaseEmail,
    scrapedBandcampAlbum,
} from '../../../../../../fixtures/feed.fixture'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import { BandcampApiFailedToFetchTralbumException } from '../bandcamp/bandcamp-api.exceptions'
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

const releasePacket = (dateReceived: string, releaseUrl: string): EmailImportStreamPacket => ({
    current: 1,
    total: 1,
    email: {
        messageId: `<${releaseUrl}@example.com>`,
        subject: 'New release from Test Artist',
        dateReceived,
        sender: 'Bandcamp <noreply@bandcamp.com>',
        plainBody: '',
        htmlBody: `<a href="${releaseUrl}">check it out here</a>`,
        isRead: false,
        vendor: 'APPLE_MAIL',
    },
})

describe('FeedBackendService email import', () => {
    let feedRepository: FeedBackendRepository
    let emails$: Subject<EmailImportStreamPacket>
    let loadEmails: jest.MockedFunction<EmailBackendRepository['loadEmails']>
    let mailboxName: string | null
    let service: FeedBackendService
    let scrapeTralbumInfo: jest.MockedFunction<BandcampApiBackendService['scrapeTralbumInfo']>
    let getLinkMetaDataBatch: jest.MockedFunction<WebScrapingService['getLinkMetaDataBatch']>

    beforeEach(() => {
        feedRepository = new FeedBackendRepository(createMigratedTestDatabase().client)
        emails$ = new Subject()
        loadEmails = jest.fn<
            ReturnType<EmailBackendRepository['loadEmails']>,
            Parameters<EmailBackendRepository['loadEmails']>
        >(async () => emails$)
        mailboxName = 'Bandcamp'
        const emailRepository = fromPartial<EmailBackendRepository>({
            loadEmails,
            getMailboxName: () => mailboxName,
        })
        scrapeTralbumInfo = jest.fn<
            ReturnType<BandcampApiBackendService['scrapeTralbumInfo']>,
            Parameters<BandcampApiBackendService['scrapeTralbumInfo']>
        >(async url => ({
            ...scrapedBandcampAlbum,
            type: url.includes('/track/') ? 'track' : 'album',
        }))
        getLinkMetaDataBatch = jest.fn<
            ReturnType<WebScrapingService['getLinkMetaDataBatch']>,
            Parameters<WebScrapingService['getLinkMetaDataBatch']>
        >(async () => ({}))
        service = new FeedBackendService(
            emailRepository,
            fromPartial<BandcampApiBackendService>({ scrapeTralbumInfo }),
            fromPartial<WebScrapingService>({ getLinkMetaDataBatch }),
            feedRepository,
        )
    })

    const runImport = async (abortController = new AbortController()) => {
        const updates = lastValueFrom(
            (await service.triggerEmailImport(abortController.signal)).pipe(toArray()),
        )
        return { updates, abortController }
    }

    it('imports and hydrates each distinct album and track from a fan-purchase notification', async () => {
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 1, email: fansBoughtMusicEmail })
        emails$.complete()

        await expect(updates).resolves.toContainEqual({
            phase: 'completed',
            totalProcessed: 1,
            totalImported: 2,
            newlyImported: 2,
        })
        const stored = await feedRepository.listFeedItems(0, 10)
        expect(new Set(stored.map(item => item.id)).size).toBe(2)
        expect(stored.map(item => item.dedupeIdentifier).sort()).toEqual([
            'https://other.bandcamp.com/track/second',
            'https://test.bandcamp.com/album/first',
        ])
        for (const item of stored) {
            expect(item).toMatchObject({
                eventDate: new Date(fansBoughtMusicEmail.dateReceived),
                source: {
                    type: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
                    messageId: fansBoughtMusicEmail.messageId,
                    isRead: true,
                },
                isSnoozed: false,
                lastViewedAt: null,
            })
        }
        const hydrated = await service.loadFeed(0, 10)
        expect(hydrated).toHaveLength(2)
        for (const item of hydrated) {
            expect(item.sourceType).toBe('EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC')
            expect(item.data.emailId).toBe(fansBoughtMusicEmail.messageId)
            expect(item.data.tracks).toEqual(scrapedBandcampAlbum.tracks)
            expect(item.data.iframeUrl).toContain(`/${item.data.releaseType}=123/`)
        }
        expect(hydrated.map(item => item.data.releaseType).sort()).toEqual(['album', 'track'])
        expect(getLinkMetaDataBatch).not.toHaveBeenCalled()
    })

    it('deduplicates fan purchases on reimport and against new-release notifications', async () => {
        jest.useFakeTimers({ now: new Date('2026-10-02T10:00:00Z') })
        try {
            const { updates } = await runImport()
            emails$.next({ current: 1, total: 2, email: newReleaseEmail })
            emails$.next({ current: 2, total: 2, email: fansBoughtMusicEmail })
            emails$.complete()
            await updates
            const firstItems = await feedRepository.listFeedItems(0, 10)
            expect(firstItems).toHaveLength(2)
            expect(firstItems.find(item => item.data.tralbumUrl.includes('/album/'))?.source.type).toBe(
                'EMAIL.BANDCAMP_NEW_RELEASE',
            )

            jest.setSystemTime(new Date('2026-10-02T10:00:01Z'))
            emails$ = new Subject()
            const next = await runImport()
            emails$.next({ current: 1, total: 1, email: fansBoughtMusicEmail })
            emails$.complete()
            await expect(next.updates).resolves.toContainEqual({
                phase: 'completed',
                totalProcessed: 1,
                totalImported: 2,
                newlyImported: 0,
            })
            expect(await feedRepository.listFeedItems(0, 10)).toEqual(firstItems)
        } finally {
            jest.useRealTimers()
        }
    })

    it('retains a failed fan purchase without preventing the other release from hydrating', async () => {
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 1, email: fansBoughtMusicEmail })
        emails$.complete()
        await updates
        scrapeTralbumInfo.mockRejectedValueOnce(
            new BandcampApiFailedToFetchTralbumException('https://test.bandcamp.com/album/first', 404),
        )

        const hydrated = await service.loadFeed(0, 10)
        expect(hydrated).toHaveLength(2)
        expect(hydrated.filter(item => item.error)).toHaveLength(1)
        const failed = hydrated.find(item => item.error)
        expect(failed).toMatchObject({
            sourceType: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            error: { message: 'The Bandcamp track or album could not be found' },
        })
        expect(failed?.data.releaseName).toBe(failed?.data.releaseUrl)
        expect(hydrated.find(item => !item.error)?.data.tracks).toEqual(scrapedBandcampAlbum.tracks)
    })

    it('imports no releases from a fan notification without release links', async () => {
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 1, email: { ...fansBoughtMusicEmail, htmlBody: '' } })
        emails$.complete()
        await expect(updates).resolves.toContainEqual({
            phase: 'completed',
            totalProcessed: 1,
            totalImported: 0,
            newlyImported: 0,
        })
        expect(await feedRepository.listFeedItems(0, 10)).toEqual([])
    })

    it('reads the whole mailbox on the first import and checkpoints the newest email', async () => {
        const { updates } = await runImport()

        expect(loadEmails).toHaveBeenCalledWith('APPLE_MAIL', expect.any(AbortSignal), 'Bandcamp', null)
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
            'Bandcamp',
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

    it('reports and does not checkpoint a cancelled import', async () => {
        const { updates, abortController } = await runImport()

        emails$.next(packet('2026-10-01T21:40:12'))
        abortController.abort()
        // The exporter completes, rather than errors, when it is aborted
        emails$.complete()

        const reported = await updates
        expect(reported.at(-1)).toEqual({ phase: 'cancelled' })
        expect(reported).not.toContainEqual(expect.objectContaining({ phase: 'completed' }))
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
    })

    it('does not checkpoint a failed import', async () => {
        const { updates } = await runImport()

        emails$.next(packet('2026-10-01T21:40:12'))
        emails$.error(new Error('Mail got an error'))

        await expect(updates).resolves.toContainEqual(expect.objectContaining({ phase: 'error' }))
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
    })

    it('completes with saved successes while retaining the checkpoint after skipped emails', async () => {
        const checkpoint = new Date('2026-09-28T21:40:12')
        await feedRepository.advanceEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp', checkpoint)
        const { updates } = await runImport()

        emails$.next({ current: 1, total: 2, email: null })
        emails$.next(releasePacket('2026-10-01T21:40:12', 'https://test.bandcamp.com/album/first'))
        emails$.complete()

        const reported = await updates
        expect(reported.at(-1)).toEqual({
            phase: 'completed',
            totalProcessed: 2,
            totalImported: 1,
            newlyImported: 1,
            skippedEmails: 1,
        })
        expect(reported).not.toContainEqual(expect.objectContaining({ phase: 'error' }))
        expect(await feedRepository.listFeedItems(0, 10)).toHaveLength(1)
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toEqual(
            checkpoint,
        )
    })

    it('retries the uncovered range next time and deduplicates the successes already saved', async () => {
        const first = releasePacket('2026-10-01T21:40:12', 'https://test.bandcamp.com/album/first')
        const recovered = releasePacket('2026-09-29T08:00:00', 'https://test.bandcamp.com/album/recovered')
        const { updates } = await runImport()
        emails$.next(first)
        emails$.next({ current: 2, total: 2, email: null })
        emails$.complete()
        await updates

        emails$ = new Subject()
        const next = await runImport()
        emails$.next(first)
        emails$.next(recovered)
        emails$.complete()

        expect(loadEmails.mock.calls[1]?.[3]).toBeNull()
        await expect(next.updates).resolves.toContainEqual(
            expect.objectContaining({ phase: 'completed', totalProcessed: 2, totalImported: 2 }),
        )
        expect(await feedRepository.listFeedItems(0, 10)).toHaveLength(2)
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toEqual(
            new Date('2026-10-01T21:40:12'),
        )
    })

    it('completes normally and leaves all skipped emails for the next import', async () => {
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 2, email: null })
        emails$.next({ current: 2, total: 2, email: null })
        emails$.complete()

        await expect(updates).resolves.toContainEqual({
            phase: 'completed',
            totalProcessed: 2,
            totalImported: 0,
            newlyImported: 0,
            skippedEmails: 2,
        })
        expect(await feedRepository.listFeedItems(0, 10)).toEqual([])
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

        expect(loadEmails).toHaveBeenCalledWith('APPLE_MAIL', expect.any(AbortSignal), 'Releases', null)
    })
})

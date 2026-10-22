import { lastValueFrom, Subject, tap, toArray } from 'rxjs'
import { fromPartial } from '@total-typescript/shoehorn'
import {
    DEFAULT_FEED_SNOOZE_HOURS,
    Email,
    EmailImportStreamPacket,
    EmailImportProgress,
    FetchFailedException,
} from '@release-maestro/core'
// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared synthetic fixtures live in fixtures/, per docs/testing.md.
import {
    fansBoughtMusicEmail,
    newReleaseEmail,
    scrapedBandcampAlbum,
    adamFan,
    mayaFan,
    riverFan,
    groupedFansBoughtMusicEmail,
    fansBoughtMusicFeedItem,
    scrapedGroupedAlbum,
} from '../../../../../../fixtures/feed.fixture'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import { BandcampHttpClient } from '../bandcamp/bandcamp-http.client'
import {
    BandcampApiFailedToFetchTralbumException,
    BandcampApiMalformedTralbumDataException,
    BandcampApiRateLimitedException,
} from '../bandcamp/bandcamp-api.exceptions'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { SettingsBackendService } from '../settings.backend.service'
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
        service = new FeedBackendService(
            emailRepository,
            fromPartial<BandcampApiBackendService>({ scrapeTralbumInfo }),
            feedRepository,
            fromPartial<SettingsBackendService>({}),
        )
    })

    const runImport = async (abortController = new AbortController()) => {
        const reported: EmailImportProgress[] = []
        const updates = lastValueFrom(
            (await service.triggerEmailImport(abortController.signal)).pipe(
                tap(update => reported.push(update)),
                toArray(),
            ),
        )
        return { updates, abortController, reported }
    }

    it('completes an empty export without reporting queued processing', async () => {
        const { updates } = await runImport()
        emails$.complete()

        expect((await updates).map(update => update.phase)).toEqual(['completed'])
    })

    it('reports processing after export while queued batches are still resolving releases', async () => {
        let finishLookup = () => {}
        scrapeTralbumInfo.mockImplementationOnce(
            () =>
                new Promise(resolve => {
                    finishLookup = () => resolve(scrapedBandcampAlbum)
                }),
        )
        const { updates, reported } = await runImport()
        emails$.next({ current: 1, total: 51, email: fansBoughtMusicEmail })
        for (let current = 2; current <= 51; current++)
            emails$.next(packet('2026-10-01T21:40:12', current, 51))
        emails$.complete()
        try {
            await new Promise<void>(resolve => setImmediate(resolve))
            expect(reported.at(-1)).toEqual({ phase: 'finishing' })
            await expect(
                feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp'),
            ).resolves.toBeNull()
        } finally {
            finishLookup()
            await updates
        }
        expect(reported.at(-1)).toMatchObject({ phase: 'completed', totalProcessed: 51 })
        const afterExport = reported.slice(reported.findIndex(update => update.phase === 'finishing'))
        expect(afterExport.map(update => update.phase)).toEqual(['finishing', 'completed'])
    })

    it('cancels queued processing after export without advancing the checkpoint', async () => {
        let lookupStarted = () => {}
        const started = new Promise<void>(resolve => (lookupStarted = resolve))
        scrapeTralbumInfo.mockImplementationOnce(
            (_url, signal) =>
                new Promise((_resolve, reject) => {
                    signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
                    lookupStarted()
                }),
        )
        const { updates, reported, abortController } = await runImport()
        emails$.next({ current: 1, total: 1, email: fansBoughtMusicEmail })
        emails$.complete()
        await started
        try {
            expect(reported.at(-1)).toEqual({ phase: 'finishing' })
        } finally {
            abortController.abort()
            await updates
        }
        expect(reported.at(-1)).toEqual({ phase: 'cancelled' })
        expect(
            reported.filter(update => ['completed', 'cancelled', 'error'].includes(update.phase)),
        ).toHaveLength(1)
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
        expect(await service.hasFeed()).toBe(false)
    })

    it('limits parent lookups while importing an email with many purchased tracks', async () => {
        let active = 0
        let peak = 0
        scrapeTralbumInfo.mockImplementation(async () => {
            active++
            peak = Math.max(peak, active)
            await new Promise<void>(resolve => setImmediate(resolve))
            active--
            return {
                ...scrapedBandcampAlbum,
                type: 'track',
                parentAlbumUrl: 'https://test.bandcamp.com/album/first',
            }
        })
        const { updates } = await runImport()
        emails$.next({
            current: 1,
            total: 1,
            email: {
                ...fansBoughtMusicEmail,
                htmlBody: Array.from(
                    { length: 12 },
                    (_, index) => `<a href="https://test.bandcamp.com/track/purchase-${index}">Track</a>`,
                ).join(''),
            },
        })
        emails$.complete()

        await expect(updates).resolves.toContainEqual(expect.objectContaining({ phase: 'completed' }))
        expect(peak).toBe(4)
        expect(scrapeTralbumInfo).toHaveBeenCalledTimes(12)
    })

    it('retries a temporary network lookup failure before completing the import', async () => {
        scrapeTralbumInfo.mockRejectedValueOnce(
            new FetchFailedException(
                'Failed to fetch tralbum',
                'https://other.bandcamp.com/track/second',
                new Error('Temporary DNS failure'),
                'Retry',
            ),
        )
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 1, email: fansBoughtMusicEmail })
        emails$.complete()

        await expect(updates).resolves.toContainEqual(expect.objectContaining({ phase: 'completed' }))
        expect(scrapeTralbumInfo).toHaveBeenCalledTimes(2)
        await expect(
            feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp'),
        ).resolves.not.toBeNull()
    })

    it('stops the exporter when a processing failure makes the remaining export unusable', async () => {
        loadEmails.mockImplementation(async (_vendor, signal) => {
            signal.addEventListener('abort', () => emails$.complete(), { once: true })
            return emails$
        })
        scrapeTralbumInfo.mockRejectedValue(new Error('Lookup failed'))
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 100, email: fansBoughtMusicEmail })
        for (let current = 2; current <= 50; current++)
            emails$.next(packet('2026-10-01T21:40:12', current, 100))

        await expect(updates).resolves.toContainEqual({ phase: 'error', errorMessage: 'Lookup failed' })
        expect(loadEmails.mock.calls[0]?.[1].aborted).toBe(true)
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
    })

    it('keeps the checkpoint and reports a rate limit without retrying beyond the HTTP client budget', async () => {
        scrapeTralbumInfo.mockRejectedValue(
            new BandcampApiRateLimitedException(
                'https://other.bandcamp.com/track/second',
                new Date(Date.now() + 120_000),
            ),
        )
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 1, email: fansBoughtMusicEmail })
        emails$.complete()

        await expect(updates).resolves.toContainEqual({
            phase: 'error',
            errorMessage: 'Bandcamp is limiting requests. Please try again later.',
        })
        expect(scrapeTralbumInfo).toHaveBeenCalledTimes(1)
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
    })

    it('groups bought tracks under their album and attributes each track to its fans', async () => {
        scrapeTralbumInfo.mockImplementation(async url => ({
            ...scrapedGroupedAlbum,
            type: url.includes('/track/') ? 'track' : 'album',
            parentAlbumUrl: url.includes('/track/') ? 'https://test.bandcamp.com/album/first' : null,
        }))
        const { updates } = await runImport()
        emails$.next({
            current: 1,
            total: 1,
            email: {
                ...groupedFansBoughtMusicEmail,
                htmlBody: groupedFansBoughtMusicEmail.htmlBody.replaceAll(
                    'https://test.bandcamp.com',
                    'http://test.bandcamp.com',
                ),
            },
        })
        emails$.complete()

        await expect(updates).resolves.toContainEqual({
            phase: 'completed',
            totalProcessed: 1,
            totalImported: 1,
            newlyImported: 1,
        })
        const hydrated = await service.loadFeed(0, 10)
        expect(hydrated).toHaveLength(1)
        expect(hydrated[0]?.data).toMatchObject({
            releaseUrl: 'https://test.bandcamp.com/album/first',
            releaseType: 'album',
            fans: [adamFan, mayaFan, riverFan],
        })
        expect(hydrated[0]?.data.tracks.map(track => track.fans)).toEqual([
            [adamFan, mayaFan, riverFan],
            [adamFan, mayaFan],
        ])
    })

    it('leaves an offline album lookup uncovered so the next import can retry it', async () => {
        scrapeTralbumInfo.mockRejectedValueOnce(new Error('Offline'))
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 1, email: groupedFansBoughtMusicEmail })
        emails$.complete()

        const reported = await updates
        expect(reported.map(update => update.phase)).toEqual(['processing', 'finishing', 'error'])
        expect(reported.at(-1)).toEqual({ phase: 'error', errorMessage: 'Offline' })
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
        expect(await service.hasFeed()).toBe(false)
    })

    it('reports a lookup error after the exporter drains its remaining progress', async () => {
        scrapeTralbumInfo.mockRejectedValue(new Error('Offline'))
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 51, email: groupedFansBoughtMusicEmail })
        for (let current = 2; current <= 50; current++) {
            emails$.next(packet('2026-10-01T21:40:12', current, 51))
        }
        // The first batch fails while Apple Mail is still exporting the rest.
        await new Promise<void>(resolve => setImmediate(resolve))
        emails$.next(packet('2026-10-01T21:40:12', 51, 51))
        emails$.complete()

        const reported = await updates
        expect(reported.at(-1)).toEqual({ phase: 'error', errorMessage: 'Offline' })
        expect(reported.filter(update => update.phase === 'error')).toHaveLength(1)
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
    })

    it.each([
        new BandcampApiFailedToFetchTralbumException('https://other.bandcamp.com/track/second', 404),
        new BandcampApiMalformedTralbumDataException(
            'https://other.bandcamp.com/track/second',
            new Error('No tralbum data'),
        ),
    ])('keeps a bought track and its fans when its parent cannot be read: %s', async error => {
        scrapeTralbumInfo.mockRejectedValue(error)
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 1, email: fansBoughtMusicEmail })
        emails$.complete()

        await expect(updates).resolves.toContainEqual(expect.objectContaining({ phase: 'completed' }))
        const hydrated = await service.loadFeed(0, 10)
        expect(hydrated.find(item => item.data.releaseType === 'track')?.data).toMatchObject({
            releaseUrl: 'https://other.bandcamp.com/track/second',
            fans: [mayaFan, riverFan],
        })
    })

    it('cancels a pending parent lookup without advancing the checkpoint', async () => {
        const abortController = new AbortController()
        scrapeTralbumInfo.mockImplementation((_url, signal) => {
            expect(signal).toBe(loadEmails.mock.calls[0]?.[1])
            return new Promise((_resolve, reject) => {
                signal?.addEventListener('abort', () => reject(new Error('Aborted')), { once: true })
                abortController.abort()
            })
        })
        const { updates } = await runImport(abortController)
        emails$.next({ current: 1, total: 1, email: fansBoughtMusicEmail })
        emails$.complete()

        await expect(updates).resolves.toContainEqual({ phase: 'cancelled' })
        await expect(feedRepository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toBeNull()
        expect(await service.hasFeed()).toBe(false)
    })

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
            expect(item.data.tracks).toEqual(
                scrapedBandcampAlbum.tracks.map(track => ({ ...track, fans: item.data.fans })),
            )
            expect(item.data.iframeUrl).toContain(`/${item.data.releaseType}=123/`)
        }
        expect(hydrated.map(item => item.data.releaseType).sort()).toEqual(['album', 'track'])
        expect(hydrated.find(item => item.data.releaseType === 'album')?.data.fans).toEqual([adamFan])
        expect(hydrated.find(item => item.data.releaseType === 'track')?.data.fans).toEqual([
            mayaFan,
            riverFan,
        ])
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

    it.each([
        [
            new BandcampApiFailedToFetchTralbumException('https://test.bandcamp.com/album/first', 404),
            'The Bandcamp track or album could not be found',
        ],
        [
            new BandcampApiRateLimitedException(
                'https://test.bandcamp.com/album/first',
                new Date(Date.now() + 120_000),
            ),
            'Bandcamp is limiting requests. Please try again later.',
        ],
    ])('retains a failed fan purchase while other releases hydrate: %s', async (error, message) => {
        const { updates } = await runImport()
        emails$.next({ current: 1, total: 1, email: fansBoughtMusicEmail })
        emails$.complete()
        await updates
        scrapeTralbumInfo.mockRejectedValueOnce(error)

        const hydrated = await service.loadFeed(0, 10)
        expect(hydrated).toHaveLength(2)
        expect(hydrated.filter(item => item.error)).toHaveLength(1)
        const failed = hydrated.find(item => item.error)
        expect(failed).toMatchObject({
            sourceType: 'EMAIL.BANDCAMP_FANS_BOUGHT_MUSIC',
            error: { message },
        })
        expect(failed?.data.releaseName).toBe(failed?.data.releaseUrl)
        expect(failed?.data.fans.length).toBeGreaterThan(0)
        expect(hydrated.find(item => !item.error)?.data.tracks).toMatchObject(scrapedBandcampAlbum.tracks)
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

    it('hydrates a cold feed page concurrently without waiting for link previews', async () => {
        jest.useFakeTimers()
        const html = `<title>Preview</title><div data-tralbum='${JSON.stringify({
            current: { title: 'Album', type: 'album', id: 1 },
            trackinfo: [],
        })}'></div>`
        const fetchMock = jest
            .spyOn(globalThis, 'fetch')
            .mockImplementation(
                () => new Promise(resolve => setTimeout(() => resolve(new Response(html)), 100)),
            )
        try {
            const http = new BandcampHttpClient()
            const realService = new FeedBackendService(
                fromPartial<EmailBackendRepository>({}),
                new BandcampApiBackendService(http),
                feedRepository,
                fromPartial<SettingsBackendService>({ getSettings: () => ({}) }),
            )
            const items = Array.from({ length: 5 }, (_, index) => {
                const url = `https://artist-${index}.bandcamp.com/album/release`
                return {
                    ...fansBoughtMusicFeedItem,
                    id: `release-${index}`,
                    data: { ...fansBoughtMusicFeedItem.data, tralbumUrl: url },
                    source: {
                        ...newReleaseEmail,
                        type: 'EMAIL.BANDCAMP_NEW_RELEASE' as const,
                        releaseUrl: url,
                        releaseType: 'album' as const,
                        links: Array.from(
                            { length: 6 },
                            (_, link) => `https://artist-${index}.bandcamp.com/link-${link}`,
                        ),
                    },
                }
            })
            const hydrated = realService.hydrateFeed(items, false)
            const finished = jest.fn()
            void hydrated.then(finished)
            await jest.advanceTimersByTimeAsync(100)
            expect(finished).toHaveBeenCalledTimes(1)
            await expect(hydrated).resolves.toHaveLength(5)
            for (const item of await hydrated) {
                expect(item.data.links.every(link => link.title === link.url)).toBe(true)
            }
            expect(fetchMock).toHaveBeenCalledTimes(5)
            expect(fetchMock.mock.calls.filter(([url]) => String(url).includes('/album/'))).toHaveLength(5)
        } finally {
            jest.useRealTimers()
            jest.restoreAllMocks()
        }
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
        expect(reported).not.toContainEqual({ phase: 'finishing' })
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
        expect(
            await feedRepository.listFeedItems({
                index: 0,
                count: 10,
                snoozeHours: DEFAULT_FEED_SNOOZE_HOURS,
            }),
        ).toHaveLength(1)
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
        expect(
            await feedRepository.listFeedItems({
                index: 0,
                count: 10,
                snoozeHours: DEFAULT_FEED_SNOOZE_HOURS,
            }),
        ).toHaveLength(2)
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
        expect(
            await feedRepository.listFeedItems({
                index: 0,
                count: 10,
                snoozeHours: DEFAULT_FEED_SNOOZE_HOURS,
            }),
        ).toEqual([])
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

import { AppSettings } from '@release-maestro/core'
import { fromPartial } from '@total-typescript/shoehorn'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { bandcampFeedItem, scrapedRelease } from '../../../test/fixtures/feed.fixture'
import { InMemoryStore } from '../../utils/persistent-store.util'
import { BandcampApiBackendService } from '../bandcamp/bandcamp-api.backend.service'
import { BandcampApiFailedToFetchTralbumException } from '../bandcamp/bandcamp-api.exceptions'
import { EmailBackendRepository } from '../email/email.backend.repository'
import { SettingsBackendService } from '../settings.backend.service'
import { WebScrapingService } from '../web-scraping/web-scraping.service'
import { FeedBackendRepository } from './feed.backend.repository'
import { FeedBackendService } from './feed.backend.service'

describe('feed hydration playable-track filter', () => {
    let database: ReturnType<typeof createMigratedTestDatabase>
    let repository: FeedBackendRepository
    let settings: SettingsBackendService
    let service: FeedBackendService
    const scrape = jest.fn<
        ReturnType<BandcampApiBackendService['scrapeTralbumInfo']>,
        Parameters<BandcampApiBackendService['scrapeTralbumInfo']>
    >()

    beforeEach(() => {
        database = createMigratedTestDatabase()
        repository = new FeedBackendRepository(database.client)
        settings = new SettingsBackendService(new InMemoryStore<AppSettings>())
        scrape.mockReset().mockResolvedValue(scrapedRelease([]))
        service = new FeedBackendService(
            fromPartial<EmailBackendRepository>({}),
            fromPartial<BandcampApiBackendService>({ scrapeTralbumInfo: scrape }),
            fromPartial<WebScrapingService>({ getLinkMetaDataBatch: jest.fn().mockResolvedValue({}) }),
            repository,
            settings,
        )
    })

    afterEach(() => {
        database.sqlite.close()
        jest.restoreAllMocks()
    })

    const seed = async (...ids: string[]) => {
        const items = ids.map((id, index) =>
            bandcampFeedItem(id, new Date(Date.UTC(2026, 9, 1, 0, 0, -index))),
        )
        await repository.ingestFeedItems(items)
        return items
    }

    it.each([{ urls: [] }, { urls: [null] }, { urls: ['', null] }])(
        'hides releases without stream URLs by default: %j',
        async ({ urls }) => {
            const items = await seed('hidden')
            scrape.mockResolvedValue(scrapedRelease(urls))
            await expect(service.hydrateFeed(items)).resolves.toEqual([])
            expect((await repository.listFeedItems(0, 1))[0]?.lastViewedAt).toBeNull()
        },
    )

    it('keeps a release with one playable track among unavailable tracks', async () => {
        await seed('mixed')
        scrape.mockResolvedValue(scrapedRelease([null, 'https://audio.example/preview.mp3', null]))
        expect((await service.loadFeed(0, 5)).map(item => item.id)).toEqual(['mixed'])
    })

    it('fills pages past hidden batches and does not skip releases after a view', async () => {
        await seed('hidden-1', 'hidden-2', 'first', 'hidden-3', 'second', 'third')
        scrape.mockImplementation(async url =>
            scrapedRelease(url.includes('hidden') ? [null] : ['https://audio.example/preview.mp3']),
        )
        const firstPage = await service.loadFeed(0, 2)
        expect(firstPage.map(item => item.id)).toEqual(['first', 'second'])
        await service.markFeedItemAsViewed('first', 'BANDCAMP.TRALBUM', false)
        const nextPage = await service.loadFeed(
            0,
            2,
            firstPage.map(item => item.id),
        )
        expect(nextPage.map(item => item.id)).toEqual(['third'])
    })

    it('returns an empty page when every candidate is hidden, without recording views', async () => {
        await seed('one', 'two', 'three')
        await expect(service.loadFeed(0, 2)).resolves.toEqual([])
        expect(await repository.listFeedItems(0, 5)).toHaveLength(3)
        expect(database.db.query.feedItemHistoryEntriesTable.findMany().sync()).toEqual([])
    })

    it('does not duplicate releases when an import inserts a newer item during hydration', async () => {
        await seed('first', 'hidden', 'second')
        let imported = false
        scrape.mockImplementation(async url => {
            if (!imported) {
                imported = true
                await repository.ingestFeedItems([
                    bandcampFeedItem('new', new Date('2026-10-02T00:00:00Z')),
                    bandcampFeedItem('newer', new Date('2026-10-03T00:00:00Z')),
                ])
            }
            return scrapedRelease(url.includes('hidden') ? [] : ['https://audio.example/preview.mp3'])
        })
        const page = await service.loadFeed(0, 2)
        expect(page.map(item => item.id)).toEqual(['first', 'newer'])
        expect(
            (
                await service.loadFeed(
                    0,
                    2,
                    page.map(item => item.id),
                )
            ).map(item => item.id),
        ).toEqual(['new', 'second'])
    })

    it('rehydrates hidden releases so they can return when a track becomes playable', async () => {
        await seed('preorder')
        await expect(service.loadFeed(0, 5)).resolves.toEqual([])
        scrape.mockResolvedValue(scrapedRelease(['https://audio.example/preview.mp3']))
        await expect(service.loadFeed(0, 5)).resolves.toEqual([])
        expect(scrape).toHaveBeenCalledTimes(1)
        jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 5 * 60 * 1000)
        expect((await service.loadFeed(0, 5)).map(item => item.id)).toEqual(['preorder'])
    })

    it('bounds remembered unplayable releases and rechecks evicted entries', async () => {
        const items = Array.from({ length: 1001 }, (_, index) => bandcampFeedItem(String(index), new Date()))
        await expect(service.hydrateFeed(items)).resolves.toEqual([])
        await expect(service.hydrateFeed(items.slice(0, 1))).resolves.toEqual([])
        expect(scrape).toHaveBeenCalledTimes(1002)
    })

    it('reads the setting on each request and includes unplayable releases when disabled', async () => {
        await seed('preorder')
        await expect(service.loadFeed(0, 5)).resolves.toEqual([])
        settings.patchSettings({ feed: { hideUnplayableReleases: false } })
        expect((await service.loadFeed(0, 5)).map(item => item.id)).toEqual(['preorder'])
    })

    it('keeps hydration errors visible when release playability is unknown', async () => {
        await seed('unreachable')
        scrape.mockRejectedValue(
            new BandcampApiFailedToFetchTralbumException('https://test.bandcamp.com', 404),
        )
        expect((await service.loadFeed(0, 5))[0]?.error).not.toBeNull()
        settings.patchSettings({ feed: { hideUnplayableReleases: false } })
        const items = await service.loadFeed(0, 5)
        expect(items[0]?.error).not.toBeNull()
        expect((await repository.listFeedItems(0, 1))[0]?.lastViewedAt).toBeNull()
    })
})

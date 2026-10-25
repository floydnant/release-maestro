import { BandcampFeedItem, DEFAULT_FEED_SNOOZE_HOURS } from '@release-maestro/core'
// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared synthetic fixtures live in fixtures/, per docs/testing.md.
import {
    adamFan,
    mayaFan,
    riverFan,
    fansBoughtMusicFeedItem,
    newReleaseEmail,
} from '../../../../../../fixtures/feed.fixture'
import { feedItemHistoryEntriesTable, feedItemsTable } from '../../database/drizzle.schema'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { bandcampFeedItem } from '../../../test/fixtures/feed.fixture'
import { FeedBackendRepository } from './feed.backend.repository'

describe('FeedBackendRepository album purchases', () => {
    it.each(['announcement first', 'purchase first'])(
        'keeps one album with its fans across release and purchase notifications: %s',
        async order => {
            const database = createMigratedTestDatabase()
            try {
                const repository = new FeedBackendRepository(database.client)
                const purchase = fansBoughtMusicFeedItem
                const announcement: BandcampFeedItem = {
                    ...purchase,
                    id: 'album-announcement',
                    source: {
                        ...newReleaseEmail,
                        type: 'EMAIL.BANDCAMP_NEW_RELEASE',
                        releaseUrl: purchase.data.tralbumUrl,
                        releaseType: 'album',
                        links: [],
                    },
                    data: { ...purchase.data, purchases: [] },
                }
                const items =
                    order === 'announcement first' ? [announcement, purchase] : [purchase, announcement]
                for (const item of items) await repository.ingestFeedItems([item])
                const stored = await repository.listFeedItems({
                    index: 0,
                    count: 5,
                    snoozeHours: DEFAULT_FEED_SNOOZE_HOURS,
                })
                expect(stored).toHaveLength(1)
                expect(stored[0]).toMatchObject({
                    id: items[0]?.id,
                    data: { purchases: purchase.data.purchases },
                })
            } finally {
                database.sqlite.close()
            }
        },
    )

    it.each(['/', '#artwork'])(
        'retains a viewed announcement when its stored URL ends in %s',
        async suffix => {
            const database = createMigratedTestDatabase()
            try {
                const repository = new FeedBackendRepository(database.client)
                const url = 'https://test.bandcamp.com/album/release'
                const legacy = bandcampFeedItem('legacy', new Date())
                legacy.dedupeIdentifier = url + suffix
                legacy.data.tralbumUrl = url + suffix
                await repository.ingestFeedItems([legacy])
                await repository.markFeedItemViewed('legacy', 'BANDCAMP.TRALBUM', false)
                await repository.ingestFeedItems([
                    {
                        ...legacy,
                        id: 'reimport',
                        dedupeIdentifier: url,
                        data: { ...legacy.data, tralbumUrl: url },
                    },
                ])

                const stored = database.db.select().from(feedItemsTable).all()
                expect(stored).toHaveLength(1)
                expect(stored[0]).toMatchObject({ id: 'legacy', dedupeIdentifier: url })
                expect(stored[0]?.lastViewedAt).not.toBeNull()
                expect(database.db.select().from(feedItemHistoryEntriesTable).all()).toEqual([
                    expect.objectContaining({ feedItemId: 'legacy' }),
                ])
            } finally {
                database.sqlite.close()
            }
        },
    )

    it('merges fans across notifications and reimports using their profile identity', async () => {
        const database = createMigratedTestDatabase()
        try {
            const repository = new FeedBackendRepository(database.client)
            await repository.ingestFeedItems([fansBoughtMusicFeedItem])
            const later: BandcampFeedItem = {
                ...fansBoughtMusicFeedItem,
                id: 'later-notification',
                data: {
                    ...fansBoughtMusicFeedItem.data,
                    purchases: [
                        {
                            tralbumUrl: fansBoughtMusicFeedItem.data.tralbumUrl,
                            fans: [{ ...adamFan, imageUrl: null }, mayaFan],
                        },
                        { tralbumUrl: 'https://test.bandcamp.com/track/first-track', fans: [riverFan] },
                    ],
                },
            }
            await repository.ingestFeedItems([later, later])

            const items = await repository.listFeedItems({
                index: 0,
                count: 5,
                snoozeHours: DEFAULT_FEED_SNOOZE_HOURS,
            })
            expect(items).toHaveLength(1)
            expect(items[0]?.id).toBe(fansBoughtMusicFeedItem.id)
            expect(items[0]?.data.purchases).toEqual([
                { tralbumUrl: fansBoughtMusicFeedItem.data.tralbumUrl, fans: [adamFan, mayaFan] },
                { tralbumUrl: 'https://test.bandcamp.com/track/first-track', fans: [riverFan] },
            ])
        } finally {
            database.sqlite.close()
        }
    })

    it('collapses existing track entries into their album without discarding view history', async () => {
        const database = createMigratedTestDatabase()
        try {
            const repository = new FeedBackendRepository(database.client)
            const albumUrl = fansBoughtMusicFeedItem.data.tralbumUrl
            const trackUrls = [
                'https://test.bandcamp.com/track/z-earlier',
                'https://test.bandcamp.com/track/a-later',
            ]
            const tracks: BandcampFeedItem[] = trackUrls.map((url, index) => ({
                ...bandcampFeedItem(`track-${index}`, new Date(Date.UTC(2026, 9, 1))),
                dedupeIdentifier: url.replace('https:', 'http:'),
                source: {
                    ...newReleaseEmail,
                    type: 'EMAIL.BANDCAMP_NEW_RELEASE',
                    releaseUrl: url,
                    releaseType: 'track',
                    links: [],
                },
                data: {
                    tralbumUrl: url,
                    tralbumType: 'track',
                    purchases: [{ tralbumUrl: url, fans: [mayaFan] }],
                },
            }))
            await repository.ingestFeedItems(tracks)
            await repository.markFeedItemViewed('track-0', 'BANDCAMP.TRALBUM', true)
            await repository.markFeedItemViewed('track-1', 'BANDCAMP.TRALBUM', false)
            const viewedAt = database.db.select().from(feedItemsTable).all()[0]?.lastViewedAt
            await repository.ingestFeedItems([
                {
                    ...fansBoughtMusicFeedItem,
                    data: {
                        ...fansBoughtMusicFeedItem.data,
                        purchases: trackUrls.map(tralbumUrl => ({ tralbumUrl, fans: [riverFan] })),
                    },
                },
            ])

            const stored = database.db.select().from(feedItemsTable).all()
            expect(stored).toHaveLength(1)
            expect(stored[0]).toMatchObject({
                id: 'track-0',
                dedupeIdentifier: albumUrl,
                isSnoozed: true,
                lastViewedAt: viewedAt,
            })
            const history = database.db.select().from(feedItemHistoryEntriesTable).all()
            expect(history).toHaveLength(2)
            expect(history.every(entry => entry.feedItemId === 'track-0')).toBe(true)

            // An open window still holds track-1. Its exclusion and snooze follow the retained ID.
            expect(await repository.getFeedItems(['track-1'])).toMatchObject([
                { id: 'track-1', data: { tralbumUrl: albumUrl } },
            ])
            expect(
                await repository.listFeedItems({
                    index: 0,
                    count: 5,
                    excludedIds: ['track-1'],
                    snoozeHours: 0,
                }),
            ).toEqual([])
            await repository.markFeedItemViewed('track-1', 'BANDCAMP.TRALBUM', false)
            expect(database.db.select().from(feedItemsTable).all()[0]?.isSnoozed).toBe(false)
        } finally {
            database.sqlite.close()
        }
    })
})

describe('FeedBackendRepository email import checkpoint', () => {
    it('never moves a checkpoint backwards', async () => {
        const repository = new FeedBackendRepository(createMigratedTestDatabase().client)
        const newest = new Date('2026-10-01T21:40:12')

        await repository.advanceEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp', newest)
        await repository.advanceEmailImportCheckpoint(
            'APPLE_MAIL',
            'Bandcamp',
            new Date('2026-09-01T00:00:00'),
        )

        await expect(repository.getEmailImportCheckpoint('APPLE_MAIL', 'Bandcamp')).resolves.toEqual(newest)
    })
})

describe('FeedBackendRepository exclusions', () => {
    it('supports exclusion lists beyond SQLite statement-variable limits', async () => {
        const database = createMigratedTestDatabase()
        try {
            const repository = new FeedBackendRepository(database.client)
            await repository.ingestFeedItems([
                bandcampFeedItem('excluded', new Date('2026-10-02')),
                bandcampFeedItem('remaining', new Date('2026-10-01')),
            ])
            const excludedIds = Array.from({ length: 40000 }, (_, index) => `excluded-${index}`)
            excludedIds.push('excluded')
            expect(
                (
                    await repository.listFeedItems({
                        index: 0,
                        count: 5,
                        excludedIds,
                        snoozeHours: DEFAULT_FEED_SNOOZE_HOURS,
                    })
                ).map(item => item.id),
            ).toEqual(['remaining'])
        } finally {
            database.sqlite.close()
        }
    })
})

describe('FeedBackendRepository snooze', () => {
    afterEach(() => jest.restoreAllMocks())

    it('returns a snoozed release once the configured hours have passed since its last view', async () => {
        const database = createMigratedTestDatabase()
        try {
            const repository = new FeedBackendRepository(database.client)
            await repository.ingestFeedItems([
                bandcampFeedItem('snoozed', new Date('2026-10-02')),
                bandcampFeedItem('viewed', new Date('2026-10-01')),
            ])
            await repository.markFeedItemViewed('snoozed', 'BANDCAMP.TRALBUM', true)
            await repository.markFeedItemViewed('viewed', 'BANDCAMP.TRALBUM', false)
            const viewedAt = Date.now()
            const idsAfterHours = async (hours: number) => {
                jest.spyOn(Date, 'now').mockReturnValue(viewedAt + hours * 60 * 60 * 1000)
                return (await repository.listFeedItems({ index: 0, count: 5, snoozeHours: 2 })).map(
                    item => item.id,
                )
            }

            expect(await idsAfterHours(1.9)).toEqual([])
            expect(await idsAfterHours(2.1)).toEqual(['snoozed'])
        } finally {
            database.sqlite.close()
        }
    })
})

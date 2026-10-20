import { DEFAULT_FEED_SNOOZE_HOURS } from '@release-maestro/core'
import { createMigratedTestDatabase } from '../../../test/fixtures/database.fixture'
import { bandcampFeedItem } from '../../../test/fixtures/feed.fixture'
import { FeedBackendRepository } from './feed.backend.repository'

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

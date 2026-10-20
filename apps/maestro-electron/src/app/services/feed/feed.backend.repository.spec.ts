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
            expect((await repository.listFeedItems(0, 5, excludedIds)).map(item => item.id)).toEqual([
                'remaining',
            ])
        } finally {
            database.sqlite.close()
        }
    })
})

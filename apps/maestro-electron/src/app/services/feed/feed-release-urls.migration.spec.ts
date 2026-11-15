import { FeedItemWithPurchases } from '@release-maestro/core'
import { feedItemsTable } from '../../database/drizzle.schema'
import { createTestDatabaseMigratedThrough } from '../../../test/fixtures/database.fixture'
import { bandcampFeedItem } from '../../../test/fixtures/feed.fixture'
import { FeedBackendRepository } from './feed.backend.repository'

const LAST_MIGRATION_BEFORE_RELEASE_URLS = '0009_mae-9-email-import-checkpoints'

/** An announcement whose dedupe identifier, release URL and source URL are all `url`. */
const announcementOf = (id: string, url: string): FeedItemWithPurchases => {
    const item = bandcampFeedItem(id, new Date('2026-09-01T10:00:00Z'))
    if (item.source.type !== 'EMAIL.BANDCAMP_NEW_RELEASE') throw new Error('Expected an announcement')
    return {
        ...item,
        dedupeIdentifier: url,
        data: { tralbumUrl: url, tralbumType: 'album' },
        source: { ...item.source, releaseUrl: url },
    }
}

/** A feed item row as earlier versions stored it: purchases were not stored at all. */
const legacyRow = ({ purchases: _purchases, ...item }: FeedItemWithPurchases) => item

describe('feed release URLs migration', () => {
    it.each([
        'http://test.bandcamp.com/album/old',
        'https://test.bandcamp.com/album/old/',
        'https://test.bandcamp.com/album/old?from=email',
        'https://test.bandcamp.com/album/old#artwork',
    ])('lets a reimport find an announcement an earlier parser saved as %s', async legacyUrl => {
        const database = createTestDatabaseMigratedThrough(LAST_MIGRATION_BEFORE_RELEASE_URLS)
        try {
            database.db
                .insert(feedItemsTable)
                .values(legacyRow(announcementOf('legacy', legacyUrl)))
                .run()

            database.migrateToLatest()
            await new FeedBackendRepository(database.client).ingestFeedItems([
                announcementOf('reimport', 'https://test.bandcamp.com/album/old'),
            ])

            expect(database.db.select({ id: feedItemsTable.id }).from(feedItemsTable).all()).toEqual([
                { id: 'legacy' },
            ])
        } finally {
            database.sqlite.close()
        }
    })
})

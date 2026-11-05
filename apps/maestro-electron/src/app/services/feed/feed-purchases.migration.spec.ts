import { eq } from 'drizzle-orm'
import { FeedItemWithPurchases } from '@release-maestro/core'
// eslint-disable-next-line @nx/enforce-module-boundaries -- Shared synthetic fixtures live in fixtures/, per docs/testing.md.
import { adamFan, mayaFan } from '../../../../../../fixtures/feed.fixture'
import {
    feedFansTable,
    feedItemHistoryEntriesTable,
    feedItemsTable,
    feedReleaseUrlsTable,
} from '../../database/drizzle.schema'
import { createTestDatabaseMigratedThrough } from '../../../test/fixtures/database.fixture'
import { bandcampFeedItem } from '../../../test/fixtures/feed.fixture'
import { FeedBackendRepository } from './feed.backend.repository'

const LAST_MIGRATION_WITH_JSON_PURCHASES = '0009_mae-9-email-import-checkpoints'
const albumUrl = 'https://test.bandcamp.com/album/first'
const trackUrl = 'https://test.bandcamp.com/track/first-track'

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

/** A feed item row as earlier versions stored it, with purchases inside `data`. */
const legacyRow = ({ purchases: _purchases, ...item }: FeedItemWithPurchases, purchases: unknown[] = []) => ({
    ...item,
    data: { ...item.data, purchases },
})

describe('feed fan purchases migration', () => {
    it.each([
        'http://test.bandcamp.com/album/old',
        'https://test.bandcamp.com/album/old/',
        'https://test.bandcamp.com/album/old?from=email',
        'https://test.bandcamp.com/album/old#artwork',
    ])('lets a reimport find an announcement an earlier parser saved as %s', async legacyUrl => {
        const database = createTestDatabaseMigratedThrough(LAST_MIGRATION_WITH_JSON_PURCHASES)
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

    it('folds items that share a URL into the oldest, which then shows the album', async () => {
        const database = createTestDatabaseMigratedThrough(LAST_MIGRATION_WITH_JSON_PURCHASES)
        try {
            const track = announcementOf('track', 'http://test.bandcamp.com/track/first-track')
            database.db
                .insert(feedItemsTable)
                .values([
                    legacyRow({
                        ...track,
                        data: { tralbumUrl: track.dedupeIdentifier, tralbumType: 'track' },
                    }),
                    legacyRow(
                        {
                            ...announcementOf('album', albumUrl),
                            ingestedAt: new Date('2026-10-02T10:00:00Z'),
                        },
                        [{ tralbumUrl: trackUrl, fans: [mayaFan] }],
                    ),
                    legacyRow(bandcampFeedItem('unrelated', new Date('2026-10-03T10:00:00Z'))),
                ])
                .run()
            database.db
                .insert(feedItemHistoryEntriesTable)
                .values({ id: 'album-view', ts: new Date('2026-10-04T10:00:00Z'), feedItemId: 'album' })
                .run()

            database.migrateToLatest()

            expect(database.db.select({ id: feedItemsTable.id }).from(feedItemsTable).all()).toEqual([
                { id: 'track' },
                { id: 'unrelated' },
            ])
            const [kept] = await new FeedBackendRepository(database.client).getFeedItems(['track'])
            expect(kept).toMatchObject({
                dedupeIdentifier: albumUrl,
                data: { tralbumUrl: albumUrl, tralbumType: 'album' },
                purchases: [{ tralbumUrl: trackUrl, title: null, fans: [mayaFan] }],
            })
            expect(database.db.select().from(feedItemHistoryEntriesTable).all()).toMatchObject([
                { id: 'album-view', feedItemId: 'track' },
            ])
            expect(
                database.db
                    .select()
                    .from(feedReleaseUrlsTable)
                    .where(eq(feedReleaseUrlsTable.feedItemId, 'track'))
                    .orderBy(feedReleaseUrlsTable.url)
                    .all(),
            ).toEqual([
                { url: albumUrl, feedItemId: 'track' },
                { url: trackUrl, feedItemId: 'track' },
            ])
        } finally {
            database.sqlite.close()
        }
    })

    it('moves fans and purchases out of feed item JSON', async () => {
        const database = createTestDatabaseMigratedThrough(LAST_MIGRATION_WITH_JSON_PURCHASES)
        try {
            database.db
                .insert(feedItemsTable)
                .values([
                    legacyRow(
                        {
                            ...bandcampFeedItem('fan-album', new Date('2026-10-02T10:00:00Z')),
                            dedupeIdentifier: albumUrl,
                            data: { tralbumUrl: albumUrl, tralbumType: 'album' },
                        },
                        [
                            { tralbumUrl: albumUrl, fans: [adamFan] },
                            { tralbumUrl: trackUrl, fans: [mayaFan] },
                        ],
                    ),
                    legacyRow(bandcampFeedItem('fan-second', new Date('2026-10-05T10:00:00Z')), [
                        {
                            tralbumUrl: 'https://test.bandcamp.com/album/fan-second',
                            fans: [{ ...mayaFan, name: 'Maya R.', imageUrl: null }],
                        },
                    ]),
                ])
                .run()

            database.migrateToLatest()

            expect(
                database.db
                    .select()
                    .from(feedItemsTable)
                    .all()
                    .map(row => row.data),
            ).not.toContainEqual(expect.objectContaining({ purchases: expect.anything() }))
            // The latest name wins, and a later notification without a photo keeps the known one.
            expect(database.db.select().from(feedFansTable).all()).toEqual([
                expect.objectContaining(adamFan),
                expect.objectContaining({ ...mayaFan, name: 'Maya R.' }),
            ])
            const [album] = await new FeedBackendRepository(database.client).getFeedItems(['fan-album'])
            expect(album?.purchases).toEqual([
                { tralbumUrl: albumUrl, title: null, fans: [adamFan] },
                { tralbumUrl: trackUrl, title: null, fans: [{ ...mayaFan, name: 'Maya R.' }] },
            ])
        } finally {
            database.sqlite.close()
        }
    })
})

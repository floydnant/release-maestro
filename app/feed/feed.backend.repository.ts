import { and, eq, lt, or } from 'drizzle-orm'
import { DatabaseClient } from '../database/database.client'
import { feedItemHistoryEntriesTable, feedItemsTable } from '../database/drizzle.schema'
import { FeedItemMaster, feedItemMasterSchema } from './feed.schema'

/**
 * The time after which a feed item should be shown again if it was marked as snoozed.
 */
const FEED_ITEM_SNOOZE_TIME_MS = 1000 * 60 * 60 * 24 * 16

/**
 * Don't create view history entries for feed items that were viewed in the last 3 minutes.
 * This is to prevent spamming the view history when the user is scrolling up and down the feed.
 */
const FEED_VIEW_HISTORY_THROTTLE_TIME_MS = 1000 * 60 * 3

export class FeedBackendRepository {
    constructor(private db: DatabaseClient) {}

    async ingestFeedItems(feedItemsToIngest: FeedItemMaster[]) {
        if (feedItemsToIngest.length == 0) return

        await this.db.db.insert(feedItemsTable).values(feedItemsToIngest).onConflictDoNothing()
    }

    async listFeedItems(index: number, count: number): Promise<FeedItemMaster[]> {
        const items = await this.db.db
            .select()
            .from(feedItemsTable)
            .where(
                or(
                    eq(feedItemsTable.isViewed, false),
                    and(
                        eq(feedItemsTable.isSnoozed, true),
                        lt(feedItemsTable.lastViewedAt, new Date(Date.now() - FEED_ITEM_SNOOZE_TIME_MS)),
                    ),
                ),
            )
            .limit(count)
            .offset(index * count)

        return feedItemMasterSchema.array().parse(items)
    }

    async markFeedItemViewed(id: string, type: FeedItemMaster['type'], isSnoozed: boolean): Promise<void> {
        const [feedItem] = await this.db.db.select().from(feedItemsTable).where(eq(feedItemsTable.id, id))
        if (!feedItem) {
            // @TODO: custom exception
            throw new Error(`Feed item with id ${id} and type ${type} not found`)
        }

        // @TODO: this is technically service level logic, but idgaf right now
        // Only create a view event if the item was not viewed in the last X mins
        // (prevent spamming the view history when the user is e.g. scrolling up and down the feed)
        const shouldCreateHistoryEntry =
            !feedItem?.lastViewedAt ||
            feedItem.lastViewedAt < new Date(Date.now() - FEED_VIEW_HISTORY_THROTTLE_TIME_MS)

        const now = new Date()

        // Update the feed item
        await this.db.db
            .update(feedItemsTable)
            .set({
                isViewed: true,
                isSnoozed,
                lastViewedAt: now,
            })
            .where(eq(feedItemsTable.id, id))

        // Add a view history entry if needed
        if (shouldCreateHistoryEntry) {
            await this.db.db.insert(feedItemHistoryEntriesTable).values({
                id: crypto.randomUUID(),
                feedItemId: id,
                ts: now,
            })
        }
    }
}

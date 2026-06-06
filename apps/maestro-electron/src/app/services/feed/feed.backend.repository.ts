import { and, count, desc, eq, gte, isNull, lt, or } from 'drizzle-orm'
import { FeedItemMaster } from '@release-maestro/core'
import { DatabaseClient } from '../../database/database.client'
import { feedItemHistoryEntriesTable, feedItemsTable } from '../../database/drizzle.schema'

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
                    isNull(feedItemsTable.lastViewedAt),
                    and(
                        eq(feedItemsTable.isSnoozed, true),
                        lt(feedItemsTable.lastViewedAt, new Date(Date.now() - FEED_ITEM_SNOOZE_TIME_MS)),
                    ),
                ),
            )
            .orderBy(desc(feedItemsTable.eventDate))
            .limit(count)
            .offset(index * count)

        return items as FeedItemMaster[] // TODO: Add proper schema validation
    }

    async hasFeedItems(): Promise<boolean> {
        const items = await this.db.db.select().from(feedItemsTable).limit(1)

        return items.length > 0
    }

    async countItemsIngestedAfterDate(date: Date): Promise<number> {
        const count_ = await this.db.db
            .select({ count: count(feedItemsTable.id) })
            .from(feedItemsTable)
            .where(gte(feedItemsTable.ingestedAt, date))

        return count_[0]?.count ?? 0
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
            .set({ isSnoozed, lastViewedAt: now })
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

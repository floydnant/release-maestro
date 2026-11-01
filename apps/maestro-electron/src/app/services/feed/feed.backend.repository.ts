import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import {
    EmailVendor,
    FeedItemMaster,
    feedItemMasterSchema,
    mergeBandcampPurchases,
    normalizeBandcampReleaseUrl,
} from '@release-maestro/core'
import { DatabaseClient } from '../../database/database.client'
import {
    feedEmailImportCheckpointsTable,
    feedItemHistoryEntriesTable,
    feedItemsTable,
} from '../../database/drizzle.schema'

/**
 * Don't create view history entries for feed items that were viewed in the last 3 minutes.
 * This is to prevent spamming the view history when the user is scrolling up and down the feed.
 */
const FEED_VIEW_HISTORY_THROTTLE_TIME_MS = 1000 * 60 * 3

export class FeedBackendRepository {
    // Open renderer windows can still write to track IDs collapsed during this app session.
    private readonly mergedItemIds = new Map<string, string>()

    constructor(private db: DatabaseClient) {}

    private resolveItemId(id: string): string {
        let current = id
        while (this.mergedItemIds.has(current)) current = this.mergedItemIds.get(current) ?? current
        return current
    }

    async ingestFeedItems(feedItemsToIngest: FeedItemMaster[]) {
        if (feedItemsToIngest.length == 0) return

        const mergedItems = new Map<string, string>()
        this.db.db.transaction(tx => {
            // Index normalized identities once per batch. Existing announcements can still carry
            // HTTP, tracking fragments or trailing slashes from earlier parser versions.
            const identities = new Map<string, Set<string>>()
            const identityKey = (type: string, url: string) =>
                `${type}:${normalizeBandcampReleaseUrl(url) ?? url}`
            const rememberIdentity = (id: string, type: string, url: string) => {
                const key = identityKey(type, url)
                const ids = identities.get(key) ?? new Set<string>()
                ids.add(id)
                identities.set(key, ids)
            }
            const identityUrls = (item: FeedItemMaster): string[] => [
                item.dedupeIdentifier,
                item.data.tralbumUrl,
                ...item.data.purchases.map(purchase => purchase.tralbumUrl),
                ...(item.source.type === 'EMAIL.BANDCAMP_NEW_RELEASE' ? [item.source.releaseUrl] : []),
            ]
            const rememberItem = (item: FeedItemMaster) => {
                for (const url of identityUrls(item)) rememberIdentity(item.id, item.type, url)
            }
            for (const item of tx
                .select()
                .from(feedItemsTable)
                .all()
                .map(row => feedItemMasterSchema.parse(row))) {
                rememberItem(item)
            }
            for (const incoming of feedItemsToIngest) {
                const urls = identityUrls(incoming)
                const ids = [
                    ...new Set(
                        urls.flatMap(url => [...(identities.get(identityKey(incoming.type, url)) ?? [])]),
                    ),
                ]
                const existing = tx
                    .select()
                    .from(feedItemsTable)
                    .where(and(eq(feedItemsTable.type, incoming.type), inArray(feedItemsTable.id, ids)))
                    .orderBy(asc(feedItemsTable.ingestedAt), sql`rowid`)
                    .all()
                    .map(row => feedItemMasterSchema.parse(row))
                const retained = existing[0]
                if (!retained) {
                    tx.insert(feedItemsTable).values(incoming).run()
                    rememberItem(incoming)
                    continue
                }
                for (const item of existing) {
                    for (const url of identityUrls(item))
                        identities.get(identityKey(item.type, url))?.delete(item.id)
                }
                const mergedIds = existing.slice(1).map(item => item.id)
                if (mergedIds.length) {
                    tx.update(feedItemHistoryEntriesTable)
                        .set({ feedItemId: retained.id })
                        .where(inArray(feedItemHistoryEntriesTable.feedItemId, mergedIds))
                        .run()
                    tx.delete(feedItemsTable).where(inArray(feedItemsTable.id, mergedIds)).run()
                    for (const id of mergedIds) mergedItems.set(id, retained.id)
                }
                // A missing track page on reimport cannot undo an album relationship already saved.
                const release =
                    incoming.data.tralbumType === 'album'
                        ? incoming
                        : (existing.find(item => item.data.tralbumType === 'album') ?? incoming)
                const data = {
                    ...release.data,
                    purchases: mergeBandcampPurchases(
                        existing.flatMap(item => item.data.purchases),
                        incoming.data.purchases,
                    ),
                }
                tx.update(feedItemsTable)
                    .set({
                        dedupeIdentifier: release.dedupeIdentifier,
                        source: retained.source,
                        data,
                    })
                    .where(eq(feedItemsTable.id, retained.id))
                    .run()
                rememberItem({ ...retained, dedupeIdentifier: release.dedupeIdentifier, data })
            }
        })
        // Publish aliases only after the transaction commits.
        for (const [id, retainedId] of mergedItems) this.mergedItemIds.set(id, retainedId)
    }

    async listFeedItems({
        index,
        count,
        excludedIds = [],
        snoozeHours,
    }: {
        index: number
        count: number
        excludedIds?: string[]
        snoozeHours: number
    }): Promise<FeedItemMaster[]> {
        const snoozedBefore = new Date(Date.now() - snoozeHours * 60 * 60 * 1000)
        const items = await this.db.db
            .select()
            .from(feedItemsTable)
            .where(
                and(
                    excludedIds.length > 0
                        ? sql`${feedItemsTable.id} not in (select value from json_each(${JSON.stringify(excludedIds.map(id => this.resolveItemId(id)))}))`
                        : undefined,
                    or(
                        isNull(feedItemsTable.lastViewedAt),
                        and(
                            eq(feedItemsTable.isSnoozed, true),
                            lt(feedItemsTable.lastViewedAt, snoozedBefore),
                        ),
                    ),
                ),
            )
            .orderBy(desc(feedItemsTable.eventDate))
            .limit(count)
            .offset(index)

        return items.map(item => feedItemMasterSchema.parse(item))
    }

    async hasFeedItems(): Promise<boolean> {
        const items = await this.db.db.select().from(feedItemsTable).limit(1)

        return items.length > 0
    }

    /** Open windows may still address IDs merged into an album during the current app session. */
    async getFeedItems(ids: string[]): Promise<FeedItemMaster[]> {
        const requested = [...new Set(ids)].map(id => ({ id, resolvedId: this.resolveItemId(id) }))
        const rows = await this.db.db
            .select()
            .from(feedItemsTable)
            .where(
                inArray(
                    feedItemsTable.id,
                    requested.map(item => item.resolvedId),
                ),
            )
        const byId = new Map(rows.map(row => [row.id, feedItemMasterSchema.parse(row)]))
        return requested.flatMap(({ id, resolvedId }) => {
            const item = byId.get(resolvedId)
            return item ? [{ ...item, id }] : []
        })
    }

    async countItemsIngestedAfterDate(date: Date): Promise<number> {
        const count_ = await this.db.db
            .select({ count: count(feedItemsTable.id) })
            .from(feedItemsTable)
            .where(gte(feedItemsTable.ingestedAt, date))

        return count_[0]?.count ?? 0
    }

    async getEmailImportCheckpoint(vendor: EmailVendor, mailboxName: string): Promise<Date | null> {
        const [checkpoint] = await this.db.db
            .select({ newestReceivedAt: feedEmailImportCheckpointsTable.newestReceivedAt })
            .from(feedEmailImportCheckpointsTable)
            .where(
                and(
                    eq(feedEmailImportCheckpointsTable.vendor, vendor),
                    eq(feedEmailImportCheckpointsTable.mailboxName, mailboxName),
                ),
            )

        return checkpoint?.newestReceivedAt ?? null
    }

    /** Never moves a checkpoint backwards, e.g. when the newest message was deleted from the mailbox. */
    async advanceEmailImportCheckpoint(
        vendor: EmailVendor,
        mailboxName: string,
        newestReceivedAt: Date,
    ): Promise<void> {
        await this.db.db
            .insert(feedEmailImportCheckpointsTable)
            .values({ vendor, mailboxName, newestReceivedAt })
            .onConflictDoUpdate({
                target: [feedEmailImportCheckpointsTable.vendor, feedEmailImportCheckpointsTable.mailboxName],
                set: {
                    newestReceivedAt: sql`max(${feedEmailImportCheckpointsTable.newestReceivedAt}, excluded.newest_received_at)`,
                },
            })
    }

    async markFeedItemViewed(id: string, type: FeedItemMaster['type'], isSnoozed: boolean): Promise<void> {
        id = this.resolveItemId(id)
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

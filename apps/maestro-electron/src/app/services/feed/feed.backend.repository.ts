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

/**
 * Which stored feed items answer to each release URL, per feed item type. An item answers to its
 * dedupe identifier, its release URL, every URL bought through it, and its announcement's release
 * URL. URLs are normalized, so rows saved by earlier parser versions with HTTP, tracking queries or
 * trailing slashes still match.
 */
class FeedItemIdentities {
    private readonly idsByIdentity = new Map<string, Set<string>>()

    constructor(items: FeedItemMaster[]) {
        for (const item of items) this.add(item)
    }

    /** Stored items that share any identity with this item. */
    matching(item: FeedItemMaster): string[] {
        return [...new Set(this.keys(item).flatMap(key => [...(this.idsByIdentity.get(key) ?? [])]))]
    }

    add(item: FeedItemMaster): void {
        for (const key of this.keys(item)) {
            const ids = this.idsByIdentity.get(key) ?? new Set<string>()
            ids.add(item.id)
            this.idsByIdentity.set(key, ids)
        }
    }

    remove(item: FeedItemMaster): void {
        for (const key of this.keys(item)) this.idsByIdentity.get(key)?.delete(item.id)
    }

    private keys(item: FeedItemMaster): string[] {
        const urls = [
            item.dedupeIdentifier,
            item.data.tralbumUrl,
            ...item.data.purchases.map(purchase => purchase.tralbumUrl),
            ...(item.source.type === 'EMAIL.BANDCAMP_NEW_RELEASE' ? [item.source.releaseUrl] : []),
        ]
        return urls.map(url => `${item.type}:${normalizeBandcampReleaseUrl(url) ?? url}`)
    }
}

/**
 * The oldest matching item, after absorbing the other matches and the incoming item. It keeps its
 * own ID, source, viewed and snoozed state. Its release is the album whenever the incoming item or
 * a match names one, so an unavailable track page on reimport cannot undo a known album. The
 * purchases of all of them merge, which adds each fan once.
 */
const mergeIntoRetained = (
    [retained, ...absorbed]: [FeedItemMaster, ...FeedItemMaster[]],
    incoming: FeedItemMaster,
): FeedItemMaster => {
    const matches = [retained, ...absorbed]
    const release =
        incoming.data.tralbumType === 'album'
            ? incoming
            : (matches.find(item => item.data.tralbumType === 'album') ?? incoming)
    return {
        ...retained,
        dedupeIdentifier: release.dedupeIdentifier,
        data: {
            ...release.data,
            purchases: mergeBandcampPurchases(
                matches.flatMap(item => item.data.purchases),
                incoming.data.purchases,
            ),
        },
    }
}

export class FeedBackendRepository {
    // Open renderer windows can still write to track IDs collapsed during this app session.
    private readonly mergedItemIds = new Map<string, string>()

    constructor(private db: DatabaseClient) {}

    private resolveItemId(id: string): string {
        let current = id
        while (this.mergedItemIds.has(current)) current = this.mergedItemIds.get(current) ?? current
        return current
    }

    /**
     * Saves imported items. An item that shares a release with stored items merges into the oldest
     * of them (see {@link mergeIntoRetained}); the others are deleted after their view history moves
     * to the retained item, and their IDs stay addressable as aliases.
     */
    async ingestFeedItems(feedItemsToIngest: FeedItemMaster[]) {
        if (feedItemsToIngest.length == 0) return

        const aliases = new Map<string, string>()
        this.db.db.transaction(tx => {
            const identities = new FeedItemIdentities(
                tx
                    .select()
                    .from(feedItemsTable)
                    .all()
                    .map(row => feedItemMasterSchema.parse(row)),
            )

            for (const incoming of feedItemsToIngest) {
                const [retained, ...absorbed] = tx
                    .select()
                    .from(feedItemsTable)
                    .where(
                        and(
                            eq(feedItemsTable.type, incoming.type),
                            inArray(feedItemsTable.id, identities.matching(incoming)),
                        ),
                    )
                    .orderBy(asc(feedItemsTable.ingestedAt), sql`rowid`)
                    .all()
                    .map(row => feedItemMasterSchema.parse(row))
                if (!retained) {
                    tx.insert(feedItemsTable).values(incoming).run()
                    identities.add(incoming)
                    continue
                }

                const merged = mergeIntoRetained([retained, ...absorbed], incoming)
                for (const item of [retained, ...absorbed]) identities.remove(item)
                if (absorbed.length > 0) {
                    const absorbedIds = absorbed.map(item => item.id)
                    tx.update(feedItemHistoryEntriesTable)
                        .set({ feedItemId: retained.id })
                        .where(inArray(feedItemHistoryEntriesTable.feedItemId, absorbedIds))
                        .run()
                    tx.delete(feedItemsTable).where(inArray(feedItemsTable.id, absorbedIds)).run()
                    for (const id of absorbedIds) aliases.set(id, retained.id)
                }
                tx.update(feedItemsTable)
                    .set({
                        dedupeIdentifier: merged.dedupeIdentifier,
                        source: merged.source,
                        data: merged.data,
                    })
                    .where(eq(feedItemsTable.id, retained.id))
                    .run()
                identities.add(merged)
            }
        })
        // Publish aliases only after the transaction commits.
        for (const [id, retainedId] of aliases) this.mergedItemIds.set(id, retainedId)
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

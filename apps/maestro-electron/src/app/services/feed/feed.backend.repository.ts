import { and, asc, count, desc, eq, gte, inArray, isNull, lt, or, sql } from 'drizzle-orm'
import {
    BandcampPurchase,
    EmailVendor,
    FeedItemMaster,
    feedItemMasterSchema,
    FeedItemWithPurchases,
    normalizeBandcampReleaseUrl,
} from '@release-maestro/core'
import { DatabaseClient } from '../../database/database.client'
import {
    feedEmailImportCheckpointsTable,
    feedFansTable,
    feedItemHistoryEntriesTable,
    feedItemsTable,
    feedPurchasesTable,
    feedReleaseUrlsTable,
} from '../../database/drizzle.schema'

type Transaction = Parameters<Parameters<DatabaseClient['db']['transaction']>[0]>[0]

/**
 * Don't create view history entries for feed items that were viewed in the last 3 minutes.
 * This is to prevent spamming the view history when the user is scrolling up and down the feed.
 */
const FEED_VIEW_HISTORY_THROTTLE_TIME_MS = 1000 * 60 * 3

const normalizeUrl = (url: string) => normalizeBandcampReleaseUrl(url) ?? url

/** The release URLs an item answers to: its own, its announcement's, and every URL bought through it. */
const releaseUrlsOf = (item: FeedItemWithPurchases): string[] => [
    ...new Set(
        [
            item.dedupeIdentifier,
            item.data.tralbumUrl,
            ...(item.source.type === 'EMAIL.BANDCAMP_NEW_RELEASE' ? [item.source.releaseUrl] : []),
            ...item.purchases.map(purchase => purchase.tralbumUrl),
        ].map(normalizeUrl),
    ),
]

/**
 * The release a merged item shows: the album whenever the incoming item or a stored match names one,
 * so an unavailable track page on reimport cannot undo a known album.
 */
const releaseAfterMerge = (matches: FeedItemMaster[], incoming: FeedItemMaster): FeedItemMaster =>
    incoming.data.tralbumType === 'album'
        ? incoming
        : (matches.find(item => item.data.tralbumType === 'album') ?? incoming)

/**
 * Feed items, their release URLs, and the fans who bought them. Callers read and write
 * {@link FeedItemWithPurchases}; the repository keeps purchases and fans in their own tables.
 */
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
     * Saves imported items. An item that shares a release URL with stored items merges into the
     * oldest of them, which keeps its ID, source, viewed and snoozed state. The others are deleted
     * after their URLs and view history move to it, and their IDs stay addressable as aliases.
     */
    async ingestFeedItems(feedItemsToIngest: FeedItemWithPurchases[]) {
        if (feedItemsToIngest.length == 0) return

        const aliases = new Map<string, string>()
        this.db.db.transaction(tx => {
            for (const incoming of feedItemsToIngest) {
                const urls = releaseUrlsOf(incoming)
                const id = this.saveFeedItem(tx, incoming, urls, aliases)
                // URLs the item already owns are kept as they are.
                tx.insert(feedReleaseUrlsTable)
                    .values(urls.map(url => ({ url, feedItemId: id })))
                    .onConflictDoNothing()
                    .run()
                this.savePurchases(tx, incoming)
            }
        })
        // Publish aliases only after the transaction commits.
        for (const [id, retainedId] of aliases) this.mergedItemIds.set(id, retainedId)
    }

    /**
     * Inserts the item, or merges it into the oldest stored item that owns one of its URLs, and
     * returns the ID it is saved under.
     */
    private saveFeedItem(
        tx: Transaction,
        { purchases: _purchases, ...incoming }: FeedItemWithPurchases,
        urls: string[],
        aliases: Map<string, string>,
    ): string {
        const [retained, ...absorbed] = tx
            .select()
            .from(feedItemsTable)
            .where(
                and(
                    eq(feedItemsTable.type, incoming.type),
                    inArray(
                        feedItemsTable.id,
                        tx
                            .select({ id: feedReleaseUrlsTable.feedItemId })
                            .from(feedReleaseUrlsTable)
                            .where(inArray(feedReleaseUrlsTable.url, urls)),
                    ),
                ),
            )
            .orderBy(asc(feedItemsTable.ingestedAt), sql`rowid`)
            .all()
            .map(row => feedItemMasterSchema.parse(row))
        if (!retained) {
            tx.insert(feedItemsTable).values(incoming).run()
            return incoming.id
        }

        const absorbedIds = absorbed.map(item => item.id)
        if (absorbedIds.length > 0) {
            tx.update(feedReleaseUrlsTable)
                .set({ feedItemId: retained.id })
                .where(inArray(feedReleaseUrlsTable.feedItemId, absorbedIds))
                .run()
            tx.update(feedItemHistoryEntriesTable)
                .set({ feedItemId: retained.id })
                .where(inArray(feedItemHistoryEntriesTable.feedItemId, absorbedIds))
                .run()
            tx.delete(feedItemsTable).where(inArray(feedItemsTable.id, absorbedIds)).run()
            for (const id of absorbedIds) aliases.set(id, retained.id)
        }
        const release = releaseAfterMerge([retained, ...absorbed], incoming)
        tx.update(feedItemsTable)
            .set({ dedupeIdentifier: release.dedupeIdentifier, data: release.data })
            .where(eq(feedItemsTable.id, retained.id))
            .run()
        return retained.id
    }

    /**
     * Records each fan once per profile URL, where the latest name and any known photo win, and each
     * purchase once per fan and bought URL, dated by the first notification that reported it.
     */
    private savePurchases(tx: Transaction, { purchases, eventDate }: FeedItemWithPurchases): void {
        for (const purchase of purchases) {
            const boughtUrl = normalizeUrl(purchase.tralbumUrl)
            for (const fan of purchase.fans) {
                const { id: fanId } = tx
                    .insert(feedFansTable)
                    .values({ id: crypto.randomUUID(), ...fan })
                    .onConflictDoUpdate({
                        target: feedFansTable.profileUrl,
                        set: {
                            name: fan.name,
                            imageUrl: sql`coalesce(excluded.image_url, ${feedFansTable.imageUrl})`,
                        },
                    })
                    .returning({ id: feedFansTable.id })
                    .get()
                tx.insert(feedPurchasesTable)
                    .values({ fanId, boughtUrl, boughtTitle: purchase.title, firstReportedAt: eventDate })
                    .onConflictDoUpdate({
                        target: [feedPurchasesTable.fanId, feedPurchasesTable.boughtUrl],
                        set: {
                            boughtTitle: sql`coalesce(${feedPurchasesTable.boughtTitle}, excluded.bought_title)`,
                            firstReportedAt: sql`min(${feedPurchasesTable.firstReportedAt}, excluded.first_reported_at)`,
                        },
                    })
                    .run()
            }
        }
    }

    /** Joins each item's purchases through its release URLs, in the order they were first recorded. */
    private withPurchases(items: FeedItemMaster[]): FeedItemWithPurchases[] {
        if (items.length === 0) return []
        const rows = this.db.db
            .select({
                feedItemId: feedReleaseUrlsTable.feedItemId,
                tralbumUrl: feedPurchasesTable.boughtUrl,
                title: feedPurchasesTable.boughtTitle,
                name: feedFansTable.name,
                profileUrl: feedFansTable.profileUrl,
                imageUrl: feedFansTable.imageUrl,
            })
            .from(feedReleaseUrlsTable)
            .innerJoin(feedPurchasesTable, eq(feedPurchasesTable.boughtUrl, feedReleaseUrlsTable.url))
            .innerJoin(feedFansTable, eq(feedFansTable.id, feedPurchasesTable.fanId))
            .where(
                inArray(
                    feedReleaseUrlsTable.feedItemId,
                    items.map(item => item.id),
                ),
            )
            .orderBy(sql`${feedPurchasesTable}.rowid`)
            .all()

        const purchasesByItem = new Map<string, Map<string, BandcampPurchase>>()
        for (const { feedItemId, tralbumUrl, title, ...fan } of rows) {
            const purchases = purchasesByItem.get(feedItemId) ?? new Map<string, BandcampPurchase>()
            const purchase = purchases.get(tralbumUrl) ?? { tralbumUrl, title, fans: [] }
            purchase.fans.push(fan)
            purchases.set(tralbumUrl, purchase)
            purchasesByItem.set(feedItemId, purchases)
        }
        return items.map(item => ({
            ...item,
            purchases: [...(purchasesByItem.get(item.id)?.values() ?? [])],
        }))
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
    }): Promise<FeedItemWithPurchases[]> {
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

        return this.withPurchases(items.map(item => feedItemMasterSchema.parse(item)))
    }

    async hasFeedItems(): Promise<boolean> {
        const items = await this.db.db.select().from(feedItemsTable).limit(1)

        return items.length > 0
    }

    /** Open windows may still address IDs merged into an album during the current app session. */
    async getFeedItems(ids: string[]): Promise<FeedItemWithPurchases[]> {
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
        const items = this.withPurchases(rows.map(row => feedItemMasterSchema.parse(row)))
        const byId = new Map(items.map(item => [item.id, item]))
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

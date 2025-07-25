import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const feedItemsTable = sqliteTable(
    'feed_items',
    {
        id: text('id').primaryKey(),
        ingestedAt: integer('ingested_at', { mode: 'timestamp' }).notNull(),
        eventDate: integer('event_date', { mode: 'timestamp' }).notNull(),
        isSnoozed: integer('is_snoozed', { mode: 'boolean' }).notNull(),
        lastViewedAt: integer('last_viewed_at', { mode: 'timestamp' }),
        type: text('type').notNull(),
        dedupeIdentifier: text('dedupe_identifier').notNull(),
        data: text('data', { mode: 'json' }).notNull(),
        source: text('source', { mode: 'json' }).notNull(),
    },
    table => [uniqueIndex('feed_item_type_dedupe_identifier_key').on(table.type, table.dedupeIdentifier)],
)

export const feedItemHistoryEntriesTable = sqliteTable('feed_item_history_entries', {
    id: text('id').primaryKey(),
    ts: integer('ts', { mode: 'timestamp' }).notNull(),
    feedItemId: text('feed_item_id')
        .notNull()
        .references(() => feedItemsTable.id, { onDelete: 'cascade', onUpdate: 'cascade' }),
})

export type DbFeedItem = typeof feedItemsTable.$inferSelect
export type DbFeedItemHistoryEntry = typeof feedItemHistoryEntriesTable.$inferSelect

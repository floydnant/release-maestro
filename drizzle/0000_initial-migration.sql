CREATE TABLE `feed_item_history_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`ts` integer NOT NULL,
	`feed_item_id` text NOT NULL,
	FOREIGN KEY (`feed_item_id`) REFERENCES `feed_items`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `feed_items` (
	`id` text PRIMARY KEY NOT NULL,
	`ingested_at` integer NOT NULL,
	`event_date` integer NOT NULL,
	`is_snoozed` integer NOT NULL,
	`last_viewed_at` integer,
	`type` text NOT NULL,
	`dedupe_identifier` text NOT NULL,
	`data` text NOT NULL,
	`source` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_item_type_dedupe_identifier_key` ON `feed_items` (`type`,`dedupe_identifier`);
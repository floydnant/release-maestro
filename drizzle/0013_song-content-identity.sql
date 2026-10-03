ALTER TABLE `songs` ADD `first_seen_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `songs` ADD `last_available_at` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `songs` ADD `content_hash` text;--> statement-breakpoint
CREATE INDEX `songs_content_hash_size_idx` ON `songs` (`content_hash`,`size`);--> statement-breakpoint
CREATE INDEX `songs_size_idx` ON `songs` (`size`);
--> statement-breakpoint
UPDATE `songs` SET `first_seen_at` = min(coalesce(`added_at`, `last_seen_at`), `last_seen_at`),
    `last_available_at` = `last_seen_at`;

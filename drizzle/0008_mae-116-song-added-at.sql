DROP INDEX `songs_created_at_idx`;--> statement-breakpoint
ALTER TABLE `songs` ADD `added_at` integer;--> statement-breakpoint
UPDATE `songs` SET `added_at` = `created_at`;--> statement-breakpoint
CREATE INDEX `songs_added_at_idx` ON `songs` (`added_at`,`id`);

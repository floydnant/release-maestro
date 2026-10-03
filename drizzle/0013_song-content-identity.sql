ALTER TABLE `songs` ADD `content_hash` text;--> statement-breakpoint
CREATE INDEX `songs_content_hash_size_idx` ON `songs` (`content_hash`,`size`);--> statement-breakpoint
CREATE INDEX `songs_metadata_hash_size_idx` ON `songs` (`metadata_hash`,`size`);
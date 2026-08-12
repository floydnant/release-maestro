DROP INDEX `albums_title_idx`;--> statement-breakpoint
ALTER TABLE `albums` ADD `record_label_text` text;--> statement-breakpoint
ALTER TABLE `albums` ADD `track_count` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `albums_artist_text_idx` ON `albums` (`artist_text`,`id`);--> statement-breakpoint
CREATE INDEX `albums_year_idx` ON `albums` (`year`,`id`);--> statement-breakpoint
CREATE INDEX `albums_record_label_text_idx` ON `albums` (`record_label_text`,`id`);--> statement-breakpoint
CREATE INDEX `albums_track_count_idx` ON `albums` (`track_count`,`id`);--> statement-breakpoint
CREATE INDEX `albums_title_idx` ON `albums` (`title`,`id`);--> statement-breakpoint
CREATE INDEX `songs_track_number_idx` ON `songs` (`track_number`,`id`);--> statement-breakpoint
CREATE INDEX `songs_album_id_track_number_idx` ON `songs` (`album_id`,`track_number`,`id`);--> statement-breakpoint
-- Backfill the two denormalized columns for libraries scanned before they existed.
-- Without this an already-populated library opens the new albums grid with every
-- record showing no label and a track count of zero, and nothing would correct it
-- short of a full rescan: the write side only recomputes an album when one of its
-- songs is re-read, and an unchanged file is never re-read.
UPDATE `albums` SET `record_label_text` = (
    SELECT `record_labels`.`name` FROM `record_labels` WHERE `record_labels`.`id` = `albums`.`record_label_id`
);--> statement-breakpoint
UPDATE `albums` SET `track_count` = (
    SELECT COUNT(*) FROM `songs` WHERE `songs`.`album_id` = `albums`.`id`
);
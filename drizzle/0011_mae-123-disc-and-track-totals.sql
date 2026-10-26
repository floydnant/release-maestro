DROP INDEX `songs_album_id_track_number_idx`;--> statement-breakpoint
ALTER TABLE `songs` ADD `disc_number` integer;--> statement-breakpoint
ALTER TABLE `songs` ADD `disc_total` integer;--> statement-breakpoint
ALTER TABLE `songs` ADD `track_total` integer;--> statement-breakpoint
CREATE INDEX `songs_album_disc_track_idx` ON `songs` (`album_id`,`disc_number`,`track_number`,`id`);--> statement-breakpoint
CREATE INDEX `songs_disc_track_idx` ON `songs` (`disc_number`,`track_number`,`id`);
CREATE INDEX `songs_title_idx` ON `songs` (`title`,`id`);--> statement-breakpoint
CREATE INDEX `songs_artist_text_idx` ON `songs` (`artist_text`,`id`);--> statement-breakpoint
CREATE INDEX `songs_album_title_idx` ON `songs` (`album_title`,`id`);--> statement-breakpoint
CREATE INDEX `songs_genre_text_idx` ON `songs` (`genre_text`,`id`);--> statement-breakpoint
CREATE INDEX `songs_record_label_text_idx` ON `songs` (`record_label_text`,`id`);--> statement-breakpoint
CREATE INDEX `songs_year_idx` ON `songs` (`year`,`id`);--> statement-breakpoint
CREATE INDEX `songs_bpm_idx` ON `songs` (`bpm`,`id`);--> statement-breakpoint
CREATE INDEX `songs_musical_key_idx` ON `songs` (`musical_key`,`id`);--> statement-breakpoint
CREATE INDEX `songs_duration_idx` ON `songs` (`duration`,`id`);--> statement-breakpoint
CREATE INDEX `songs_created_at_idx` ON `songs` (`created_at`,`id`);
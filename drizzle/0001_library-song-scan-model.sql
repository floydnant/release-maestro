CREATE TABLE `album_artists` (
	`album_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`role` text,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`album_id`, `artist_id`, `position`),
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `album_artists_artist_id_idx` ON `album_artists` (`artist_id`);--> statement-breakpoint
CREATE TABLE `albums` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_key` text NOT NULL,
	`title` text NOT NULL,
	`artist_text` text,
	`year` integer,
	`date` text,
	`catalog_number` text,
	`cover_path` text,
	`external_refs` text DEFAULT '{}' NOT NULL,
	`label_id` text,
	FOREIGN KEY (`label_id`) REFERENCES `labels`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `albums_identity_key_key` ON `albums` (`identity_key`);--> statement-breakpoint
CREATE INDEX `albums_title_idx` ON `albums` (`title`);--> statement-breakpoint
CREATE INDEX `albums_label_id_idx` ON `albums` (`label_id`);--> statement-breakpoint
CREATE TABLE `artist_raw_name_artists` (
	`artist_raw_name_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`artist_raw_name_id`, `artist_id`, `position`),
	FOREIGN KEY (`artist_raw_name_id`) REFERENCES `artist_raw_names`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `artist_raw_name_artists_artist_idx` ON `artist_raw_name_artists` (`artist_id`);--> statement-breakpoint
CREATE TABLE `artist_raw_names` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_text` text NOT NULL,
	`normalized_text` text,
	`resolution_type` text,
	`confidence` real,
	`confirmed_by_user` integer DEFAULT false NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artist_raw_names_raw_text_key` ON `artist_raw_names` (`raw_text`);--> statement-breakpoint
CREATE INDEX `artist_raw_names_confirmed_idx` ON `artist_raw_names` (`confirmed_by_user`);--> statement-breakpoint
CREATE TABLE `artists` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`sort_name` text,
	`external_refs` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `artists_name_key` ON `artists` (`name`);--> statement-breakpoint
CREATE TABLE `genre_raw_name_genres` (
	`genre_raw_name_id` text NOT NULL,
	`genre_id` text NOT NULL,
	`position` integer NOT NULL,
	PRIMARY KEY(`genre_raw_name_id`, `genre_id`, `position`),
	FOREIGN KEY (`genre_raw_name_id`) REFERENCES `genre_raw_names`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `genre_raw_name_genres_genre_idx` ON `genre_raw_name_genres` (`genre_id`);--> statement-breakpoint
CREATE TABLE `genre_raw_names` (
	`id` text PRIMARY KEY NOT NULL,
	`raw_text` text NOT NULL,
	`normalized_text` text,
	`resolution_type` text,
	`confidence` real,
	`confirmed_by_user` integer DEFAULT false NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genre_raw_names_raw_text_key` ON `genre_raw_names` (`raw_text`);--> statement-breakpoint
CREATE INDEX `genre_raw_names_confirmed_idx` ON `genre_raw_names` (`confirmed_by_user`);--> statement-breakpoint
CREATE TABLE `genres` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `genres_name_key` ON `genres` (`name`);--> statement-breakpoint
CREATE TABLE `labels` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`external_refs` text DEFAULT '{}' NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `labels_name_key` ON `labels` (`name`);--> statement-breakpoint
CREATE TABLE `normalization_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`issue_type` text NOT NULL,
	`field` text NOT NULL,
	`value` text,
	`fingerprint` text NOT NULL,
	`status` text DEFAULT 'OPEN' NOT NULL,
	`first_seen_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`closed_at` integer,
	`detector_version` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `normalization_issues_entity_fingerprint_key` ON `normalization_issues` (`entity_type`,`entity_id`,`fingerprint`);--> statement-breakpoint
CREATE INDEX `normalization_issues_entity_idx` ON `normalization_issues` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `normalization_issues_status_idx` ON `normalization_issues` (`status`);--> statement-breakpoint
CREATE TABLE `song_artists` (
	`song_id` text NOT NULL,
	`artist_id` text NOT NULL,
	`role` text,
	`position` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`song_id`, `artist_id`, `position`),
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`artist_id`) REFERENCES `artists`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `song_artists_artist_id_idx` ON `song_artists` (`artist_id`);--> statement-breakpoint
CREATE TABLE `song_genres` (
	`song_id` text NOT NULL,
	`genre_id` text NOT NULL,
	PRIMARY KEY(`song_id`, `genre_id`),
	FOREIGN KEY (`song_id`) REFERENCES `songs`(`id`) ON UPDATE cascade ON DELETE cascade,
	FOREIGN KEY (`genre_id`) REFERENCES `genres`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `song_genres_genre_id_idx` ON `song_genres` (`genre_id`);--> statement-breakpoint
CREATE TABLE `songs` (
	`id` text PRIMARY KEY NOT NULL,
	`path` text NOT NULL,
	`file_name` text NOT NULL,
	`size` integer NOT NULL,
	`modified_at` integer NOT NULL,
	`created_at` integer,
	`file_fingerprint` text NOT NULL,
	`scanned_file_fingerprint` text,
	`present` integer DEFAULT true NOT NULL,
	`last_seen_at` integer NOT NULL,
	`last_scanned_at` integer,
	`raw_title` text,
	`raw_artist` text,
	`raw_album_title` text,
	`raw_album_artist` text,
	`raw_genre` text,
	`raw_label` text,
	`title` text NOT NULL,
	`artist_text` text,
	`album_title` text,
	`album_artist_text` text,
	`genre_text` text,
	`label_text` text,
	`catalog_number` text,
	`year` integer,
	`track_number` integer,
	`comment` text,
	`musical_key` text,
	`bpm` real,
	`energy` text,
	`lyrics` text,
	`date` text,
	`cover_path` text,
	`duration` real,
	`overall_bitrate` integer,
	`audio_bitrate` integer,
	`sample_rate` integer,
	`bit_depth` integer,
	`channels` integer,
	`tag_type` text,
	`codec` text,
	`metadata_hash` text,
	`external_refs` text DEFAULT '{}' NOT NULL,
	`album_id` text,
	FOREIGN KEY (`album_id`) REFERENCES `albums`(`id`) ON UPDATE cascade ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX `songs_path_key` ON `songs` (`path`);--> statement-breakpoint
CREATE INDEX `songs_present_idx` ON `songs` (`present`);--> statement-breakpoint
CREATE INDEX `songs_file_fingerprint_idx` ON `songs` (`file_fingerprint`);--> statement-breakpoint
CREATE INDEX `songs_album_id_idx` ON `songs` (`album_id`);
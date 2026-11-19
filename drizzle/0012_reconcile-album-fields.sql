-- Backfill the legacy stored cover for schema compatibility; browse now selects member art live.
UPDATE `albums` SET `cover_path` = (
    SELECT MIN(`songs`.`cover_path`) FROM `songs` WHERE `songs`.`album_id` = `albums`.`id`
);--> statement-breakpoint
-- Recover empty albums left by legacy or cancelled scans; completed scans already collected them.
-- Missing songs still count as members.
DELETE FROM `albums` WHERE NOT EXISTS (
    SELECT 1 FROM `songs` WHERE `songs`.`album_id` = `albums`.`id`
);--> statement-breakpoint
-- Rebuild credits from every member's stored resolution, including missing songs.
-- Match ingest ordering: first credited position, then artist name and ID.
DELETE FROM `album_artists`;--> statement-breakpoint
INSERT INTO `album_artists` (`album_id`, `artist_id`, `role`, `position`)
SELECT
    `songs`.`album_id`,
    `artists`.`id`,
    'primary',
    ROW_NUMBER() OVER (
        PARTITION BY `songs`.`album_id`
        ORDER BY MIN(`artist_raw_name_artists`.`position`), `artists`.`name`, `artists`.`id`
    ) - 1
FROM `songs`
INNER JOIN `artist_raw_names` ON `artist_raw_names`.`raw_text` = `songs`.`raw_album_artist`
INNER JOIN `artist_raw_name_artists`
    ON `artist_raw_name_artists`.`artist_raw_name_id` = `artist_raw_names`.`id`
INNER JOIN `artists` ON `artists`.`id` = `artist_raw_name_artists`.`artist_id`
WHERE `songs`.`album_id` IS NOT NULL
GROUP BY `songs`.`album_id`, `artists`.`id`;

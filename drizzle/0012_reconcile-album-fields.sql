-- Backfill the legacy stored cover for schema compatibility; browse now selects member art live.
UPDATE `albums` SET `cover_path` = (
    SELECT MIN(`songs`.`cover_path`) FROM `songs` WHERE `songs`.`album_id` = `albums`.`id`
);--> statement-breakpoint
-- Recover empty albums left by legacy or cancelled scans; completed scans already collected them.
-- Missing songs still count as members.
DELETE FROM `albums` WHERE NOT EXISTS (
    SELECT 1 FROM `songs` WHERE `songs`.`album_id` = `albums`.`id`
);

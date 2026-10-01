-- Apply the same member-derived cover rule as ingest to unchanged libraries.
UPDATE `albums` SET `cover_path` = (
    SELECT MIN(`songs`.`cover_path`) FROM `songs` WHERE `songs`.`album_id` = `albums`.`id`
);--> statement-breakpoint
-- Retagging used to leave empty album rows. Missing songs still count as members.
DELETE FROM `albums` WHERE NOT EXISTS (
    SELECT 1 FROM `songs` WHERE `songs`.`album_id` = `albums`.`id`
);

ALTER TABLE `albums` ADD `date_added` integer;--> statement-breakpoint
CREATE INDEX `albums_date_added_idx` ON `albums` (`date_added`,`id`);--> statement-breakpoint
-- Backfill, for the same reason the `mae-119` migration backfills its two columns: the
-- write side only recomputes an album when one of its songs is re-read, and an unchanged
-- file is never re-read — so an already-scanned library would open the grid with every
-- record dated null under the new default sort, and nothing short of a full rescan would
-- correct it.
--
-- `MAX` over `songs_album_id_idx`, which is the same aggregate the ingest transaction
-- runs per affected album.
UPDATE `albums` SET `date_added` = (
    SELECT MAX(`songs`.`created_at`) FROM `songs` WHERE `songs`.`album_id` = `albums`.`id`
);
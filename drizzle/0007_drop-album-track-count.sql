-- The albums grid no longer sorts by track count, and sorting was the only reason the
-- count was ever a column rather than an aggregate (ADR 0005). The tiles still show it;
-- it is counted over the window on screen now, which no index has to back.
--
-- The index goes first: SQLite refuses to drop a column an index is built on.
DROP INDEX `albums_track_count_idx`;--> statement-breakpoint
ALTER TABLE `albums` DROP COLUMN `track_count`;
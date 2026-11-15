CREATE TABLE `feed_fans` (
	`id` text PRIMARY KEY NOT NULL,
	`profile_url` text NOT NULL,
	`name` text NOT NULL,
	`image_url` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `feed_fans_profile_url_key` ON `feed_fans` (`profile_url`);--> statement-breakpoint
CREATE TABLE `feed_purchases` (
	`fan_id` text NOT NULL,
	`bought_url` text NOT NULL,
	`bought_title` text,
	`first_reported_at` integer NOT NULL,
	PRIMARY KEY(`fan_id`, `bought_url`),
	FOREIGN KEY (`fan_id`) REFERENCES `feed_fans`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feed_purchases_bought_url_idx` ON `feed_purchases` (`bought_url`);--> statement-breakpoint
CREATE TABLE `feed_release_urls` (
	`url` text PRIMARY KEY NOT NULL,
	`feed_item_id` text NOT NULL,
	FOREIGN KEY (`feed_item_id`) REFERENCES `feed_items`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feed_release_urls_feed_item_id_idx` ON `feed_release_urls` (`feed_item_id`);--> statement-breakpoint
-- Record the release URLs of existing feed items. Earlier versions stored only announcements, and
-- their URLs can carry HTTP, tracking queries, fragments or a trailing slash, so normalize them the way
-- normalizeBandcampReleaseUrl does before the import looks them up.
CREATE TEMP TABLE `migrating_release_urls` AS
	SELECT `id` AS `feed_item_id`, `dedupe_identifier` AS `url` FROM `feed_items`
	UNION ALL
	SELECT `id`, json_extract(`data`, '$.tralbumUrl') FROM `feed_items`
	UNION ALL
	SELECT `id`, json_extract(`source`, '$.releaseUrl') FROM `feed_items`
	WHERE json_extract(`source`, '$.releaseUrl') IS NOT NULL;
--> statement-breakpoint
UPDATE `migrating_release_urls` SET `url` = substr(`url`, 1, instr(`url`, '#') - 1) WHERE instr(`url`, '#') > 0;
--> statement-breakpoint
UPDATE `migrating_release_urls` SET `url` = substr(`url`, 1, instr(`url`, '?') - 1) WHERE instr(`url`, '?') > 0;
--> statement-breakpoint
UPDATE `migrating_release_urls` SET `url` = 'https://' || substr(`url`, 8) WHERE `url` LIKE 'http://%';
--> statement-breakpoint
UPDATE `migrating_release_urls` SET `url` = substr(`url`, 1, length(`url`) - 1) WHERE `url` LIKE '%/';
--> statement-breakpoint
-- Each URL belongs to one item; the oldest item that names it keeps it, as an import would.
INSERT OR IGNORE INTO `feed_release_urls` (`url`, `feed_item_id`)
	SELECT `urls`.`url`, `urls`.`feed_item_id`
	FROM `migrating_release_urls` AS `urls`
	JOIN `feed_items` ON `feed_items`.`id` = `urls`.`feed_item_id`
	ORDER BY `feed_items`.`ingested_at`, `feed_items`.`rowid`;
--> statement-breakpoint
DROP TABLE `migrating_release_urls`;

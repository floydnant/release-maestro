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
	`url` text NOT NULL,
	`feed_item_id` text NOT NULL,
	PRIMARY KEY(`url`, `feed_item_id`),
	FOREIGN KEY (`feed_item_id`) REFERENCES `feed_items`(`id`) ON UPDATE cascade ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `feed_release_urls_feed_item_id_idx` ON `feed_release_urls` (`feed_item_id`);--> statement-breakpoint
-- Record every URL each existing feed item answers to. Rows from earlier parser versions can carry
-- HTTP, tracking queries, fragments or a trailing slash, so normalize them the way
-- normalizeBandcampReleaseUrl does before the import looks them up.
CREATE TEMP TABLE `migrating_release_urls` AS
	SELECT `id` AS `feed_item_id`, `dedupe_identifier` AS `url` FROM `feed_items`
	UNION ALL
	SELECT `id`, json_extract(`data`, '$.tralbumUrl') FROM `feed_items`
	UNION ALL
	SELECT `id`, json_extract(`source`, '$.releaseUrl') FROM `feed_items`
	WHERE json_extract(`source`, '$.releaseUrl') IS NOT NULL
	UNION ALL
	SELECT `feed_items`.`id`, json_extract(`purchase`.`value`, '$.tralbumUrl')
	FROM `feed_items`, json_each(`feed_items`.`data`, '$.purchases') AS `purchase`;
--> statement-breakpoint
UPDATE `migrating_release_urls` SET `url` = substr(`url`, 1, instr(`url`, '#') - 1) WHERE instr(`url`, '#') > 0;
--> statement-breakpoint
UPDATE `migrating_release_urls` SET `url` = substr(`url`, 1, instr(`url`, '?') - 1) WHERE instr(`url`, '?') > 0;
--> statement-breakpoint
UPDATE `migrating_release_urls` SET `url` = 'https://' || substr(`url`, 8) WHERE `url` LIKE 'http://%';
--> statement-breakpoint
UPDATE `migrating_release_urls` SET `url` = substr(`url`, 1, length(`url`) - 1) WHERE `url` LIKE '%/';
--> statement-breakpoint
INSERT OR IGNORE INTO `feed_release_urls` (`url`, `feed_item_id`)
	SELECT `url`, `feed_item_id` FROM `migrating_release_urls`;
--> statement-breakpoint
DROP TABLE `migrating_release_urls`;
--> statement-breakpoint
-- Move fans out of each feed item's JSON, oldest item first, so the latest name and any known photo win.
INSERT INTO `feed_fans` (`id`, `profile_url`, `name`, `image_url`)
	SELECT lower(hex(randomblob(16))), `profile_url`, `name`, `image_url` FROM (
		SELECT
			json_extract(`fan`.`value`, '$.profileUrl') AS `profile_url`,
			json_extract(`fan`.`value`, '$.name') AS `name`,
			json_extract(`fan`.`value`, '$.imageUrl') AS `image_url`
		FROM `feed_items`,
			json_each(`feed_items`.`data`, '$.purchases') AS `purchase`,
			json_each(`purchase`.`value`, '$.fans') AS `fan`
		ORDER BY `feed_items`.`ingested_at`, `feed_items`.`rowid`, `purchase`.`key`, `fan`.`key`
	) WHERE true
	ON CONFLICT (`profile_url`) DO UPDATE SET
		`name` = excluded.`name`,
		`image_url` = coalesce(excluded.`image_url`, `feed_fans`.`image_url`);
--> statement-breakpoint
-- Purchase URLs in the JSON were already normalized by the parser that stored them.
INSERT INTO `feed_purchases` (`fan_id`, `bought_url`, `bought_title`, `first_reported_at`)
	SELECT `feed_fans`.`id`, json_extract(`purchase`.`value`, '$.tralbumUrl'), NULL, `feed_items`.`event_date`
	FROM `feed_items`,
		json_each(`feed_items`.`data`, '$.purchases') AS `purchase`,
		json_each(`purchase`.`value`, '$.fans') AS `fan`
	JOIN `feed_fans` ON `feed_fans`.`profile_url` = json_extract(`fan`.`value`, '$.profileUrl')
	WHERE true
	ORDER BY `feed_items`.`ingested_at`, `feed_items`.`rowid`, `purchase`.`key`, `fan`.`key`
	ON CONFLICT (`fan_id`, `bought_url`) DO UPDATE SET
		`first_reported_at` = min(`feed_purchases`.`first_reported_at`, excluded.`first_reported_at`);
--> statement-breakpoint
UPDATE `feed_items` SET `data` = json_remove(`data`, '$.purchases') WHERE json_type(`data`, '$.purchases') IS NOT NULL;

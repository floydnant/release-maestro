ALTER TABLE `labels` RENAME TO `record_labels`;
--> statement-breakpoint
DROP INDEX `labels_name_key`;
--> statement-breakpoint
CREATE UNIQUE INDEX `record_labels_name_key` ON `record_labels` (`name`);
--> statement-breakpoint
ALTER TABLE `albums` RENAME COLUMN `label_id` TO `record_label_id`;
--> statement-breakpoint
DROP INDEX `albums_label_id_idx`;
--> statement-breakpoint
CREATE INDEX `albums_record_label_id_idx` ON `albums` (`record_label_id`);
--> statement-breakpoint
ALTER TABLE `songs` RENAME COLUMN `raw_label` TO `raw_record_label`;
--> statement-breakpoint
ALTER TABLE `songs` RENAME COLUMN `label_text` TO `record_label_text`;
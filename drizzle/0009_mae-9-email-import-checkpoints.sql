CREATE TABLE `feed_email_import_checkpoints` (
	`vendor` text NOT NULL,
	`mailbox_name` text NOT NULL,
	`newest_received_at` integer NOT NULL,
	PRIMARY KEY(`vendor`, `mailbox_name`)
);

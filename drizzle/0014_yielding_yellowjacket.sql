CREATE TABLE `privacy_notices` (
	`id` text PRIMARY KEY NOT NULL,
	`version` text NOT NULL,
	`responsible_name` text NOT NULL,
	`address` text NOT NULL,
	`contact_name` text NOT NULL,
	`contact_email` text NOT NULL,
	`personal_data_categories` text NOT NULL,
	`sensitive_data_categories` text NOT NULL,
	`purposes` text NOT NULL,
	`consent_purposes` text NOT NULL,
	`limitation_means` text NOT NULL,
	`arco_procedure` text NOT NULL,
	`notice_changes` text NOT NULL,
	`processors_and_transfers` text NOT NULL,
	`effective_date` text NOT NULL,
	`approved_by` text NOT NULL,
	`approved_at` integer NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`approved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_notices_version_unique` ON `privacy_notices` (`version`);--> statement-breakpoint
CREATE INDEX `privacy_notice_published_idx` ON `privacy_notices` (`published_at`);
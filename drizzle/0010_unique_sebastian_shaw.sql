CREATE TABLE `communication_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`weekdays` text DEFAULT '1,2,3,4,5' NOT NULL,
	`start_time` text DEFAULT '08:00' NOT NULL,
	`end_time` text DEFAULT '17:00' NOT NULL,
	`updated_by` text,
	`updated_at` integer,
	FOREIGN KEY (`updated_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);

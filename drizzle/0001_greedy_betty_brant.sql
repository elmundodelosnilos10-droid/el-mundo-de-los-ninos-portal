CREATE TABLE `audit_log` (
	`id` text PRIMARY KEY NOT NULL,
	`actor_id` text,
	`action` text NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`actor_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `audit_entity_idx` ON `audit_log` (`entity_type`,`entity_id`);--> statement-breakpoint
CREATE INDEX `audit_created_idx` ON `audit_log` (`created_at`);
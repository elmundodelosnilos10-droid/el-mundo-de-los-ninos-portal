CREATE TABLE `activity_progress` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`activity_id` text NOT NULL,
	`completed_at` integer NOT NULL,
	`artwork_json` text,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `activity_progress_student_activity_idx` ON `activity_progress` (`student_id`,`activity_id`);--> statement-breakpoint
CREATE INDEX `activity_progress_student_idx` ON `activity_progress` (`student_id`,`completed_at`);
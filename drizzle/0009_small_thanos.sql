CREATE TABLE `attendance_justifications` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`group_id` text NOT NULL,
	`on_date` text NOT NULL,
	`submitted_by` text NOT NULL,
	`reason` text NOT NULL,
	`status` text DEFAULT 'pendiente' NOT NULL,
	`reviewed_by` text,
	`reviewed_at` integer,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_justifications_student_date_idx` ON `attendance_justifications` (`student_id`,`on_date`);--> statement-breakpoint
CREATE INDEX `attendance_justifications_group_date_idx` ON `attendance_justifications` (`group_id`,`on_date`);
CREATE TABLE `privacy_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`requester_id` text NOT NULL,
	`kind` text NOT NULL,
	`details` text NOT NULL,
	`status` text DEFAULT 'recibida' NOT NULL,
	`response_note` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`responded_at` integer,
	`resolved_by` text,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`requester_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`resolved_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `privacy_request_student_idx` ON `privacy_requests` (`student_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `privacy_request_requester_idx` ON `privacy_requests` (`requester_id`,`created_at`);
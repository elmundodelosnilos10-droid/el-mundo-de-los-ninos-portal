CREATE TABLE `announcement_reads` (
	`announcement_id` text NOT NULL,
	`user_id` text NOT NULL,
	`read_at` integer NOT NULL,
	PRIMARY KEY(`announcement_id`, `user_id`),
	FOREIGN KEY (`announcement_id`) REFERENCES `announcements`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `announcements` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`title` text NOT NULL,
	`body` text NOT NULL,
	`important` integer DEFAULT false NOT NULL,
	`published_by` text NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `announcements_group_idx` ON `announcements` (`group_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `attendance` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`group_id` text NOT NULL,
	`on_date` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`recorded_by` text NOT NULL,
	`modified_by` text,
	`modified_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`modified_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `attendance_student_date_idx` ON `attendance` (`student_id`,`on_date`);--> statement-breakpoint
CREATE INDEX `attendance_group_date_idx` ON `attendance` (`group_id`,`on_date`);--> statement-breakpoint
CREATE TABLE `calendar_events` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`description` text,
	`starts_at` integer NOT NULL,
	`ends_at` integer,
	`created_by` text NOT NULL,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `events_start_idx` ON `calendar_events` (`starts_at`);--> statement-breakpoint
CREATE INDEX `events_group_idx` ON `calendar_events` (`group_id`);--> statement-breakpoint
CREATE TABLE `class_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`event_id` text NOT NULL,
	`group_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`meet_url` text,
	`recording_allowed` integer DEFAULT false NOT NULL,
	`recording_file_id` text,
	FOREIGN KEY (`event_id`) REFERENCES `calendar_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recording_file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `class_sessions_event_id_unique` ON `class_sessions` (`event_id`);--> statement-breakpoint
CREATE INDEX `class_sessions_group_idx` ON `class_sessions` (`group_id`);--> statement-breakpoint
CREATE TABLE `consents` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`guardian_id` text NOT NULL,
	`purpose` text NOT NULL,
	`granted` integer NOT NULL,
	`recorded_at` integer NOT NULL,
	`expires_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `conversations` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`teacher_id` text NOT NULL,
	`guardian_id` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `conversation_participants_idx` ON `conversations` (`student_id`,`teacher_id`,`guardian_id`);--> statement-breakpoint
CREATE TABLE `files` (
	`id` text PRIMARY KEY NOT NULL,
	`object_key` text NOT NULL,
	`original_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`purpose` text NOT NULL,
	`uploaded_by` text NOT NULL,
	`group_id` text,
	`student_id` text,
	`created_at` integer NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`uploaded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `files_object_key_unique` ON `files` (`object_key`);--> statement-breakpoint
CREATE INDEX `files_group_idx` ON `files` (`group_id`);--> statement-breakpoint
CREATE INDEX `files_student_idx` ON `files` (`student_id`);--> statement-breakpoint
CREATE TABLE `materials` (
	`id` text PRIMARY KEY NOT NULL,
	`file_id` text NOT NULL,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`category` text NOT NULL,
	`published_by` text NOT NULL,
	`published_at` integer NOT NULL,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`published_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `materials_group_idx` ON `materials` (`group_id`,`published_at`);--> statement-breakpoint
CREATE TABLE `messages` (
	`id` text PRIMARY KEY NOT NULL,
	`conversation_id` text NOT NULL,
	`author_id` text NOT NULL,
	`body` text NOT NULL,
	`file_id` text,
	`sent_at` integer NOT NULL,
	FOREIGN KEY (`conversation_id`) REFERENCES `conversations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`author_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `messages_conversation_idx` ON `messages` (`conversation_id`,`sent_at`);--> statement-breakpoint
CREATE TABLE `notifications` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`href` text,
	`dedupe_key` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notifications_dedupe_key_unique` ON `notifications` (`dedupe_key`);--> statement-breakpoint
CREATE INDEX `notifications_user_idx` ON `notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `observations` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`category` text NOT NULL,
	`body` text NOT NULL,
	`visible_to_family` integer DEFAULT false NOT NULL,
	`recorded_by` text NOT NULL,
	`recorded_at` integer NOT NULL,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `observations_student_idx` ON `observations` (`student_id`,`recorded_at`);--> statement-breakpoint
CREATE TABLE `submission_files` (
	`submission_id` text NOT NULL,
	`file_id` text NOT NULL,
	PRIMARY KEY(`submission_id`, `file_id`),
	FOREIGN KEY (`submission_id`) REFERENCES `submissions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`student_id` text NOT NULL,
	`submitted_by` text NOT NULL,
	`status` text NOT NULL,
	`note` text,
	`reviewed_by` text,
	`review_note` text,
	`submitted_at` integer NOT NULL,
	`reviewed_at` integer,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`submitted_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `submissions_task_student_idx` ON `submissions` (`task_id`,`student_id`);--> statement-breakpoint
CREATE TABLE `task_files` (
	`task_id` text NOT NULL,
	`file_id` text NOT NULL,
	PRIMARY KEY(`task_id`, `file_id`),
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`file_id`) REFERENCES `files`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`group_id` text NOT NULL,
	`title` text NOT NULL,
	`instructions` text NOT NULL,
	`due_at` integer,
	`created_by` text NOT NULL,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_group_due_idx` ON `tasks` (`group_id`,`due_at`);
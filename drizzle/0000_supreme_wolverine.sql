CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`student_id` text NOT NULL,
	`group_id` text NOT NULL,
	`enrolled_at` integer NOT NULL,
	`ended_at` integer,
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `enrollments_student_group_idx` ON `enrollments` (`student_id`,`group_id`);--> statement-breakpoint
CREATE INDEX `enrollments_group_idx` ON `enrollments` (`group_id`);--> statement-breakpoint
CREATE TABLE `groups` (
	`id` text PRIMARY KEY NOT NULL,
	`year_id` text NOT NULL,
	`name` text NOT NULL,
	`stage` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`year_id`) REFERENCES `school_years`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `groups_year_name_idx` ON `groups` (`year_id`,`name`);--> statement-breakpoint
CREATE TABLE `guardians` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `guardians_user_id_unique` ON `guardians` (`user_id`);--> statement-breakpoint
CREATE TABLE `school_years` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`starts_on` text NOT NULL,
	`ends_on` text NOT NULL,
	`active` integer DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `school_years_name_unique` ON `school_years` (`name`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `student_guardians` (
	`student_id` text NOT NULL,
	`guardian_id` text NOT NULL,
	`relationship` text NOT NULL,
	`may_collect` integer DEFAULT false NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	PRIMARY KEY(`student_id`, `guardian_id`),
	FOREIGN KEY (`student_id`) REFERENCES `students`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`guardian_id`) REFERENCES `guardians`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `student_guardians_guardian_idx` ON `student_guardians` (`guardian_id`);--> statement-breakpoint
CREATE TABLE `students` (
	`id` text PRIMARY KEY NOT NULL,
	`given_name` text NOT NULL,
	`family_name` text NOT NULL,
	`birth_date` text,
	`active` integer DEFAULT true NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `students_name_idx` ON `students` (`family_name`,`given_name`);--> statement-breakpoint
CREATE TABLE `teacher_groups` (
	`teacher_id` text NOT NULL,
	`group_id` text NOT NULL,
	PRIMARY KEY(`teacher_id`, `group_id`),
	FOREIGN KEY (`teacher_id`) REFERENCES `teachers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`group_id`) REFERENCES `groups`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `teacher_groups_group_idx` ON `teacher_groups` (`group_id`);--> statement-breakpoint
CREATE TABLE `teachers` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`active` integer DEFAULT true NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `teachers_user_id_unique` ON `teachers` (`user_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_roles` (
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`assigned_by` text,
	`assigned_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `role`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_by`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `user_roles_role_idx` ON `user_roles` (`role`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);
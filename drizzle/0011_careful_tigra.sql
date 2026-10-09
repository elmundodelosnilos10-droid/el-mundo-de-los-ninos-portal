ALTER TABLE `consents` ADD `notice_version` text;--> statement-breakpoint
ALTER TABLE `consents` ADD `evidence_reference` text;--> statement-breakpoint
ALTER TABLE `consents` ADD `recorded_by` text REFERENCES user(id);
ALTER TABLE `privacy_requests` ADD `open_key` text;--> statement-breakpoint
CREATE UNIQUE INDEX `privacy_request_open_key_idx` ON `privacy_requests` (`open_key`);
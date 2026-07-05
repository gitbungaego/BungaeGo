CREATE TABLE `consents` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` varchar(50) NOT NULL,
	`version` varchar(20) NOT NULL,
	`agreedAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `consents_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `status` enum('active','suspended') DEFAULT 'active' NOT NULL;--> statement-breakpoint
CREATE INDEX `consents_user_type_idx` ON `consents` (`userId`,`type`);
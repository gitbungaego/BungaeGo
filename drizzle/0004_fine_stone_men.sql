ALTER TABLE `reservations` ADD `seatNo` varchar(10);--> statement-breakpoint
ALTER TABLE `trips` ADD `theme` varchar(20) DEFAULT 'standard' NOT NULL;--> statement-breakpoint
ALTER TABLE `trips` ADD `themeConfig` json;--> statement-breakpoint
ALTER TABLE `users` ADD `gender` enum('M','F');--> statement-breakpoint
ALTER TABLE `users` ADD `birthDate` date;--> statement-breakpoint
ALTER TABLE `users` ADD `verifiedAt` timestamp;--> statement-breakpoint
ALTER TABLE `users` ADD `verificationProvider` varchar(50);
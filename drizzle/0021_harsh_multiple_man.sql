CREATE TABLE `bungaeting_reports` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reporterId` int NOT NULL,
	`targetUserId` int NOT NULL,
	`tripId` int NOT NULL,
	`reason` varchar(300),
	`status` enum('pending','reviewed_blinded','reviewed_restricted','dismissed') NOT NULL DEFAULT 'pending',
	`handledBy` int,
	`handledAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bungaeting_reports_id` PRIMARY KEY(`id`),
	CONSTRAINT `bungaeting_reports_reporter_target_trip_idx` UNIQUE(`reporterId`,`targetUserId`,`tripId`)
);

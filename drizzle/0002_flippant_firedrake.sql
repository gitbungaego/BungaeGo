CREATE TABLE `clusters` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`groupKey` varchar(100) NOT NULL,
	`status` enum('forming','viable','merged','failed') NOT NULL DEFAULT 'forming',
	`assignedStopId` int,
	`assignedLat` decimal(10,7),
	`assignedLng` decimal(10,7),
	`isAdHocStop` boolean NOT NULL DEFAULT false,
	`size` int NOT NULL DEFAULT 0,
	`tripId` int,
	`mergedIntoClusterId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `clusters_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `ride_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`userId` int NOT NULL,
	`originAddress` varchar(400),
	`originLat` decimal(10,7) NOT NULL,
	`originLng` decimal(10,7) NOT NULL,
	`targetArrivalAt` timestamp NOT NULL,
	`groupKey` varchar(100),
	`clusterId` int,
	`tripId` int,
	`boardingPointId` int,
	`reservationId` int,
	`status` enum('pending','clustered','route_confirmed','boarded','failed_refunded') NOT NULL DEFAULT 'pending',
	`seats` int NOT NULL DEFAULT 1,
	`passengerName` varchar(100),
	`passengerPhone` varchar(20),
	`passengerEmail` varchar(320),
	`referralCodeUsed` varchar(16),
	`pointsUsed` int NOT NULL DEFAULT 0,
	`totalAmount` int NOT NULL,
	`paymentId` varchar(200),
	`paymentMethod` varchar(50),
	`refundedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `ride_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `stop_candidates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`address` varchar(400),
	`lat` decimal(10,7) NOT NULL,
	`lng` decimal(10,7) NOT NULL,
	`capacity` int,
	`safeForCoach` boolean NOT NULL DEFAULT true,
	`active` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `stop_candidates_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `events` ADD `autoMatchEnabled` boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `events` ADD `autoMatchPricePerSeat` int;--> statement-breakpoint
ALTER TABLE `events` ADD `matchingFrozenAt` timestamp;--> statement-breakpoint
ALTER TABLE `trips` ADD `sourceClusterId` int;--> statement-breakpoint
CREATE INDEX `ride_requests_event_group_idx` ON `ride_requests` (`eventId`,`groupKey`);--> statement-breakpoint
CREATE INDEX `ride_requests_status_idx` ON `ride_requests` (`status`);
CREATE TABLE `boarding_points` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tripId` int NOT NULL,
	`name` varchar(200) NOT NULL,
	`address` varchar(400),
	`lat` decimal(10,7),
	`lng` decimal(10,7),
	`pickupTime` timestamp,
	`order` int NOT NULL DEFAULT 0,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `boarding_points_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `events` (
	`id` int AUTO_INCREMENT NOT NULL,
	`title` varchar(200) NOT NULL,
	`category` enum('concert','sports','festival','awards','exhibition','other') NOT NULL DEFAULT 'other',
	`eventDate` timestamp NOT NULL,
	`venue` varchar(200) NOT NULL,
	`address` varchar(400),
	`lat` decimal(10,7),
	`lng` decimal(10,7),
	`imageUrl` text,
	`description` text,
	`status` enum('active','cancelled','completed') NOT NULL DEFAULT 'active',
	`creatorId` int,
	`organizerName` varchar(200),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `events_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `points` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('referral_earn','booking_earn','admin_grant','usage','refund','welcome') NOT NULL,
	`amount` int NOT NULL,
	`balanceAfter` int NOT NULL DEFAULT 0,
	`description` varchar(300),
	`refId` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `points_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referrals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`referrerId` int NOT NULL,
	`refereeId` int NOT NULL,
	`reservationId` int,
	`referrerPoints` int NOT NULL DEFAULT 2000,
	`refereePoints` int NOT NULL DEFAULT 1000,
	`status` enum('pending','completed','cancelled') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `referrals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `reservations` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`tripId` int NOT NULL,
	`boardingPointId` int,
	`seats` int NOT NULL DEFAULT 1,
	`status` enum('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`totalAmount` int NOT NULL,
	`pointsUsed` int NOT NULL DEFAULT 0,
	`passengerName` varchar(100),
	`passengerPhone` varchar(20),
	`passengerEmail` varchar(320),
	`paymentId` varchar(200),
	`paymentMethod` varchar(50),
	`qrToken` varchar(64),
	`referralCode` varchar(16),
	`cancelledAt` timestamp,
	`cancelReason` text,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `reservations_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `trips` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`mode` enum('bus','van') NOT NULL DEFAULT 'bus',
	`status` enum('collecting','confirmed','in_progress','completed','cancelled') NOT NULL DEFAULT 'collecting',
	`minCount` int NOT NULL DEFAULT 15,
	`maxCount` int NOT NULL DEFAULT 45,
	`currentCount` int NOT NULL DEFAULT 0,
	`price` int NOT NULL,
	`departureAt` timestamp NOT NULL,
	`returnAt` timestamp,
	`isRoundTrip` boolean NOT NULL DEFAULT false,
	`operatorName` varchar(200),
	`operatorContact` varchar(50),
	`notes` text,
	`creatorId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `trips_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `phone` varchar(20);--> statement-breakpoint
ALTER TABLE `users` ADD `referralCode` varchar(16);--> statement-breakpoint
ALTER TABLE `users` ADD `pointsBalance` int DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `users` ADD CONSTRAINT `users_referralCode_unique` UNIQUE(`referralCode`);
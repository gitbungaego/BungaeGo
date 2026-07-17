CREATE TABLE `point_transactions` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`type` enum('EARN_REFERRAL','EARN_PROMO','SPEND','REFUND','EXPIRE','ADMIN_ADJUST') NOT NULL,
	`amount` int NOT NULL,
	`balanceAfter` int NOT NULL,
	`relatedTripId` int,
	`relatedReferralEntryId` int,
	`memo` varchar(255),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `point_transactions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `referral_entries` (
	`id` int AUTO_INCREMENT NOT NULL,
	`tripId` int NOT NULL,
	`reservationId` int NOT NULL,
	`payerUserId` int NOT NULL,
	`referrerUserId` int NOT NULL,
	`code` varchar(16) NOT NULL,
	`source` enum('LINK_PREFILL','MANUAL') NOT NULL DEFAULT 'MANUAL',
	`appliedRate` decimal(4,3) NOT NULL,
	`referrerIsParticipant` boolean NOT NULL,
	`paidAmount` int NOT NULL,
	`status` enum('PENDING','COMPLETED','FLAGGED','REJECTED','VOID') NOT NULL DEFAULT 'PENDING',
	`flagReason` varchar(200),
	`rewardAmount` int,
	`rewardTransactionId` int,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`completedAt` timestamp,
	CONSTRAINT `referral_entries_id` PRIMARY KEY(`id`),
	CONSTRAINT `referral_entries_reservationId_unique` UNIQUE(`reservationId`)
);
--> statement-breakpoint
CREATE TABLE `reward_config` (
	`key` varchar(64) NOT NULL,
	`value` varchar(255) NOT NULL,
	CONSTRAINT `reward_config_key` PRIMARY KEY(`key`)
);
--> statement-breakpoint
ALTER TABLE `users` ADD `pointsExpiresAt` timestamp;--> statement-breakpoint
CREATE INDEX `idx_pt_user_created` ON `point_transactions` (`userId`,`createdAt`);--> statement-breakpoint
CREATE INDEX `idx_re_trip` ON `referral_entries` (`tripId`);--> statement-breakpoint
CREATE INDEX `idx_re_referrer` ON `referral_entries` (`referrerUserId`);
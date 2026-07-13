CREATE TABLE `bungaeting_proposal_interests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`proposalId` int NOT NULL,
	`userId` int NOT NULL,
	`genderModePreference` enum('any','half','female_only','male_only'),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `bungaeting_proposal_interests_id` PRIMARY KEY(`id`),
	CONSTRAINT `bungaeting_proposal_interests_proposal_user_idx` UNIQUE(`proposalId`,`userId`)
);
--> statement-breakpoint
CREATE TABLE `bungaeting_trip_proposals` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`proposerId` int NOT NULL,
	`proposedDate` timestamp NOT NULL,
	`notes` varchar(300),
	`status` enum('open','converted','closed') NOT NULL DEFAULT 'open',
	`convertedTripId` int,
	`rewardGrantedAt` timestamp,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bungaeting_trip_proposals_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `bungaeting_trip_proposals_event_idx` ON `bungaeting_trip_proposals` (`eventId`);
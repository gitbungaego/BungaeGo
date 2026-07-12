CREATE TABLE `point_interests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`rallyPointCandidateId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `point_interests_id` PRIMARY KEY(`id`),
	CONSTRAINT `point_interests_event_candidate_user_idx` UNIQUE(`eventId`,`rallyPointCandidateId`,`userId`)
);

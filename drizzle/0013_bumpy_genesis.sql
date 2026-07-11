CREATE TABLE `event_likes` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`userId` int NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `event_likes_id` PRIMARY KEY(`id`),
	CONSTRAINT `event_likes_event_user_idx` UNIQUE(`eventId`,`userId`)
);

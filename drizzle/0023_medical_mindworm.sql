CREATE TABLE `event_requests` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`category` varchar(30) NOT NULL,
	`title` varchar(200) NOT NULL,
	`startDate` date NOT NULL,
	`endDate` date,
	`destination` varchar(300) NOT NULL,
	`origin` varchar(300) NOT NULL,
	`arrivalPreference` enum('md_sale','ktx','ticket_booth','flexible','etc') NOT NULL,
	`arrivalNote` varchar(300),
	`inquiry` varchar(500),
	`phone` varchar(20) NOT NULL,
	`email` varchar(320) NOT NULL,
	`status` enum('pending','done') NOT NULL DEFAULT 'pending',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `event_requests_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `shuttle_demands` (
	`id` int AUTO_INCREMENT NOT NULL,
	`eventId` int NOT NULL,
	`userId` int NOT NULL,
	`area` enum('capital','other') NOT NULL,
	`stopLabel` varchar(100) NOT NULL,
	`neighborhood` varchar(100),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `shuttle_demands_id` PRIMARY KEY(`id`),
	CONSTRAINT `shuttle_demands_event_user_idx` UNIQUE(`eventId`,`userId`)
);

CREATE TABLE `rally_point_candidates` (
	`id` int AUTO_INCREMENT NOT NULL,
	`name` varchar(200) NOT NULL,
	`region` varchar(100) NOT NULL,
	`lat` decimal(10,7) NOT NULL,
	`lng` decimal(10,7) NOT NULL,
	`busAccessible` boolean NOT NULL DEFAULT false,
	`notes` varchar(300),
	`isActive` boolean NOT NULL DEFAULT true,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `rally_point_candidates_id` PRIMARY KEY(`id`),
	CONSTRAINT `rally_point_candidates_name_region_idx` UNIQUE(`name`,`region`)
);

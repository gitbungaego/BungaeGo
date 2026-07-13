CREATE TABLE `bungaeting_preferences` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`preferredGenderMode` enum('any','half','female_only','male_only'),
	`preferredAgeMin` int,
	`preferredAgeMax` int,
	`preferredRegion` varchar(100),
	`preferredTheme` varchar(100),
	`smsOptIn` boolean NOT NULL DEFAULT false,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bungaeting_preferences_id` PRIMARY KEY(`id`),
	CONSTRAINT `bungaeting_preferences_user_idx` UNIQUE(`userId`)
);
--> statement-breakpoint
CREATE TABLE `bungaeting_profiles` (
	`id` int AUTO_INCREMENT NOT NULL,
	`userId` int NOT NULL,
	`nickname` varchar(30) NOT NULL,
	`photoUrl` text,
	`bio` varchar(200),
	`gender` enum('M','F') NOT NULL,
	`birthDate` date NOT NULL,
	`verifiedAt` timestamp,
	`verificationProvider` varchar(50),
	`tosAgreedAt` timestamp,
	`status` enum('active','blinded','restricted') NOT NULL DEFAULT 'active',
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `bungaeting_profiles_id` PRIMARY KEY(`id`),
	CONSTRAINT `bungaeting_profiles_user_idx` UNIQUE(`userId`)
);

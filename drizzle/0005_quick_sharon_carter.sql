CREATE TABLE `payment_items` (
	`id` int AUTO_INCREMENT NOT NULL,
	`paymentId` int NOT NULL,
	`type` enum('fare','theme_fee','discount') NOT NULL,
	`amount` int NOT NULL,
	`label` varchar(100) NOT NULL,
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `payment_items_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE TABLE `payments` (
	`id` int AUTO_INCREMENT NOT NULL,
	`reservationId` int NOT NULL,
	`totalAmount` int NOT NULL,
	`status` enum('pending','paid','cancelled','refunded') NOT NULL DEFAULT 'pending',
	`method` enum('card','kakaopay','naverpay','tosspay','transfer','vbank','mock') NOT NULL,
	`chargeType` enum('billing','prepaid') NOT NULL DEFAULT 'prepaid',
	`paidAt` timestamp,
	`cancelledAt` timestamp,
	`cancelReason` enum('user_request','trip_not_confirmed','admin','payment_failed'),
	`cancelNote` varchar(300),
	`createdAt` timestamp NOT NULL DEFAULT (now()),
	`updatedAt` timestamp NOT NULL DEFAULT (now()) ON UPDATE CURRENT_TIMESTAMP,
	CONSTRAINT `payments_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `payment_items_payment_idx` ON `payment_items` (`paymentId`);--> statement-breakpoint
CREATE INDEX `payments_reservation_idx` ON `payments` (`reservationId`);
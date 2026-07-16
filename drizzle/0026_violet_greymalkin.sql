ALTER TABLE `reservations` ADD `ticketType` enum('round','outbound','inbound') DEFAULT 'round' NOT NULL;--> statement-breakpoint
ALTER TABLE `trips` ADD `oneWayPrice` int;
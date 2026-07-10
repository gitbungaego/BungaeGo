ALTER TABLE `payments` ADD `rideRequestId` int;--> statement-breakpoint
ALTER TABLE `payments` ADD `refundedAmount` int DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX `payments_ride_request_idx` ON `payments` (`rideRequestId`);
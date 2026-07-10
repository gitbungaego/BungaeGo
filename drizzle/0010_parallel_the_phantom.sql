ALTER TABLE `payments` MODIFY COLUMN `reservationId` int;--> statement-breakpoint
ALTER TABLE `payments` MODIFY COLUMN `method` enum('card','kakaopay','naverpay','tosspay','transfer','vbank','mock','toss') NOT NULL;--> statement-breakpoint
ALTER TABLE `payments` ADD `orderId` varchar(64);--> statement-breakpoint
ALTER TABLE `payments` ADD `tossPaymentKey` varchar(200);--> statement-breakpoint
ALTER TABLE `payments` ADD `orderContext` json;--> statement-breakpoint
ALTER TABLE `payments` ADD CONSTRAINT `payments_order_id_idx` UNIQUE(`orderId`);
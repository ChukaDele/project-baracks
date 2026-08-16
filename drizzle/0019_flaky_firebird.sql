DROP INDEX `agent_providers_name_unique`;--> statement-breakpoint
ALTER TABLE `agent_providers` ADD `account_label` text DEFAULT 'default' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_providers_name_account` ON `agent_providers` (`name`,`account_label`);
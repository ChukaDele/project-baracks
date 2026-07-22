CREATE TABLE `agent_models` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_ref` text NOT NULL,
	`routing_class` text DEFAULT 'unknown' NOT NULL,
	`visible` integer DEFAULT false NOT NULL,
	`authenticated` integer DEFAULT false NOT NULL,
	`availability` text DEFAULT 'unknown' NOT NULL,
	`billing_mode` text DEFAULT 'unknown' NOT NULL,
	`prohibited` integer DEFAULT false NOT NULL,
	`prohibited_reason` text,
	`last_probed_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `agent_providers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_models_provider_ref` ON `agent_models` (`provider_id`,`model_ref`);--> statement-breakpoint
CREATE TABLE `agent_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`executable` text,
	`version` text,
	`last_discovered_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_providers_name_unique` ON `agent_providers` (`name`);--> statement-breakpoint
CREATE TABLE `agent_run_events` (
	`id` text PRIMARY KEY NOT NULL,
	`run_id` text NOT NULL,
	`seq` integer NOT NULL,
	`type` text NOT NULL,
	`payload_json` text DEFAULT '{}' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_events_run_seq` ON `agent_run_events` (`run_id`,`seq`);--> statement-breakpoint
CREATE TABLE `agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text,
	`model_ref` text NOT NULL,
	`purpose` text NOT NULL,
	`billing_mode` text NOT NULL,
	`routing_reason` text NOT NULL,
	`independence_loss` text,
	`allowance_state` text,
	`worktree_id` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`session_ref` text,
	`started_at` text,
	`ended_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `agent_providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_id`) REFERENCES `agent_models`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `agent_runs_task` ON `agent_runs` (`task_id`);--> statement-breakpoint
CREATE TABLE `decision_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text,
	`task_id` text,
	`category` text NOT NULL,
	`question` text NOT NULL,
	`context_json` text,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text,
	`resolved_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref` text,
	`summary` text NOT NULL,
	`data_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `evidence_task` ON `evidence` (`task_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`repo_path` text NOT NULL,
	`github_repo` text,
	`config_json` text NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `projects_name_unique` ON `projects` (`name`);--> statement-breakpoint
CREATE TABLE `review_findings` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`agent_run_id` text,
	`severity` text NOT NULL,
	`summary` text NOT NULL,
	`detail` text,
	`status` text DEFAULT 'open' NOT NULL,
	`independent_review` integer DEFAULT false NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `roadmap_items` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`stable_ref` text NOT NULL,
	`title` text NOT NULL,
	`source_status` text,
	`source_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roadmap_items_project_ref` ON `roadmap_items` (`project_id`,`stable_ref`);--> statement-breakpoint
CREATE TABLE `roadmap_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`roadmap_item_id` text NOT NULL,
	`proposed_by_run_id` text,
	`idempotency_key` text NOT NULL,
	`changes_json` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence_ids_json` text DEFAULT '[]' NOT NULL,
	`dry_run_diff` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`applied_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`roadmap_item_id`) REFERENCES `roadmap_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `roadmap_updates_idempotency_key_unique` ON `roadmap_updates` (`idempotency_key`);--> statement-breakpoint
CREATE TABLE `task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_dependencies_pair` ON `task_dependencies` (`task_id`,`depends_on_task_id`);--> statement-breakpoint
CREATE TABLE `task_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`roadmap_item_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`suggested_by` text DEFAULT 'human' NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` text,
	`decision_note` text,
	`approved_task_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`roadmap_item_id`) REFERENCES `roadmap_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`roadmap_item_id` text,
	`suggestion_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`complexity` text DEFAULT 'bounded' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`roadmap_item_id`) REFERENCES `roadmap_items`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `tasks_project` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_roadmap_item` ON `tasks` (`roadmap_item_id`);--> statement-breakpoint
CREATE TABLE `usage_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text,
	`agent_run_id` text,
	`kind` text NOT NULL,
	`data_json` text DEFAULT '{}' NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `agent_providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_id`) REFERENCES `agent_models`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `verification_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`agent_run_id` text,
	`command` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`exit_code` integer,
	`output_summary` text,
	`started_at` text,
	`ended_at` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action
);

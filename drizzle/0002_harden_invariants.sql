CREATE TABLE `discovery_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`provider_id` text NOT NULL,
	`model_id` text,
	`observed_json` text NOT NULL,
	`source` text NOT NULL,
	`confidence` text NOT NULL,
	`observed_at` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `agent_providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_id`) REFERENCES `agent_models`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "discovery_observations_source_valid" CHECK("source" IN ('registry', 'cli', 'probe', 'run_outcome', 'human')),
	CONSTRAINT "discovery_observations_confidence_valid" CHECK("confidence" IN ('configured', 'inferred', 'observed'))
);
--> statement-breakpoint
CREATE INDEX `discovery_observations_model` ON `discovery_observations` (`model_id`);--> statement-breakpoint
CREATE TABLE `execution_policy_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`allowed` integer NOT NULL,
	`executable` text NOT NULL,
	`argv_json` text NOT NULL,
	`cwd` text,
	`reason` text NOT NULL,
	`stripped_env_json` text DEFAULT '[]' NOT NULL,
	`authorized_env_json` text DEFAULT '[]' NOT NULL,
	`env_decision_id` text,
	`at` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `routing_checkpoints` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`purpose` text NOT NULL,
	`reason` text NOT NULL,
	`paid_options_json` text DEFAULT '[]' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "routing_checkpoints_purpose_valid" CHECK("purpose" IN ('implementation', 'verification', 'review', 'repair', 'analysis'))
);
--> statement-breakpoint
CREATE INDEX `routing_checkpoints_task` ON `routing_checkpoints` (`task_id`);--> statement-breakpoint
CREATE TABLE `task_claims` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`worker_id` text NOT NULL,
	`attempt` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`lease_expires_at` text NOT NULL,
	`heartbeat_at` text NOT NULL,
	`outcome_reason` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_claims_status_valid" CHECK("status" IN ('active', 'completed', 'released', 'expired')),
	CONSTRAINT "task_claims_attempt_positive" CHECK(attempt >= 1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `task_claims_task_attempt` ON `task_claims` (`task_id`,`attempt`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_claims_one_active` ON `task_claims` (`task_id`) WHERE status = 'active';--> statement-breakpoint
CREATE INDEX `task_claims_status` ON `task_claims` (`status`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review_findings` (
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
	FOREIGN KEY (`agent_run_id`,`task_id`) REFERENCES `agent_runs`(`id`,`task_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_findings_severity_valid" CHECK("severity" IN ('info', 'minor', 'major', 'critical')),
	CONSTRAINT "review_findings_status_valid" CHECK("status" IN ('open', 'accepted', 'rejected', 'fixed'))
);
--> statement-breakpoint
INSERT INTO `__new_review_findings`("id", "task_id", "agent_run_id", "severity", "summary", "detail", "status", "independent_review", "created_at", "updated_at") SELECT "id", "task_id", "agent_run_id", "severity", "summary", "detail", "status", "independent_review", "created_at", "updated_at" FROM `review_findings`;--> statement-breakpoint
DROP TABLE `review_findings`;--> statement-breakpoint
ALTER TABLE `__new_review_findings` RENAME TO `review_findings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `review_findings_task` ON `review_findings` (`task_id`);--> statement-breakpoint
CREATE TABLE `__new_task_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`roadmap_item_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`rationale` text DEFAULT '' NOT NULL,
	`suggested_by` text DEFAULT 'human' NOT NULL,
	`source_type` text DEFAULT 'human' NOT NULL,
	`source_ref` text,
	`scope_fingerprint` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`decided_at` text,
	`decision_note` text,
	`approved_task_id` text,
	`superseded_by_id` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`superseded_by_id`) REFERENCES `task_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`roadmap_item_id`,`project_id`) REFERENCES `roadmap_items`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_suggestions_status_valid" CHECK("status" IN ('pending', 'approved', 'rejected')),
	CONSTRAINT "task_suggestions_source_type_valid" CHECK("source_type" IN ('human', 'agent', 'test_failure', 'review_finding', 'evidence', 'run', 'task')),
	CONSTRAINT "task_suggestions_approved_has_task" CHECK((status = 'approved') = (approved_task_id IS NOT NULL)),
	CONSTRAINT "task_suggestions_source_ref_present" CHECK(source_type IN ('human', 'agent') OR source_ref IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_task_suggestions`("id", "project_id", "roadmap_item_id", "title", "description", "rationale", "suggested_by", "source_type", "source_ref", "scope_fingerprint", "status", "decided_at", "decision_note", "approved_task_id", "superseded_by_id", "created_at", "updated_at") SELECT "id", "project_id", "roadmap_item_id", "title", "description", "rationale", "suggested_by", CASE WHEN "suggested_by" = 'human' THEN 'human' ELSE 'agent' END AS "source_type", NULL AS "source_ref", 'legacy:' || "id" AS "scope_fingerprint", "status", "decided_at", "decision_note", "approved_task_id", NULL AS "superseded_by_id", "created_at", "updated_at" FROM `task_suggestions`;--> statement-breakpoint
DROP TABLE `task_suggestions`;--> statement-breakpoint
ALTER TABLE `__new_task_suggestions` RENAME TO `task_suggestions`;--> statement-breakpoint
CREATE INDEX `task_suggestions_project_fingerprint` ON `task_suggestions` (`project_id`,`scope_fingerprint`);--> statement-breakpoint
CREATE UNIQUE INDEX `task_suggestions_pending_fingerprint` ON `task_suggestions` (`project_id`,`scope_fingerprint`) WHERE status = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX `task_suggestions_approved_task` ON `task_suggestions` (`approved_task_id`) WHERE approved_task_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`roadmap_item_id` text,
	`suggestion_id` text,
	`title` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`complexity` text DEFAULT 'bounded' NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`completion_criteria_json` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggestion_id`) REFERENCES `task_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`roadmap_item_id`,`project_id`) REFERENCES `roadmap_items`(`id`,`project_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "tasks_status_persistable" CHECK("status" IN ('draft', 'ready', 'queued', 'running', 'verifying', 'reviewing', 'repairing', 'needs_decision', 'ready_to_merge', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "tasks_complexity_valid" CHECK("complexity" IN ('routine', 'bounded', 'complex', 'architectural'))
);
--> statement-breakpoint
INSERT INTO `__new_tasks`("id", "project_id", "roadmap_item_id", "suggestion_id", "title", "description", "status", "complexity", "version", "completion_criteria_json", "created_at", "updated_at") SELECT "id", "project_id", "roadmap_item_id", "suggestion_id", "title", "description", "status", "complexity", 0 AS "version", NULL AS "completion_criteria_json", "created_at", "updated_at" FROM `tasks`;--> statement-breakpoint
DROP TABLE `tasks`;--> statement-breakpoint
ALTER TABLE `__new_tasks` RENAME TO `tasks`;--> statement-breakpoint
CREATE INDEX `tasks_project` ON `tasks` (`project_id`);--> statement-breakpoint
CREATE INDEX `tasks_roadmap_item` ON `tasks` (`roadmap_item_id`);--> statement-breakpoint
CREATE INDEX `tasks_status` ON `tasks` (`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `tasks_suggestion_unique` ON `tasks` (`suggestion_id`) WHERE suggestion_id IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_verification_runs` (
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
	FOREIGN KEY (`agent_run_id`,`task_id`) REFERENCES `agent_runs`(`id`,`task_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "verification_runs_status_valid" CHECK("status" IN ('pending', 'running', 'passed', 'failed'))
);
--> statement-breakpoint
INSERT INTO `__new_verification_runs`("id", "task_id", "agent_run_id", "command", "status", "exit_code", "output_summary", "started_at", "ended_at", "created_at") SELECT "id", "task_id", "agent_run_id", "command", "status", "exit_code", "output_summary", "started_at", "ended_at", "created_at" FROM `verification_runs`;--> statement-breakpoint
DROP TABLE `verification_runs`;--> statement-breakpoint
ALTER TABLE `__new_verification_runs` RENAME TO `verification_runs`;--> statement-breakpoint
CREATE INDEX `verification_runs_task` ON `verification_runs` (`task_id`);--> statement-breakpoint
CREATE TABLE `__new_agent_models` (
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
	`next_probe_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`provider_id`) REFERENCES `agent_providers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_models_routing_class_valid" CHECK("routing_class" IN ('fable', 'opus', 'sonnet', 'codex', 'unknown')),
	CONSTRAINT "agent_models_availability_valid" CHECK("availability" IN ('available', 'rate_limited', 'exhausted', 'unknown')),
	CONSTRAINT "agent_models_billing_mode_valid" CHECK("billing_mode" IN ('subscription_included', 'usage_credits', 'api_billing', 'unknown'))
);
--> statement-breakpoint
INSERT INTO `__new_agent_models`("id", "provider_id", "model_ref", "routing_class", "visible", "authenticated", "availability", "billing_mode", "prohibited", "prohibited_reason", "last_probed_at", "next_probe_at", "created_at", "updated_at") SELECT "id", "provider_id", "model_ref", "routing_class", "visible", "authenticated", "availability", "billing_mode", "prohibited", "prohibited_reason", "last_probed_at", NULL AS "next_probe_at", "created_at", "updated_at" FROM `agent_models`;--> statement-breakpoint
DROP TABLE `agent_models`;--> statement-breakpoint
ALTER TABLE `__new_agent_models` RENAME TO `agent_models`;--> statement-breakpoint
CREATE UNIQUE INDEX `agent_models_provider_ref` ON `agent_models` (`provider_id`,`model_ref`);--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `event_key` text;--> statement-breakpoint
ALTER TABLE `agent_run_events` ADD `payload_hash` text NOT NULL DEFAULT 'legacy';--> statement-breakpoint
CREATE UNIQUE INDEX `agent_run_events_run_key` ON `agent_run_events` (`run_id`,`event_key`) WHERE event_key IS NOT NULL;--> statement-breakpoint
CREATE TABLE `__new_agent_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`claim_id` text,
	`provider_id` text NOT NULL,
	`model_id` text,
	`model_ref` text NOT NULL,
	`purpose` text NOT NULL,
	`billing_mode` text NOT NULL,
	`routing_reason` text NOT NULL,
	`paid_usage_decision_id` text,
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
	FOREIGN KEY (`claim_id`) REFERENCES `task_claims`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`provider_id`) REFERENCES `agent_providers`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`model_id`) REFERENCES `agent_models`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`paid_usage_decision_id`) REFERENCES `decision_requests`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "agent_runs_purpose_valid" CHECK("purpose" IN ('implementation', 'verification', 'review', 'repair', 'analysis')),
	CONSTRAINT "agent_runs_status_valid" CHECK("status" IN ('pending', 'running', 'succeeded', 'failed', 'cancelled', 'timed_out', 'checkpointed')),
	CONSTRAINT "agent_runs_billing_mode_valid" CHECK("billing_mode" IN ('subscription_included', 'usage_credits', 'api_billing', 'unknown')),
	CONSTRAINT "agent_runs_paid_requires_decision" CHECK(billing_mode NOT IN ('usage_credits', 'api_billing') OR paid_usage_decision_id IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_agent_runs`("id", "task_id", "claim_id", "provider_id", "model_id", "model_ref", "purpose", "billing_mode", "routing_reason", "paid_usage_decision_id", "independence_loss", "allowance_state", "worktree_id", "status", "session_ref", "started_at", "ended_at", "created_at", "updated_at") SELECT "id", "task_id", NULL AS "claim_id", "provider_id", "model_id", "model_ref", "purpose", "billing_mode", "routing_reason", NULL AS "paid_usage_decision_id", "independence_loss", "allowance_state", "worktree_id", "status", "session_ref", "started_at", "ended_at", "created_at", "updated_at" FROM `agent_runs`;--> statement-breakpoint
DROP TABLE `agent_runs`;--> statement-breakpoint
ALTER TABLE `__new_agent_runs` RENAME TO `agent_runs`;--> statement-breakpoint
CREATE INDEX `agent_runs_task` ON `agent_runs` (`task_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `agent_runs_id_task` ON `agent_runs` (`id`,`task_id`);--> statement-breakpoint
CREATE TABLE `__new_roadmap_updates` (
	`id` text PRIMARY KEY NOT NULL,
	`roadmap_item_id` text NOT NULL,
	`proposed_by_run_id` text,
	`idempotency_key` text NOT NULL,
	`payload_hash` text NOT NULL,
	`source_revision` text,
	`changes_json` text NOT NULL,
	`rationale` text NOT NULL,
	`evidence_ids_json` text DEFAULT '[]' NOT NULL,
	`dry_run_diff` text,
	`dry_run_at` text,
	`status` text DEFAULT 'proposed' NOT NULL,
	`applied_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`roadmap_item_id`) REFERENCES `roadmap_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "roadmap_updates_status_valid" CHECK("status" IN ('proposed', 'applied', 'rejected', 'superseded')),
	CONSTRAINT "roadmap_updates_applied_needs_dry_run" CHECK(status <> 'applied' OR (applied_at IS NOT NULL AND dry_run_diff IS NOT NULL AND dry_run_at IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_roadmap_updates`("id", "roadmap_item_id", "proposed_by_run_id", "idempotency_key", "payload_hash", "source_revision", "changes_json", "rationale", "evidence_ids_json", "dry_run_diff", "dry_run_at", "status", "applied_at", "created_at", "updated_at") SELECT "id", "roadmap_item_id", "proposed_by_run_id", "idempotency_key", 'legacy:' || "id" AS "payload_hash", NULL AS "source_revision", "changes_json", "rationale", "evidence_ids_json", "dry_run_diff", CASE WHEN "status" = 'applied' THEN COALESCE("applied_at", "created_at") ELSE NULL END AS "dry_run_at", "status", "applied_at", "created_at", "updated_at" FROM `roadmap_updates`;--> statement-breakpoint
DROP TABLE `roadmap_updates`;--> statement-breakpoint
ALTER TABLE `__new_roadmap_updates` RENAME TO `roadmap_updates`;--> statement-breakpoint
CREATE UNIQUE INDEX `roadmap_updates_idempotency_key_unique` ON `roadmap_updates` (`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `roadmap_items_id_project` ON `roadmap_items` (`id`,`project_id`);--> statement-breakpoint
CREATE TABLE `__new_decision_requests` (
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
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "decision_requests_status_valid" CHECK("status" IN ('open', 'approved', 'rejected', 'expired')),
	CONSTRAINT "decision_requests_resolved_has_time" CHECK(status NOT IN ('approved', 'rejected') OR resolved_at IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_decision_requests`("id", "project_id", "task_id", "category", "question", "context_json", "status", "resolution", "resolved_at", "created_at", "updated_at") SELECT "id", "project_id", "task_id", "category", "question", "context_json", "status", "resolution", "resolved_at", "created_at", "updated_at" FROM `decision_requests`;--> statement-breakpoint
DROP TABLE `decision_requests`;--> statement-breakpoint
ALTER TABLE `__new_decision_requests` RENAME TO `decision_requests`;--> statement-breakpoint
CREATE TABLE `__new_evidence` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`kind` text NOT NULL,
	`ref` text,
	`summary` text NOT NULL,
	`data_json` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "evidence_kind_valid" CHECK("kind" IN ('test_result', 'verification_run', 'review', 'artifact', 'log', 'other')),
	CONSTRAINT "evidence_linked_kinds_have_ref" CHECK(kind NOT IN ('verification_run', 'review') OR ref IS NOT NULL)
);
--> statement-breakpoint
INSERT INTO `__new_evidence`("id", "task_id", "kind", "ref", "summary", "data_json", "created_at") SELECT "id", "task_id", "kind", "ref", "summary", "data_json", "created_at" FROM `evidence`;--> statement-breakpoint
DROP TABLE `evidence`;--> statement-breakpoint
ALTER TABLE `__new_evidence` RENAME TO `evidence`;--> statement-breakpoint
CREATE INDEX `evidence_task` ON `evidence` (`task_id`);--> statement-breakpoint
CREATE TABLE `__new_task_dependencies` (
	`id` text PRIMARY KEY NOT NULL,
	`task_id` text NOT NULL,
	`depends_on_task_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`depends_on_task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "task_dependencies_not_self" CHECK(task_id <> depends_on_task_id)
);
--> statement-breakpoint
INSERT INTO `__new_task_dependencies`("id", "task_id", "depends_on_task_id", "created_at") SELECT "id", "task_id", "depends_on_task_id", "created_at" FROM `task_dependencies`;--> statement-breakpoint
DROP TABLE `task_dependencies`;--> statement-breakpoint
ALTER TABLE `__new_task_dependencies` RENAME TO `task_dependencies`;--> statement-breakpoint
CREATE UNIQUE INDEX `task_dependencies_pair` ON `task_dependencies` (`task_id`,`depends_on_task_id`);--> statement-breakpoint
CREATE TABLE `__new_usage_observations` (
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
	FOREIGN KEY (`agent_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "usage_observations_kind_valid" CHECK("kind" IN ('tokens', 'rate_limit', 'allowance', 'cost', 'exhaustion'))
);
--> statement-breakpoint
INSERT INTO `__new_usage_observations`("id", "provider_id", "model_id", "agent_run_id", "kind", "data_json", "observed_at", "created_at") SELECT "id", "provider_id", "model_id", "agent_run_id", "kind", "data_json", "observed_at", "created_at" FROM `usage_observations`;--> statement-breakpoint
DROP TABLE `usage_observations`;--> statement-breakpoint
ALTER TABLE `__new_usage_observations` RENAME TO `usage_observations`;--> statement-breakpoint
CREATE TABLE `__new_worktrees` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`task_id` text,
	`path` text NOT NULL,
	`branch` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `tasks`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "worktrees_status_valid" CHECK("status" IN ('active', 'merged', 'removed'))
);
--> statement-breakpoint
INSERT INTO `__new_worktrees`("id", "project_id", "task_id", "path", "branch", "status", "created_at", "updated_at") SELECT "id", "project_id", "task_id", "path", "branch", "status", "created_at", "updated_at" FROM `worktrees`;--> statement-breakpoint
DROP TABLE `worktrees`;--> statement-breakpoint
ALTER TABLE `__new_worktrees` RENAME TO `worktrees`;
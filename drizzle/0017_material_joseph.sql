CREATE TABLE `capability_verification_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`capability_id` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`operation` text NOT NULL,
	`fixture_json` text NOT NULL,
	`expected_json` text NOT NULL,
	`actual_json` text NOT NULL,
	`validator` text NOT NULL,
	`environment_json` text NOT NULL,
	`security_json` text NOT NULL,
	`status` text NOT NULL,
	`verification_run_id` text,
	`created_at` text NOT NULL,
	FOREIGN KEY (`capability_id`) REFERENCES `capability_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verification_run_id`) REFERENCES `verification_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "capability_verification_artifacts_status_valid" CHECK("status" IN ('passed', 'failed'))
);
--> statement-breakpoint
CREATE INDEX `capability_verification_artifacts_capability` ON `capability_verification_artifacts` (`capability_id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_capability_events` (
	`id` text PRIMARY KEY NOT NULL,
	`capability_id` text NOT NULL,
	`kind` text NOT NULL,
	`evidence_json` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`capability_id`) REFERENCES `capability_records`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "capability_events_kind_valid" CHECK("kind" IN ('provisioned', 'validated', 'validation_failed', 'outcome', 'reported_use', 'deprecated', 'preferred'))
);
--> statement-breakpoint
INSERT INTO `__new_capability_events`("id", "capability_id", "kind", "evidence_json", "created_at") SELECT "id", "capability_id", "kind", "evidence_json", "created_at" FROM `capability_events`;--> statement-breakpoint
DROP TABLE `capability_events`;--> statement-breakpoint
ALTER TABLE `__new_capability_events` RENAME TO `capability_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `capability_events_capability` ON `capability_events` (`capability_id`);--> statement-breakpoint
CREATE TRIGGER capability_events_no_delete
BEFORE DELETE ON capability_events
BEGIN
  SELECT RAISE(ABORT, 'capability event history is append-only');
END;--> statement-breakpoint
CREATE TRIGGER capability_events_no_update
BEFORE UPDATE ON capability_events
BEGIN
  SELECT RAISE(ABORT, 'capability event history is append-only');
END;--> statement-breakpoint
CREATE TABLE `__new_capability_records` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`key` text NOT NULL,
	`name` text NOT NULL,
	`description` text NOT NULL,
	`type` text NOT NULL,
	`operations_json` text NOT NULL,
	`risk_level` text NOT NULL,
	`source_json` text NOT NULL,
	`source_fingerprint` text NOT NULL,
	`provenance_json` text NOT NULL,
	`verification_artifact_id` text,
	`status` text DEFAULT 'candidate' NOT NULL,
	`validation_state` text DEFAULT 'not_started' NOT NULL,
	`success_count` integer DEFAULT 0 NOT NULL,
	`failure_count` integer DEFAULT 0 NOT NULL,
	`last_used_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "capability_records_type_valid" CHECK("type" IN ('local_tool', 'skill', 'mcp', 'api', 'cli', 'library', 'open_source', 'adapter', 'browser')),
	CONSTRAINT "capability_records_status_valid" CHECK("status" IN ('candidate', 'provisional', 'validated', 'preferred', 'degraded', 'deprecated', 'blocked')),
	CONSTRAINT "capability_records_validation_valid" CHECK("validation_state" IN ('not_started', 'preflight_passed', 'capability_verified', 'independently_validated', 'failed')),
	CONSTRAINT "capability_records_counts_non_negative" CHECK(success_count >= 0 AND failure_count >= 0)
);
--> statement-breakpoint
INSERT INTO `__new_capability_records`("id", "project_id", "key", "name", "description", "type", "operations_json", "risk_level", "source_json", "source_fingerprint", "provenance_json", "verification_artifact_id", "status", "validation_state", "success_count", "failure_count", "last_used_at", "created_at", "updated_at") SELECT "id", "project_id", "key", "name", "description", "type", "operations_json", "risk_level", "source_json", sha256("source_json"), "provenance_json", NULL, "status", "validation_state", "success_count", "failure_count", "last_used_at", "created_at", "updated_at" FROM `capability_records`;--> statement-breakpoint
DROP TABLE `capability_records`;--> statement-breakpoint
ALTER TABLE `__new_capability_records` RENAME TO `capability_records`;--> statement-breakpoint
CREATE UNIQUE INDEX `capability_records_project_key` ON `capability_records` (`project_id`,`key`);--> statement-breakpoint
CREATE INDEX `capability_records_project_status` ON `capability_records` (`project_id`,`status`);

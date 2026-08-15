CREATE TABLE `capability_records` (
  `id` text PRIMARY KEY NOT NULL,
  `project_id` text NOT NULL,
  `key` text NOT NULL,
  `name` text NOT NULL,
  `description` text NOT NULL,
  `type` text NOT NULL,
  `operations_json` text NOT NULL,
  `risk_level` text NOT NULL,
  `source_json` text NOT NULL,
  `provenance_json` text NOT NULL,
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
  CONSTRAINT "capability_records_validation_valid" CHECK("validation_state" IN ('not_started', 'preflight_passed', 'independently_validated', 'failed')),
  CONSTRAINT "capability_records_counts_non_negative" CHECK(success_count >= 0 AND failure_count >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `capability_records_project_key` ON `capability_records` (`project_id`,`key`);
--> statement-breakpoint
CREATE INDEX `capability_records_project_status` ON `capability_records` (`project_id`,`status`);
--> statement-breakpoint
CREATE TABLE `capability_events` (
  `id` text PRIMARY KEY NOT NULL,
  `capability_id` text NOT NULL,
  `kind` text NOT NULL,
  `evidence_json` text NOT NULL,
  `created_at` text NOT NULL,
  FOREIGN KEY (`capability_id`) REFERENCES `capability_records`(`id`) ON UPDATE no action ON DELETE no action,
  CONSTRAINT "capability_events_kind_valid" CHECK("kind" IN ('provisioned', 'validated', 'validation_failed', 'outcome', 'deprecated', 'preferred'))
);
--> statement-breakpoint
CREATE INDEX `capability_events_capability` ON `capability_events` (`capability_id`);
--> statement-breakpoint
CREATE TRIGGER capability_events_no_delete
BEFORE DELETE ON capability_events
BEGIN
  SELECT RAISE(ABORT, 'capability event history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER capability_events_no_update
BEFORE UPDATE ON capability_events
BEGIN
  SELECT RAISE(ABORT, 'capability event history is append-only');
END;

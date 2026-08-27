CREATE TABLE `run_performance_observations` (
	`id` text PRIMARY KEY NOT NULL,
	`project` text NOT NULL,
	`goal_id` text NOT NULL,
	`source` text NOT NULL,
	`schema` text NOT NULL,
	`receipt_json` text NOT NULL,
	`recorded_at` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "run_performance_observations_source_valid" CHECK("source" IN ('major', 'dsh')),
	CONSTRAINT "run_performance_observations_schema_v1" CHECK("schema" = 'major.run-insight.v1')
);
--> statement-breakpoint
CREATE INDEX `run_performance_observations_project_time` ON `run_performance_observations` (`project`,`recorded_at`);
--> statement-breakpoint
CREATE INDEX `run_performance_observations_goal_time` ON `run_performance_observations` (`project`,`goal_id`,`recorded_at`);
--> statement-breakpoint
CREATE TRIGGER run_performance_observations_no_update
BEFORE UPDATE ON run_performance_observations
BEGIN
  SELECT RAISE(ABORT, 'run_performance_observations is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER run_performance_observations_no_delete
BEFORE DELETE ON run_performance_observations
BEGIN
  SELECT RAISE(ABORT, 'run_performance_observations is append-only');
END;

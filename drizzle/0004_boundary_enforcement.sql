PRAGMA foreign_keys=OFF;--> statement-breakpoint
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
	`apply_attempt_id` text,
	`apply_started_at` text,
	`applied_at` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`roadmap_item_id`) REFERENCES `roadmap_items`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`proposed_by_run_id`) REFERENCES `agent_runs`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "roadmap_updates_status_valid" CHECK("status" IN ('proposed', 'applying', 'applied', 'rejected', 'superseded')),
	CONSTRAINT "roadmap_updates_applied_needs_dry_run" CHECK(status <> 'applied' OR (applied_at IS NOT NULL AND dry_run_diff IS NOT NULL AND dry_run_at IS NOT NULL)),
	CONSTRAINT "roadmap_updates_applying_has_attempt" CHECK(status <> 'applying' OR (apply_attempt_id IS NOT NULL AND apply_started_at IS NOT NULL))
);
--> statement-breakpoint
INSERT INTO `__new_roadmap_updates`("id", "roadmap_item_id", "proposed_by_run_id", "idempotency_key", "payload_hash", "source_revision", "changes_json", "rationale", "evidence_ids_json", "dry_run_diff", "dry_run_at", "status", "apply_attempt_id", "apply_started_at", "applied_at", "created_at", "updated_at") SELECT "id", "roadmap_item_id", "proposed_by_run_id", "idempotency_key", "payload_hash", "source_revision", "changes_json", "rationale", "evidence_ids_json", "dry_run_diff", "dry_run_at", "status", NULL, NULL, "applied_at", "created_at", "updated_at" FROM `roadmap_updates`;--> statement-breakpoint
DROP TABLE `roadmap_updates`;--> statement-breakpoint
ALTER TABLE `__new_roadmap_updates` RENAME TO `roadmap_updates`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `roadmap_updates_idempotency_key_unique` ON `roadmap_updates` (`idempotency_key`);--> statement-breakpoint

-- Rebuilding roadmap_updates dropped its 0003 triggers with the old table;
-- recreate them verbatim.
CREATE TRIGGER roadmap_updates_immutable_payload
BEFORE UPDATE ON roadmap_updates
WHEN OLD.idempotency_key <> NEW.idempotency_key
  OR OLD.payload_hash <> NEW.payload_hash
  OR OLD.changes_json <> NEW.changes_json
  OR OLD.roadmap_item_id <> NEW.roadmap_item_id
BEGIN
  SELECT RAISE(ABORT, 'proposal payload identity is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER roadmap_updates_terminal_status
BEFORE UPDATE ON roadmap_updates
WHEN OLD.status IN ('applied', 'rejected', 'superseded') AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'terminal roadmap updates cannot change status');
END;
--> statement-breakpoint

-- Completion is enforced at the database boundary: only ready_to_merge may
-- complete, and only with a QUALIFYING verification run — passed with exit
-- code 0, completed timestamps, produced under a succeeded agent run of the
-- SAME task, and cited by an (append-only) evidence row — and no open
-- critical/major review findings.
CREATE TRIGGER tasks_completion_requires_proof
BEFORE UPDATE ON tasks
WHEN NEW.status = 'completed' AND OLD.status <> 'completed'
BEGIN
  SELECT CASE WHEN OLD.status <> 'ready_to_merge'
    THEN RAISE(ABORT, 'illegal transition to completed: only ready_to_merge may complete')
  END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM verification_runs v
    JOIN agent_runs r ON r.id = v.agent_run_id AND r.task_id = v.task_id
    JOIN evidence e ON e.ref = v.id AND e.kind = 'verification_run' AND e.task_id = v.task_id
    WHERE v.task_id = NEW.id AND v.status = 'passed' AND v.exit_code = 0
      AND v.started_at IS NOT NULL AND v.ended_at IS NOT NULL
      AND r.status = 'succeeded'
  ) = 0
    THEN RAISE(ABORT, 'completion requires a qualifying passed verification run (exit 0, completed, from a succeeded run of this task, with linked evidence)')
  END;
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM review_findings f
    WHERE f.task_id = NEW.id AND f.status = 'open' AND f.severity IN ('critical', 'major')
  ) > 0
    THEN RAISE(ABORT, 'completion blocked by open critical/major review findings')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER tasks_no_insert_completed
BEFORE INSERT ON tasks
WHEN NEW.status = 'completed'
BEGIN
  SELECT RAISE(ABORT, 'tasks cannot be created directly in completed status');
END;
--> statement-breakpoint

-- A 'passed' verification label is meaningless without exit code 0 and
-- completed timestamps; terminal verification records are immutable.
CREATE TRIGGER verification_runs_passed_consistent_insert
BEFORE INSERT ON verification_runs
WHEN NEW.status = 'passed' AND (NEW.exit_code IS NOT 0 OR NEW.started_at IS NULL OR NEW.ended_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a passed verification run requires exit code 0 and start/end timestamps');
END;
--> statement-breakpoint
CREATE TRIGGER verification_runs_passed_consistent_update
BEFORE UPDATE ON verification_runs
WHEN NEW.status = 'passed' AND (NEW.exit_code IS NOT 0 OR NEW.started_at IS NULL OR NEW.ended_at IS NULL)
BEGIN
  SELECT RAISE(ABORT, 'a passed verification run requires exit code 0 and start/end timestamps');
END;
--> statement-breakpoint
CREATE TRIGGER verification_runs_terminal_immutable
BEFORE UPDATE ON verification_runs
WHEN OLD.status IN ('passed', 'failed')
BEGIN
  SELECT RAISE(ABORT, 'terminal verification runs are immutable');
END;
--> statement-breakpoint

-- Billing authority at the database boundary: no run may carry an unknown
-- billing mode, and a paid run requires an APPROVED paid_usage decision
-- bound to the same task — a bare reference is not authorisation.
CREATE TRIGGER agent_runs_billing_known
BEFORE INSERT ON agent_runs
WHEN NEW.billing_mode = 'unknown'
BEGIN
  SELECT RAISE(ABORT, 'runs require an authoritatively known billing mode');
END;
--> statement-breakpoint
CREATE TRIGGER agent_runs_paid_requires_approved_decision
BEFORE INSERT ON agent_runs
WHEN NEW.billing_mode IN ('usage_credits', 'api_billing')
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM decision_requests d
    WHERE d.id = NEW.paid_usage_decision_id AND d.status = 'approved'
      AND d.category = 'paid_usage' AND d.task_id = NEW.task_id
  ) = 0
    THEN RAISE(ABORT, 'paid runs require an approved paid_usage DecisionRequest bound to the same task')
  END;
END;
-- M3 groundwork: freeze task-specific completion criteria at first dispatch
-- and prove completion against that immutable snapshot at SQLite.
ALTER TABLE tasks ADD COLUMN completion_criteria_snapshot_json text;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN completion_criteria_locked_at text;
--> statement-breakpoint

-- Existing dispatched tasks need a conservative snapshot before the new
-- triggers apply. Preserve their exact current criteria; default criteria are
-- represented by an empty JSON object and expanded by the proof evaluator.
UPDATE tasks
SET completion_criteria_snapshot_json = COALESCE(completion_criteria_json, '{}'),
    completion_criteria_locked_at = updated_at
WHERE status IN ('queued', 'running', 'verifying', 'reviewing', 'ready_to_merge', 'completed');
--> statement-breakpoint

CREATE TRIGGER tasks_no_insert_dispatched
BEFORE INSERT ON tasks
WHEN NEW.status IN ('queued', 'running', 'verifying', 'reviewing', 'ready_to_merge')
BEGIN
  SELECT RAISE(ABORT, 'tasks cannot be inserted directly in a dispatched status');
END;
--> statement-breakpoint

CREATE TRIGGER tasks_completion_criteria_valid_insert
BEFORE INSERT ON tasks
WHEN NEW.completion_criteria_json IS NOT NULL
  AND (
    NOT json_valid(NEW.completion_criteria_json)
    OR COALESCE(json_type(NEW.completion_criteria_json), '') <> 'object'
    OR COALESCE(json_type(NEW.completion_criteria_json, '$.minPassedVerificationRuns'), 'integer') <> 'integer'
    OR COALESCE(json_extract(NEW.completion_criteria_json, '$.minPassedVerificationRuns'), 1) < 1
    OR COALESCE(json_type(NEW.completion_criteria_json, '$.requireArtifact'), 'false') NOT IN ('true', 'false')
    OR COALESCE(json_type(NEW.completion_criteria_json, '$.requiredDecisionCategories'), 'array') <> 'array'
    OR EXISTS (
      SELECT 1 FROM json_each(
        COALESCE(json_extract(NEW.completion_criteria_json, '$.requiredDecisionCategories'), '[]')
      ) WHERE type <> 'text' OR trim(value) = ''
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid task completion criteria');
END;
--> statement-breakpoint

CREATE TRIGGER tasks_completion_criteria_valid_update
BEFORE UPDATE OF completion_criteria_json ON tasks
WHEN NEW.completion_criteria_json IS NOT NULL
  AND (
    NOT json_valid(NEW.completion_criteria_json)
    OR COALESCE(json_type(NEW.completion_criteria_json), '') <> 'object'
    OR COALESCE(json_type(NEW.completion_criteria_json, '$.minPassedVerificationRuns'), 'integer') <> 'integer'
    OR COALESCE(json_extract(NEW.completion_criteria_json, '$.minPassedVerificationRuns'), 1) < 1
    OR COALESCE(json_type(NEW.completion_criteria_json, '$.requireArtifact'), 'false') NOT IN ('true', 'false')
    OR COALESCE(json_type(NEW.completion_criteria_json, '$.requiredDecisionCategories'), 'array') <> 'array'
    OR EXISTS (
      SELECT 1 FROM json_each(
        COALESCE(json_extract(NEW.completion_criteria_json, '$.requiredDecisionCategories'), '[]')
      ) WHERE type <> 'text' OR trim(value) = ''
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid task completion criteria');
END;
--> statement-breakpoint

-- Dispatch must carry the exact criteria observed before the status change.
-- A single hostile UPDATE cannot weaken criteria and snapshot the weaker value.
CREATE TRIGGER tasks_dispatch_requires_completion_snapshot
BEFORE UPDATE ON tasks
WHEN NEW.status = 'queued' AND OLD.status <> 'queued'
  AND (
    NEW.completion_criteria_snapshot_json IS NULL
    OR NEW.completion_criteria_locked_at IS NULL
    OR NEW.completion_criteria_snapshot_json IS NOT COALESCE(OLD.completion_criteria_json, '{}')
  )
BEGIN
  SELECT RAISE(ABORT, 'dispatch requires the exact pre-dispatch completion criteria snapshot');
END;
--> statement-breakpoint

CREATE TRIGGER tasks_completion_snapshot_immutable
BEFORE UPDATE ON tasks
WHEN OLD.completion_criteria_snapshot_json IS NOT NULL
  AND (
    NEW.completion_criteria_json IS NOT OLD.completion_criteria_json
    OR NEW.completion_criteria_snapshot_json IS NOT OLD.completion_criteria_snapshot_json
    OR NEW.completion_criteria_locked_at IS NOT OLD.completion_criteria_locked_at
  )
BEGIN
  SELECT RAISE(ABORT, 'dispatched task completion criteria are immutable');
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS tasks_completion_requires_proof;
--> statement-breakpoint
CREATE TRIGGER tasks_completion_requires_proof
BEFORE UPDATE ON tasks
WHEN NEW.status = 'completed' AND OLD.status <> 'completed'
BEGIN
  SELECT CASE WHEN OLD.status <> 'ready_to_merge'
    THEN RAISE(ABORT, 'illegal transition to completed: only ready_to_merge may complete')
  END;
  SELECT CASE WHEN NEW.completion_criteria_snapshot_json IS NULL
    THEN RAISE(ABORT, 'completion requires immutable dispatch criteria')
  END;
  SELECT CASE WHEN (
    SELECT COUNT(DISTINCT v.id) FROM verification_runs v
    JOIN agent_runs r ON r.id = v.agent_run_id AND r.task_id = v.task_id
    JOIN evidence e ON e.ref = v.id AND e.kind = 'verification_run' AND e.task_id = v.task_id
    WHERE v.task_id = NEW.id AND v.status = 'passed' AND v.exit_code = 0
      AND v.started_at IS NOT NULL AND v.ended_at IS NOT NULL
      AND r.status = 'succeeded'
  ) < COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.minPassedVerificationRuns'), 1)
    THEN RAISE(ABORT, 'completion requires the immutable task-specific minimum of qualifying passed verification runs')
  END;
  SELECT CASE WHEN COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.requireArtifact'), 0) = 1
    AND NOT EXISTS (
      SELECT 1 FROM evidence e
      WHERE e.task_id = NEW.id AND e.kind = 'artifact'
        AND e.ref IS NOT NULL AND trim(e.ref) <> ''
    )
    THEN RAISE(ABORT, 'completion requires an artifact evidence record with a repository ref')
  END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(
      COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.requiredDecisionCategories'), '[]')
    ) je
    WHERE NOT EXISTS (
      SELECT 1 FROM decision_requests d
      WHERE d.task_id = NEW.id
        AND d.project_id = NEW.project_id
        AND d.category = je.value
        AND d.status = 'approved'
    )
  ) THEN RAISE(ABORT, 'completion requires a project- and task-bound approved decision for each required category')
  END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM evidence e
    WHERE e.task_id = NEW.id AND e.kind = 'verification_run'
      AND NOT EXISTS (
        SELECT 1 FROM verification_runs v
        WHERE v.id = e.ref AND v.task_id = NEW.id
      )
  ) THEN RAISE(ABORT, 'completion contains invalid verification evidence relationships')
  END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM review_findings f
    WHERE f.task_id = NEW.id AND f.status = 'open' AND f.severity IN ('critical', 'major')
  ) THEN RAISE(ABORT, 'completion blocked by open critical/major review findings')
  END;
END;

-- P1-3: enforce the COMPLETE task-specific completion criteria at the SQLite
-- boundary. The 0004 trigger only required a single qualifying verification
-- and ignored completion_criteria_json, so a direct write could complete a
-- task that demanded more verifications, an artifact, or approved decisions.
-- This recreates the trigger to enforce every criterion the service layer
-- (domain/completion.ts) checks, keeping DB proof and service proof equivalent.
DROP TRIGGER IF EXISTS tasks_completion_requires_proof;--> statement-breakpoint
CREATE TRIGGER tasks_completion_requires_proof
BEFORE UPDATE ON tasks
WHEN NEW.status = 'completed' AND OLD.status <> 'completed'
BEGIN
  SELECT CASE WHEN OLD.status <> 'ready_to_merge'
    THEN RAISE(ABORT, 'illegal transition to completed: only ready_to_merge may complete')
  END;
  -- Qualifying passed verification runs (exit 0, completed, from a succeeded
  -- run of this task, with linked evidence), at least the task-specific
  -- minimum (default 1). COUNT(DISTINCT) so duplicate evidence cannot inflate.
  SELECT CASE WHEN (
    SELECT COUNT(DISTINCT v.id) FROM verification_runs v
    JOIN agent_runs r ON r.id = v.agent_run_id AND r.task_id = v.task_id
    JOIN evidence e ON e.ref = v.id AND e.kind = 'verification_run' AND e.task_id = v.task_id
    WHERE v.task_id = NEW.id AND v.status = 'passed' AND v.exit_code = 0
      AND v.started_at IS NOT NULL AND v.ended_at IS NOT NULL
      AND r.status = 'succeeded'
  ) < COALESCE(json_extract(NEW.completion_criteria_json, '$.minPassedVerificationRuns'), 1)
    THEN RAISE(ABORT, 'completion requires the task-specific minimum of qualifying passed verification runs')
  END;
  -- requireArtifact: an artifact evidence row carrying a non-empty ref.
  SELECT CASE WHEN COALESCE(json_extract(NEW.completion_criteria_json, '$.requireArtifact'), 0) = 1
    AND (
      SELECT COUNT(*) FROM evidence e
      WHERE e.task_id = NEW.id AND e.kind = 'artifact'
        AND e.ref IS NOT NULL AND trim(e.ref) <> ''
    ) = 0
    THEN RAISE(ABORT, 'completion requires an artifact evidence record with a repository ref')
  END;
  -- requiredDecisionCategories: every listed category needs an approved,
  -- task-bound decision. json_each iterates the required-category array.
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM json_each(
      COALESCE(json_extract(NEW.completion_criteria_json, '$.requiredDecisionCategories'), '[]')
    ) je
    WHERE NOT EXISTS (
      SELECT 1 FROM decision_requests d
      WHERE d.task_id = NEW.id AND d.category = je.value AND d.status = 'approved'
    )
  ) > 0
    THEN RAISE(ABORT, 'completion requires an approved decision for each required category')
  END;
  -- No open critical/major review findings.
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM review_findings f
    WHERE f.task_id = NEW.id AND f.status = 'open' AND f.severity IN ('critical', 'major')
  ) > 0
    THEN RAISE(ABORT, 'completion blocked by open critical/major review findings')
  END;
END;

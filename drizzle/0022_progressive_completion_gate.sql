-- Keep the SQLite completion boundary aligned with the opt-in progressive
-- validation contract evaluated by domain/completion.ts. Legacy criteria
-- without $.progressiveValidation retain the existing proof semantics.
ALTER TABLE agent_runs ADD COLUMN source_head text;
--> statement-breakpoint
CREATE TABLE independent_review_receipts (
  id text PRIMARY KEY NOT NULL,
  project text NOT NULL,
  goal_id text NOT NULL,
  run_id text NOT NULL,
  dispatch_id text NOT NULL UNIQUE,
  provider text NOT NULL,
  source_head text NOT NULL CHECK(length(source_head) = 40 AND source_head NOT GLOB '*[^0-9a-f]*'),
  purpose text NOT NULL CHECK(purpose = 'independent_completion_review'),
  verdict text NOT NULL CHECK(verdict IN ('pass', 'fail')),
  evidence text NOT NULL CHECK(trim(evidence) <> ''),
  pending_claimed_at text NOT NULL,
  review_started_at text NOT NULL CHECK(review_started_at >= pending_claimed_at),
  execution_status text NOT NULL CHECK(execution_status = 'succeeded'),
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX independent_review_receipts_goal ON independent_review_receipts(project, goal_id);
--> statement-breakpoint
CREATE TRIGGER independent_review_receipts_append_only_update
BEFORE UPDATE ON independent_review_receipts BEGIN
  SELECT RAISE(ABORT, 'independent review receipts are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER independent_review_receipts_append_only_delete
BEFORE DELETE ON independent_review_receipts BEGIN
  SELECT RAISE(ABORT, 'independent review receipts are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER agent_runs_progressive_head_insert
BEFORE INSERT ON agent_runs
WHEN NEW.purpose IN ('verification', 'implementation', 'repair', 'review')
  AND EXISTS (
    SELECT 1 FROM tasks t
    WHERE t.id = NEW.task_id
      AND json_type(t.completion_criteria_snapshot_json, '$.progressiveValidation') = 'object'
      AND (
        NEW.source_head IS NULL
        OR NEW.source_head <> json_extract(t.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead')
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'progressive task run requires the frozen candidate head');
END;
--> statement-breakpoint
CREATE TRIGGER agent_runs_source_head_immutable
BEFORE UPDATE OF source_head ON agent_runs
WHEN NEW.source_head IS NOT OLD.source_head
BEGIN
  SELECT RAISE(ABORT, 'agent run source head is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER agent_runs_source_head_format_insert
BEFORE INSERT ON agent_runs
WHEN NEW.source_head IS NOT NULL
  AND (length(NEW.source_head) <> 40 OR NEW.source_head GLOB '*[^0-9a-f]*')
BEGIN
  SELECT RAISE(ABORT, 'agent run source head must be an exact lowercase SHA');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tasks_completion_criteria_valid_insert;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tasks_completion_criteria_valid_update;
--> statement-breakpoint
CREATE TRIGGER tasks_completion_criteria_valid_insert
BEFORE INSERT ON tasks
WHEN NEW.completion_criteria_json IS NOT NULL AND (
  NOT json_valid(NEW.completion_criteria_json)
  OR COALESCE(json_type(NEW.completion_criteria_json), '') <> 'object'
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.completion_criteria_json)
    WHERE key NOT IN ('minPassedVerificationRuns', 'requireArtifact', 'requiredDecisionCategories', 'progressiveValidation')
  )
  OR COALESCE(json_type(NEW.completion_criteria_json, '$.minPassedVerificationRuns'), 'integer') <> 'integer'
  OR COALESCE(json_extract(NEW.completion_criteria_json, '$.minPassedVerificationRuns'), 1) < 1
  OR COALESCE(json_type(NEW.completion_criteria_json, '$.requireArtifact'), 'false') NOT IN ('true', 'false')
  OR COALESCE(json_type(NEW.completion_criteria_json, '$.requiredDecisionCategories'), 'array') <> 'array'
  OR EXISTS (
    SELECT 1 FROM json_each(COALESCE(json_extract(NEW.completion_criteria_json, '$.requiredDecisionCategories'), '[]'))
    WHERE type <> 'text' OR trim(value) = ''
  )
  OR (
    json_type(NEW.completion_criteria_json, '$.progressiveValidation') IS NOT NULL AND (
      json_type(NEW.completion_criteria_json, '$.progressiveValidation') <> 'object'
      OR EXISTS (
        SELECT 1 FROM json_each(json_extract(NEW.completion_criteria_json, '$.progressiveValidation'))
        WHERE key NOT IN ('riskSpecificChecks', 'broaderValidationTriggers', 'repositoryPolicyRequiresBroadValidation', 'review', 'candidateHead', 'broadValidationJustification')
      )
      OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.riskSpecificChecks'), 'array') <> 'array'
      OR EXISTS (
        SELECT 1 FROM json_each(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.riskSpecificChecks'), '[]'))
        WHERE type <> 'text' OR trim(value) = ''
      )
      OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.broaderValidationTriggers'), 'array') <> 'array'
      OR EXISTS (
        SELECT 1 FROM json_each(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broaderValidationTriggers'), '[]'))
        WHERE type <> 'text' OR value NOT IN ('blast_radius', 'shared_dependency', 'insufficient_evidence', 'historical_regression', 'promotion_policy')
      )
      OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.repositoryPolicyRequiresBroadValidation'), 'false') NOT IN ('true', 'false')
      OR COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.review'), 'focused') NOT IN ('none', 'focused', 'independent')
      OR (json_type(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead') IS NOT NULL AND (json_type(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead') <> 'text' OR length(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead')) <> 40 OR json_extract(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead') GLOB '*[^0-9a-f]*'))
      OR json_type(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead') IS NULL
      OR (
        json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification') IS NOT NULL AND (
          json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification') <> 'object'
          OR EXISTS (
            SELECT 1 FROM json_each(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification'))
            WHERE key NOT IN ('cost', 'expectedInformationGain')
          )
          OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification.cost'), '') <> 'text'
          OR trim(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification.cost'), '')) = ''
          OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification.expectedInformationGain'), '') <> 'text'
          OR trim(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification.expectedInformationGain'), '')) = ''
        )
      )
      OR (
        (
          json_array_length(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broaderValidationTriggers'), '[]')) > 0
          OR COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.repositoryPolicyRequiresBroadValidation'), 0) = 1
        )
        AND json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification') IS NULL
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid task completion criteria');
END;
--> statement-breakpoint
CREATE TRIGGER tasks_completion_criteria_valid_update
BEFORE UPDATE OF completion_criteria_json ON tasks
WHEN NEW.completion_criteria_json IS NOT NULL AND (
  NOT json_valid(NEW.completion_criteria_json)
  OR COALESCE(json_type(NEW.completion_criteria_json), '') <> 'object'
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.completion_criteria_json)
    WHERE key NOT IN ('minPassedVerificationRuns', 'requireArtifact', 'requiredDecisionCategories', 'progressiveValidation')
  )
  OR COALESCE(json_type(NEW.completion_criteria_json, '$.minPassedVerificationRuns'), 'integer') <> 'integer'
  OR COALESCE(json_extract(NEW.completion_criteria_json, '$.minPassedVerificationRuns'), 1) < 1
  OR COALESCE(json_type(NEW.completion_criteria_json, '$.requireArtifact'), 'false') NOT IN ('true', 'false')
  OR COALESCE(json_type(NEW.completion_criteria_json, '$.requiredDecisionCategories'), 'array') <> 'array'
  OR EXISTS (
    SELECT 1 FROM json_each(COALESCE(json_extract(NEW.completion_criteria_json, '$.requiredDecisionCategories'), '[]'))
    WHERE type <> 'text' OR trim(value) = ''
  )
  OR (
    json_type(NEW.completion_criteria_json, '$.progressiveValidation') IS NOT NULL AND (
      json_type(NEW.completion_criteria_json, '$.progressiveValidation') <> 'object'
      OR EXISTS (
        SELECT 1 FROM json_each(json_extract(NEW.completion_criteria_json, '$.progressiveValidation'))
        WHERE key NOT IN ('riskSpecificChecks', 'broaderValidationTriggers', 'repositoryPolicyRequiresBroadValidation', 'review', 'candidateHead', 'broadValidationJustification')
      )
      OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.riskSpecificChecks'), 'array') <> 'array'
      OR EXISTS (
        SELECT 1 FROM json_each(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.riskSpecificChecks'), '[]'))
        WHERE type <> 'text' OR trim(value) = ''
      )
      OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.broaderValidationTriggers'), 'array') <> 'array'
      OR EXISTS (
        SELECT 1 FROM json_each(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broaderValidationTriggers'), '[]'))
        WHERE type <> 'text' OR value NOT IN ('blast_radius', 'shared_dependency', 'insufficient_evidence', 'historical_regression', 'promotion_policy')
      )
      OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.repositoryPolicyRequiresBroadValidation'), 'false') NOT IN ('true', 'false')
      OR COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.review'), 'focused') NOT IN ('none', 'focused', 'independent')
      OR (json_type(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead') IS NOT NULL AND (json_type(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead') <> 'text' OR length(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead')) <> 40 OR json_extract(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead') GLOB '*[^0-9a-f]*'))
      OR json_type(NEW.completion_criteria_json, '$.progressiveValidation.candidateHead') IS NULL
      OR (
        json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification') IS NOT NULL AND (
          json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification') <> 'object'
          OR EXISTS (
            SELECT 1 FROM json_each(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification'))
            WHERE key NOT IN ('cost', 'expectedInformationGain')
          )
          OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification.cost'), '') <> 'text'
          OR trim(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification.cost'), '')) = ''
          OR COALESCE(json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification.expectedInformationGain'), '') <> 'text'
          OR trim(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification.expectedInformationGain'), '')) = ''
        )
      )
      OR (
        (
          json_array_length(COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.broaderValidationTriggers'), '[]')) > 0
          OR COALESCE(json_extract(NEW.completion_criteria_json, '$.progressiveValidation.repositoryPolicyRequiresBroadValidation'), 0) = 1
        )
        AND json_type(NEW.completion_criteria_json, '$.progressiveValidation.broadValidationJustification') IS NULL
      )
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'invalid task completion criteria');
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
      AND (json_type(NEW.completion_criteria_snapshot_json, '$.progressiveValidation') IS NULL
        OR r.source_head = json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead'))
  ) < COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.minPassedVerificationRuns'), 1)
    THEN RAISE(ABORT, 'completion requires the immutable task-specific minimum of qualifying passed verification runs')
  END;
  SELECT CASE WHEN json_type(NEW.completion_criteria_snapshot_json, '$.progressiveValidation') IS NOT NULL
    AND json_type(NEW.completion_criteria_snapshot_json, '$.progressiveValidation') <> 'object'
    THEN RAISE(ABORT, 'progressive validation criteria must be an object')
  END;
  SELECT CASE WHEN json_type(NEW.completion_criteria_snapshot_json, '$.progressiveValidation') = 'object'
    AND EXISTS (
      SELECT 1 FROM json_each('["focused_tests","cheapest_compile_type_or_build","critical_path_behavior"]') required
      WHERE NOT EXISTS (
        SELECT 1 FROM verification_runs v
        JOIN agent_runs r ON r.id = v.agent_run_id AND r.task_id = v.task_id
        JOIN evidence e ON e.ref = v.id AND e.kind = 'verification_run' AND e.task_id = v.task_id
        WHERE v.task_id = NEW.id AND v.validation_subject = required.value
          AND v.status = 'passed' AND v.exit_code = 0
          AND v.started_at IS NOT NULL AND v.ended_at IS NOT NULL
          AND r.status = 'succeeded'
          AND r.source_head = json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead')
      )
    ) THEN RAISE(ABORT, 'completion missing required progressive validation')
  END;
  SELECT CASE WHEN json_type(NEW.completion_criteria_snapshot_json, '$.progressiveValidation') = 'object'
    AND EXISTS (
      SELECT 1 FROM json_each(COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.riskSpecificChecks'), '[]')) risk
      WHERE NOT EXISTS (
        SELECT 1 FROM verification_runs v
        JOIN agent_runs r ON r.id = v.agent_run_id AND r.task_id = v.task_id
        JOIN evidence e ON e.ref = v.id AND e.kind = 'verification_run' AND e.task_id = v.task_id
        WHERE v.task_id = NEW.id AND v.validation_subject = 'risk_specific_check:' || risk.value
          AND v.status = 'passed' AND v.exit_code = 0
          AND v.started_at IS NOT NULL AND v.ended_at IS NOT NULL
          AND r.status = 'succeeded'
          AND r.source_head = json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead')
      )
    ) THEN RAISE(ABORT, 'completion missing required risk-specific validation')
  END;
  SELECT CASE WHEN json_type(NEW.completion_criteria_snapshot_json, '$.progressiveValidation') = 'object'
    AND (
      json_array_length(COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.broaderValidationTriggers'), '[]')) > 0
      OR COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.repositoryPolicyRequiresBroadValidation'), 0) = 1
    )
    AND NOT EXISTS (
      SELECT 1 FROM verification_runs v
      JOIN agent_runs r ON r.id = v.agent_run_id AND r.task_id = v.task_id
      JOIN evidence e ON e.ref = v.id AND e.kind = 'verification_run' AND e.task_id = v.task_id
      WHERE v.task_id = NEW.id AND v.validation_subject = 'broader_validation'
        AND v.status = 'passed' AND v.exit_code = 0
        AND v.started_at IS NOT NULL AND v.ended_at IS NOT NULL
        AND r.status = 'succeeded'
        AND r.source_head = json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead')
    ) THEN RAISE(ABORT, 'completion missing required broader validation')
  END;
  SELECT CASE WHEN json_type(NEW.completion_criteria_snapshot_json, '$.progressiveValidation') = 'object'
    AND json_array_length(COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.broaderValidationTriggers'), '[]')) = 0
    AND COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.repositoryPolicyRequiresBroadValidation'), 0) = 0
    AND EXISTS (
      SELECT 1 FROM verification_runs v
      JOIN agent_runs r ON r.id = v.agent_run_id AND r.task_id = v.task_id
      JOIN evidence e ON e.ref = v.id AND e.kind = 'verification_run' AND e.task_id = v.task_id
      WHERE v.task_id = NEW.id AND v.validation_subject = 'broader_validation'
        AND v.status = 'passed' AND v.exit_code = 0
        AND v.started_at IS NOT NULL AND v.ended_at IS NOT NULL AND r.status = 'succeeded'
        AND r.source_head = json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead')
    ) THEN RAISE(ABORT, 'completion rejects untriggered broader validation')
  END;
  SELECT CASE WHEN json_type(NEW.completion_criteria_snapshot_json, '$.progressiveValidation') = 'object'
    AND COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.review'), 'focused') <> 'none'
    AND NOT EXISTS (
      SELECT 1 FROM agent_runs r
      WHERE r.task_id = NEW.id AND r.purpose = 'review' AND r.status = 'succeeded'
        AND (json_type(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead') IS NULL OR r.source_head = json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead'))
        AND (
          COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.review'), 'focused') <> 'independent'
          OR (
            r.independence_loss IS NULL
            AND EXISTS (
              SELECT 1 FROM agent_runs implementation
              JOIN agent_providers implementation_provider ON implementation_provider.id = implementation.provider_id
              WHERE implementation.task_id = NEW.id
                AND implementation.purpose IN ('implementation', 'repair')
                AND implementation.status = 'succeeded'
                AND implementation.source_head = json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead')
            )
            AND NOT EXISTS (
              SELECT 1 FROM agent_runs implementation
              JOIN agent_providers implementation_provider ON implementation_provider.id = implementation.provider_id
              JOIN agent_providers review_provider ON review_provider.id = r.provider_id
              WHERE implementation.task_id = NEW.id
                AND implementation.purpose IN ('implementation', 'repair')
                AND implementation.status = 'succeeded'
                AND implementation.source_head = json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead')
                AND implementation_provider.name = review_provider.name
            )
          )
        )
    ) THEN RAISE(ABORT, 'completion requires the selected review')
  END;
  SELECT CASE WHEN COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.requireArtifact'), 0) = 1
    AND NOT EXISTS (
      SELECT 1 FROM evidence e
      WHERE e.task_id = NEW.id AND e.kind = 'artifact'
        AND e.ref IS NOT NULL AND trim(e.ref) <> ''
    ) THEN RAISE(ABORT, 'completion requires an artifact evidence record with a repository ref')
  END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(
      COALESCE(json_extract(NEW.completion_criteria_snapshot_json, '$.requiredDecisionCategories'), '[]')
    ) je
    WHERE NOT EXISTS (
      SELECT 1 FROM decision_requests d
      WHERE d.task_id = NEW.id AND d.project_id = NEW.project_id
        AND d.category = je.value AND d.status = 'approved'
    )
  ) THEN RAISE(ABORT, 'completion requires a project- and task-bound approved decision for each required category')
  END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM evidence e
    WHERE e.task_id = NEW.id AND e.kind = 'verification_run'
      AND NOT EXISTS (
        SELECT 1 FROM verification_runs v WHERE v.id = e.ref AND v.task_id = NEW.id
      )
  ) THEN RAISE(ABORT, 'completion contains invalid verification evidence relationships')
  END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM review_findings f
    WHERE f.task_id = NEW.id AND f.status = 'open' AND f.severity IN ('critical', 'major')
  ) THEN RAISE(ABORT, 'completion blocked by open BLOCKER review findings')
  END;
END;

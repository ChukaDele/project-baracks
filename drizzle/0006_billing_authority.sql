-- P1-2: authoritative billing and single-use paid approval.
--
-- 1. A paid approval gains an expiry and a single-use consumption stamp.
ALTER TABLE `decision_requests` ADD COLUMN `expires_at` text;--> statement-breakpoint
ALTER TABLE `decision_requests` ADD COLUMN `consumed_by_run_id` text;--> statement-breakpoint
CREATE UNIQUE INDEX `decision_requests_consumed_by_run` ON `decision_requests` (`consumed_by_run_id`) WHERE consumed_by_run_id IS NOT NULL;--> statement-breakpoint

-- 2. Resolved decisions stay immutable EXCEPT for a one-time consumption
--    stamp (NULL -> run id). Recreated from 0003 to carve out that single
--    permitted post-resolution mutation; a re-consume attempt still aborts.
DROP TRIGGER IF EXISTS decision_requests_resolved_immutable;--> statement-breakpoint
CREATE TRIGGER decision_requests_resolved_immutable
BEFORE UPDATE ON decision_requests
WHEN OLD.status IN ('approved', 'rejected', 'expired')
  AND NOT (
    OLD.consumed_by_run_id IS NULL AND NEW.consumed_by_run_id IS NOT NULL
    AND NEW.status = OLD.status
    AND NEW.category = OLD.category
    AND NEW.question = OLD.question
    AND NEW.project_id IS OLD.project_id
    AND NEW.task_id IS OLD.task_id
    AND NEW.context_json IS OLD.context_json
    AND NEW.resolution IS OLD.resolution
    AND NEW.resolved_at IS OLD.resolved_at
    AND NEW.expires_at IS OLD.expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'resolved decisions are immutable');
END;
--> statement-breakpoint

-- 3. A paid run requires an approved paid_usage decision bound to the SAME
--    task and project, unexpired, unconsumed, and explicitly scoped to this
--    provider/model. Recreated from 0004 to add project/scope/expiry/consume.
DROP TRIGGER IF EXISTS agent_runs_paid_requires_approved_decision;--> statement-breakpoint
CREATE TRIGGER agent_runs_paid_requires_approved_decision
BEFORE INSERT ON agent_runs
WHEN NEW.billing_mode IN ('usage_credits', 'api_billing')
BEGIN
  SELECT CASE WHEN (
    SELECT COUNT(*) FROM decision_requests d
    WHERE d.id = NEW.paid_usage_decision_id
      AND d.status = 'approved'
      AND d.category = 'paid_usage'
      AND d.task_id = NEW.task_id
      AND d.project_id = (SELECT project_id FROM tasks WHERE id = NEW.task_id)
      AND d.consumed_by_run_id IS NULL
      AND d.expires_at IS NOT NULL
      AND d.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      AND json_extract(d.context_json, '$.scope.provider') =
          (SELECT name FROM agent_providers WHERE id = NEW.provider_id)
      AND json_extract(d.context_json, '$.scope.modelRef') = NEW.model_ref
  ) = 0
    THEN RAISE(ABORT, 'paid runs require an approved paid_usage DecisionRequest bound to this task and project, unexpired, unconsumed, and scoped to this provider/model')
  END;
END;
--> statement-breakpoint

-- 4. A run's billing mode must equal the authoritative persisted billing of
--    its model, when that model is known. An unobserved (unknown) model can
--    therefore never be recorded as subscription_included: configuration,
--    installation state and caller input cannot manufacture a free cost basis.
CREATE TRIGGER agent_runs_billing_matches_model
BEFORE INSERT ON agent_runs
BEGIN
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM agent_models m
    WHERE m.provider_id = NEW.provider_id AND m.model_ref = NEW.model_ref
  ) AND NEW.billing_mode <> (
    SELECT m.billing_mode FROM agent_models m
    WHERE m.provider_id = NEW.provider_id AND m.model_ref = NEW.model_ref
  )
    THEN RAISE(ABORT, 'run billing mode must match the authoritative persisted model billing mode')
  END;
END;

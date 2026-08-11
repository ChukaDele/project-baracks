-- M2 groundwork: make model billing authority and paid approval consumption
-- properties of SQLite, not conventions of the TypeScript service.

-- Existing known billing without a matching authoritative observation is
-- unproven. Downgrade it rather than grandfathering unsafe state.
UPDATE agent_models
SET billing_mode = 'unknown'
WHERE billing_mode <> 'unknown'
  AND NOT EXISTS (
    SELECT 1 FROM discovery_observations o
    WHERE o.model_id = agent_models.id
      AND o.source IN ('human', 'run_outcome')
      AND json_extract(o.observed_json, '$.billingMode') = agent_models.billing_mode
  );
--> statement-breakpoint

-- A model is born unknown. Known billing must be established by a separate,
-- append-only authoritative observation after the model exists.
CREATE TRIGGER agent_models_insert_billing_unknown
BEFORE INSERT ON agent_models
WHEN NEW.billing_mode <> 'unknown'
BEGIN
  SELECT RAISE(ABORT, 'new models require unknown billing until authoritatively observed');
END;
--> statement-breakpoint

CREATE TRIGGER agent_models_billing_requires_observation
BEFORE UPDATE OF billing_mode ON agent_models
WHEN NEW.billing_mode <> OLD.billing_mode AND NEW.billing_mode <> 'unknown'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM discovery_observations o
    WHERE o.model_id = NEW.id
      AND o.source IN ('human', 'run_outcome')
      AND json_extract(o.observed_json, '$.billingMode') = NEW.billing_mode
  ) THEN RAISE(ABORT, 'known model billing requires an authoritative persisted observation') END;
END;
--> statement-breakpoint

-- Every run, free or paid, must resolve to a known persisted model whose
-- billing was established through the authoritative boundary above.
DROP TRIGGER IF EXISTS agent_runs_billing_matches_model;
--> statement-breakpoint
CREATE TRIGGER agent_runs_billing_matches_model
BEFORE INSERT ON agent_runs
WHEN NEW.billing_mode IN ('subscription_included', 'usage_credits', 'api_billing', 'unknown')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM agent_models m
    WHERE m.provider_id = NEW.provider_id
      AND m.model_ref = NEW.model_ref
      AND m.billing_mode = NEW.billing_mode
      AND m.billing_mode <> 'unknown'
  ) THEN RAISE(ABORT, 'run requires a model with authoritatively observed matching billing') END;
END;
--> statement-breakpoint

-- Rebuild paid validation with the complete purpose scope.
DROP TRIGGER IF EXISTS agent_runs_paid_requires_approved_decision;
--> statement-breakpoint
CREATE TRIGGER agent_runs_paid_requires_approved_decision
BEFORE INSERT ON agent_runs
WHEN NEW.billing_mode IN ('usage_credits', 'api_billing')
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM decision_requests d
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
      AND json_extract(d.context_json, '$.scope.purpose') = NEW.purpose
  ) THEN RAISE(ABORT, 'paid run requires an approved, unexpired, unconsumed paid_usage decision scoped to task, project, provider, model and purpose') END;
END;
--> statement-breakpoint

-- A resolved decision may receive its one consumption stamp only from the
-- paid run that references it and matches its full immutable scope.
DROP TRIGGER IF EXISTS decision_requests_resolved_immutable;
--> statement-breakpoint
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
    AND EXISTS (
      SELECT 1 FROM agent_runs r
      JOIN agent_providers p ON p.id = r.provider_id
      JOIN tasks t ON t.id = r.task_id
      WHERE r.id = NEW.consumed_by_run_id
        AND r.paid_usage_decision_id = OLD.id
        AND r.billing_mode IN ('usage_credits', 'api_billing')
        AND r.task_id = OLD.task_id
        AND t.project_id = OLD.project_id
        AND json_extract(OLD.context_json, '$.scope.provider') = p.name
        AND json_extract(OLD.context_json, '$.scope.modelRef') = r.model_ref
        AND json_extract(OLD.context_json, '$.scope.purpose') = r.purpose
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'resolved decisions are immutable');
END;
--> statement-breakpoint

-- SQLite consumes the approval in the same statement transaction as the paid
-- run insert. Direct inserts and service inserts therefore share one boundary.
CREATE TRIGGER agent_runs_consume_paid_decision
AFTER INSERT ON agent_runs
WHEN NEW.billing_mode IN ('usage_credits', 'api_billing')
BEGIN
  UPDATE decision_requests
  SET consumed_by_run_id = NEW.id
  WHERE id = NEW.paid_usage_decision_id AND consumed_by_run_id IS NULL;
  SELECT CASE WHEN changes() <> 1
    THEN RAISE(ABORT, 'paid approval was not consumed exactly once')
  END;
END;
--> statement-breakpoint

CREATE TRIGGER agent_runs_free_forbids_paid_decision
BEFORE INSERT ON agent_runs
WHEN NEW.billing_mode NOT IN ('usage_credits', 'api_billing')
  AND NEW.paid_usage_decision_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'non-paid runs cannot carry a paid usage decision');
END;
--> statement-breakpoint

-- Run authority is fixed at creation. Status and outcome fields may advance,
-- but no later update can change the task, provider, model, purpose, billing,
-- approval, claim or routing identity that the insert triggers authorised.
CREATE TRIGGER agent_runs_authority_immutable
BEFORE UPDATE ON agent_runs
WHEN NEW.task_id <> OLD.task_id
  OR NEW.claim_id IS NOT OLD.claim_id
  OR NEW.provider_id <> OLD.provider_id
  OR NEW.model_id IS NOT OLD.model_id
  OR NEW.model_ref <> OLD.model_ref
  OR NEW.purpose <> OLD.purpose
  OR NEW.billing_mode <> OLD.billing_mode
  OR NEW.routing_reason <> OLD.routing_reason
  OR NEW.paid_usage_decision_id IS NOT OLD.paid_usage_decision_id
  OR NEW.independence_loss IS NOT OLD.independence_loss
  OR NEW.allowance_state IS NOT OLD.allowance_state
  OR NEW.worktree_id IS NOT OLD.worktree_id
BEGIN
  SELECT RAISE(ABORT, 'run authority and routing identity are immutable');
END;

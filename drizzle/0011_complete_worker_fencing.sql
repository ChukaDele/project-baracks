-- M4 groundwork: carry the worker fence to every durable worker-owned write.
ALTER TABLE tasks ADD COLUMN mutation_claim_id text REFERENCES task_claims(id);
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN mutation_worker_id text;
--> statement-breakpoint
ALTER TABLE agent_runs ADD COLUMN claim_worker_id text;
--> statement-breakpoint
ALTER TABLE review_findings ADD COLUMN resolution_run_id text;
--> statement-breakpoint
ALTER TABLE evidence ADD COLUMN agent_run_id text;
--> statement-breakpoint

UPDATE agent_runs
SET claim_worker_id = (SELECT worker_id FROM task_claims c WHERE c.id = agent_runs.claim_id)
WHERE claim_id IS NOT NULL;
--> statement-breakpoint

-- Claim acquisition is valid only for queued work and the next monotonic
-- attempt. The partial unique index still enforces one active claim per task.
CREATE TRIGGER task_claims_insert_fenced
BEFORE INSERT ON task_claims
BEGIN
  SELECT CASE WHEN (SELECT status FROM tasks WHERE id = NEW.task_id) <> 'queued'
    THEN RAISE(ABORT, 'claims require a queued task')
  END;
  SELECT CASE WHEN NEW.attempt <> COALESCE(
    (SELECT MAX(attempt) + 1 FROM task_claims WHERE task_id = NEW.task_id), 1
  ) THEN RAISE(ABORT, 'claim attempt must be the next monotonic task attempt')
  END;
END;
--> statement-breakpoint

-- An expired lease cannot be revived before recovery. A heartbeat can only
-- move both heartbeat and expiry forward while the old lease is still live.
CREATE TRIGGER task_claims_no_expired_heartbeat
BEFORE UPDATE OF heartbeat_at, lease_expires_at ON task_claims
WHEN OLD.status = 'active' AND NEW.status = 'active'
  AND (
    OLD.lease_expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    OR NEW.heartbeat_at < OLD.heartbeat_at
    OR NEW.lease_expires_at <= OLD.lease_expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'claim heartbeat requires a live lease and monotonic renewal');
END;
--> statement-breakpoint

-- A task status mutation is worker-owned whenever an active claim exists.
-- The exact claim and worker must be carried on the task update itself.
CREATE TRIGGER tasks_status_requires_current_fence
BEFORE UPDATE OF status ON tasks
WHEN NEW.status <> OLD.status
  AND (
    EXISTS (SELECT 1 FROM task_claims c WHERE c.task_id = NEW.id AND c.status = 'active')
    OR NEW.mutation_claim_id IS NOT NULL
    OR NEW.mutation_worker_id IS NOT NULL
  )
  AND NOT EXISTS (
    SELECT 1 FROM task_claims c
    WHERE c.id = NEW.mutation_claim_id
      AND c.task_id = NEW.id
      AND c.worker_id = NEW.mutation_worker_id
      AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
BEGIN
  SELECT RAISE(ABORT, 'task status mutation requires the current unexpired task fence');
END;
--> statement-breakpoint

CREATE TRIGGER agent_runs_claim_fence_insert
BEFORE INSERT ON agent_runs
WHEN NEW.claim_id IS NOT NULL OR NEW.claim_worker_id IS NOT NULL
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM task_claims c
    WHERE c.id = NEW.claim_id
      AND c.task_id = NEW.task_id
      AND c.worker_id = NEW.claim_worker_id
      AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) THEN RAISE(ABORT, 'claim-bound run requires the current task fence') END;
END;
--> statement-breakpoint

CREATE TRIGGER agent_runs_unclaimed_has_no_worker
BEFORE INSERT ON agent_runs
WHEN NEW.claim_id IS NULL AND NEW.claim_worker_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'unclaimed run cannot carry a claim worker');
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS agent_runs_status_fenced_by_claim;
--> statement-breakpoint
CREATE TRIGGER agent_runs_status_fenced_by_claim
BEFORE UPDATE OF status ON agent_runs
WHEN NEW.claim_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM task_claims c
    WHERE c.id = NEW.claim_id AND c.task_id = NEW.task_id
      AND c.worker_id = NEW.claim_worker_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
BEGIN
  SELECT RAISE(ABORT, 'run status change requires the current task fence');
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS agent_run_events_fenced_by_claim;
--> statement-breakpoint
CREATE TRIGGER agent_run_events_fenced_by_claim
BEFORE INSERT ON agent_run_events
WHEN EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = NEW.run_id AND r.claim_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs r JOIN task_claims c ON c.id = r.claim_id
    WHERE r.id = NEW.run_id AND c.task_id = r.task_id
      AND c.worker_id = r.claim_worker_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
BEGIN
  SELECT RAISE(ABORT, 'run event requires the current task fence');
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS usage_observations_fenced_by_claim;
--> statement-breakpoint
CREATE TRIGGER usage_observations_fenced_by_claim
BEFORE INSERT ON usage_observations
WHEN NEW.agent_run_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = NEW.agent_run_id AND r.claim_id IS NOT NULL)
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs r JOIN task_claims c ON c.id = r.claim_id
    WHERE r.id = NEW.agent_run_id AND c.task_id = r.task_id
      AND c.worker_id = r.claim_worker_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
BEGIN
  SELECT RAISE(ABORT, 'usage observation requires the current task fence');
END;
--> statement-breakpoint

DROP TRIGGER IF EXISTS verification_runs_fenced_by_claim;
--> statement-breakpoint
CREATE TRIGGER verification_runs_fenced_by_claim
BEFORE INSERT ON verification_runs
WHEN (
    EXISTS (SELECT 1 FROM task_claims c WHERE c.task_id = NEW.task_id AND c.status = 'active')
    OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = NEW.agent_run_id AND r.claim_id IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs r JOIN task_claims c ON c.id = r.claim_id
    WHERE r.id = NEW.agent_run_id AND r.task_id = NEW.task_id
      AND c.worker_id = r.claim_worker_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
BEGIN
  SELECT RAISE(ABORT, 'verification write requires a run under the current task fence');
END;
--> statement-breakpoint

CREATE TRIGGER evidence_fenced_by_claim
BEFORE INSERT ON evidence
WHEN (
    EXISTS (SELECT 1 FROM task_claims c WHERE c.task_id = NEW.task_id AND c.status = 'active')
    OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = NEW.agent_run_id AND r.claim_id IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs r JOIN task_claims c ON c.id = r.claim_id
    WHERE r.id = NEW.agent_run_id AND r.task_id = NEW.task_id
      AND c.worker_id = r.claim_worker_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
BEGIN
  SELECT RAISE(ABORT, 'evidence write requires a run under the current task fence');
END;
--> statement-breakpoint

CREATE TRIGGER review_findings_insert_fenced
BEFORE INSERT ON review_findings
WHEN (
    EXISTS (SELECT 1 FROM task_claims c WHERE c.task_id = NEW.task_id AND c.status = 'active')
    OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = NEW.agent_run_id AND r.claim_id IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs r JOIN task_claims c ON c.id = r.claim_id
    WHERE r.id = NEW.agent_run_id AND r.task_id = NEW.task_id
      AND c.worker_id = r.claim_worker_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
BEGIN
  SELECT RAISE(ABORT, 'review finding requires a run under the current task fence');
END;
--> statement-breakpoint

CREATE TRIGGER review_findings_resolution_fenced
BEFORE UPDATE OF status ON review_findings
WHEN NEW.status <> OLD.status
  AND (
    EXISTS (SELECT 1 FROM task_claims c WHERE c.task_id = NEW.task_id AND c.status = 'active')
    OR EXISTS (SELECT 1 FROM agent_runs r WHERE r.id = NEW.resolution_run_id AND r.claim_id IS NOT NULL)
  )
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs r JOIN task_claims c ON c.id = r.claim_id
    WHERE r.id = NEW.resolution_run_id AND r.task_id = NEW.task_id
      AND c.worker_id = r.claim_worker_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
BEGIN
  SELECT RAISE(ABORT, 'review finding resolution requires a run under the current task fence');
END;
--> statement-breakpoint

CREATE TRIGGER roadmap_proposals_fenced_by_claim
BEFORE INSERT ON roadmap_updates
WHEN (
  EXISTS (
    SELECT 1 FROM tasks t JOIN task_claims c ON c.task_id = t.id
    WHERE t.roadmap_item_id = NEW.roadmap_item_id AND c.status = 'active'
  )
  OR EXISTS (
    SELECT 1 FROM agent_runs r WHERE r.id = NEW.proposed_by_run_id AND r.claim_id IS NOT NULL
  )
)
  AND NOT EXISTS (
    SELECT 1 FROM agent_runs r
    JOIN tasks t ON t.id = r.task_id
    JOIN task_claims c ON c.id = r.claim_id
    WHERE r.id = NEW.proposed_by_run_id
      AND t.roadmap_item_id = NEW.roadmap_item_id
      AND c.worker_id = r.claim_worker_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  )
BEGIN
  SELECT RAISE(ABORT, 'roadmap proposal requires a run under the current task fence');
END;

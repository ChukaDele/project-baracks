-- P1-4: fence every run-linked owner mutation on the liveness of the claim
-- the run executes under. A claim is live only while it is 'active' AND its
-- lease has not lapsed (compared against real UTC now in the same ISO-8601
-- millisecond format claim-service persists). A worker whose lease expired is
-- refused immediately, before any recovery sweep; after recovery the claim is
-- no longer 'active' and the same triggers keep the zombie out.
--
-- Runs with no claim (verification/review/analysis outside a worker lease) are
-- unaffected: the guards only fire when the run carries a claim_id.

CREATE TRIGGER agent_runs_status_fenced_by_claim
BEFORE UPDATE OF status ON agent_runs
WHEN NEW.claim_id IS NOT NULL
  AND (
    SELECT COUNT(*) FROM task_claims c
    WHERE c.id = NEW.claim_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'run status change requires a live claim (active, unexpired lease)');
END;
--> statement-breakpoint
CREATE TRIGGER agent_run_events_fenced_by_claim
BEFORE INSERT ON agent_run_events
WHEN (SELECT r.claim_id FROM agent_runs r WHERE r.id = NEW.run_id) IS NOT NULL
  AND (
    SELECT COUNT(*) FROM task_claims c
    JOIN agent_runs r ON r.id = NEW.run_id
    WHERE c.id = r.claim_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'appending a run event requires a live claim');
END;
--> statement-breakpoint
CREATE TRIGGER usage_observations_fenced_by_claim
BEFORE INSERT ON usage_observations
WHEN NEW.agent_run_id IS NOT NULL
  AND (SELECT r.claim_id FROM agent_runs r WHERE r.id = NEW.agent_run_id) IS NOT NULL
  AND (
    SELECT COUNT(*) FROM task_claims c
    JOIN agent_runs r ON r.id = NEW.agent_run_id
    WHERE c.id = r.claim_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'recording usage requires a live claim');
END;
--> statement-breakpoint
CREATE TRIGGER verification_runs_fenced_by_claim
BEFORE INSERT ON verification_runs
WHEN NEW.agent_run_id IS NOT NULL
  AND (SELECT r.claim_id FROM agent_runs r WHERE r.id = NEW.agent_run_id) IS NOT NULL
  AND (
    SELECT COUNT(*) FROM task_claims c
    JOIN agent_runs r ON r.id = NEW.agent_run_id
    WHERE c.id = r.claim_id AND c.status = 'active'
      AND c.lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  ) = 0
BEGIN
  SELECT RAISE(ABORT, 'recording a verification run requires a live claim');
END;

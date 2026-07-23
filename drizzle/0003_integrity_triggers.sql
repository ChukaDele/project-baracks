-- Integrity triggers: relationship immutability, append-only audit history,
-- and cross-table evidence validation that CHECK constraints cannot express.

-- Task relationships can never be silently reassigned.
CREATE TRIGGER tasks_no_relationship_reassignment
BEFORE UPDATE ON tasks
WHEN OLD.project_id <> NEW.project_id
  OR OLD.suggestion_id IS NOT NEW.suggestion_id
  OR OLD.roadmap_item_id IS NOT NEW.roadmap_item_id
BEGIN
  SELECT RAISE(ABORT, 'task relationships (project, suggestion, roadmap item) are immutable');
END;
--> statement-breakpoint

-- Suggestion provenance is immutable.
CREATE TRIGGER task_suggestions_immutable_provenance
BEFORE UPDATE ON task_suggestions
WHEN OLD.project_id <> NEW.project_id
  OR OLD.scope_fingerprint <> NEW.scope_fingerprint
  OR OLD.source_type <> NEW.source_type
  OR OLD.source_ref IS NOT NEW.source_ref
BEGIN
  SELECT RAISE(ABORT, 'suggestion provenance is immutable');
END;
--> statement-breakpoint

-- A decided suggestion can never change its decision.
CREATE TRIGGER task_suggestions_no_status_reassignment
BEFORE UPDATE ON task_suggestions
WHEN OLD.status <> 'pending' AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'decided suggestions cannot change status');
END;
--> statement-breakpoint

-- The suggestion -> task linkage is immutable once set.
CREATE TRIGGER task_suggestions_no_task_reassignment
BEFORE UPDATE ON task_suggestions
WHEN OLD.approved_task_id IS NOT NULL AND NEW.approved_task_id IS NOT OLD.approved_task_id
BEGIN
  SELECT RAISE(ABORT, 'approved task linkage is immutable');
END;
--> statement-breakpoint

-- Claim (attempt) history is append-only with immutable identity.
CREATE TRIGGER task_claims_no_delete
BEFORE DELETE ON task_claims
BEGIN
  SELECT RAISE(ABORT, 'task_claims history is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER task_claims_immutable_identity
BEFORE UPDATE ON task_claims
WHEN OLD.task_id <> NEW.task_id
  OR OLD.attempt <> NEW.attempt
  OR OLD.worker_id <> NEW.worker_id
  OR OLD.created_at <> NEW.created_at
BEGIN
  SELECT RAISE(ABORT, 'claim identity (task, attempt, worker) is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER task_claims_terminal_status
BEFORE UPDATE ON task_claims
WHEN OLD.status <> 'active' AND NEW.status <> OLD.status
BEGIN
  SELECT RAISE(ABORT, 'claims cannot leave a terminal status');
END;
--> statement-breakpoint

-- Evidence must reference real records of the same task, and is append-only:
-- agents cannot fabricate, edit, or retract the proof behind a completion.
CREATE TRIGGER evidence_verification_ref_valid
BEFORE INSERT ON evidence
WHEN NEW.kind = 'verification_run'
BEGIN
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM verification_runs
          WHERE id = NEW.ref AND task_id = NEW.task_id) = 0
    THEN RAISE(ABORT, 'verification_run evidence must reference a verification run of the same task')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER evidence_review_ref_valid
BEFORE INSERT ON evidence
WHEN NEW.kind = 'review'
BEGIN
  SELECT CASE
    WHEN (SELECT COUNT(*) FROM review_findings
          WHERE id = NEW.ref AND task_id = NEW.task_id) = 0
     AND (SELECT COUNT(*) FROM agent_runs
          WHERE id = NEW.ref AND task_id = NEW.task_id AND purpose = 'review') = 0
    THEN RAISE(ABORT, 'review evidence must reference a review finding or review run of the same task')
  END;
END;
--> statement-breakpoint
CREATE TRIGGER evidence_no_update
BEFORE UPDATE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER evidence_no_delete
BEFORE DELETE ON evidence
BEGIN
  SELECT RAISE(ABORT, 'evidence is append-only');
END;
--> statement-breakpoint

-- Resolved decisions are permanent records.
CREATE TRIGGER decision_requests_resolved_immutable
BEFORE UPDATE ON decision_requests
WHEN OLD.status IN ('approved', 'rejected', 'expired')
BEGIN
  SELECT RAISE(ABORT, 'resolved decisions are immutable');
END;
--> statement-breakpoint

-- Roadmap proposals are bound to their payload; terminal proposals are final.
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

-- Append-only audit tables.
CREATE TRIGGER execution_policy_decisions_no_update
BEFORE UPDATE ON execution_policy_decisions
BEGIN
  SELECT RAISE(ABORT, 'execution_policy_decisions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER execution_policy_decisions_no_delete
BEFORE DELETE ON execution_policy_decisions
BEGIN
  SELECT RAISE(ABORT, 'execution_policy_decisions is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER discovery_observations_no_update
BEFORE UPDATE ON discovery_observations
BEGIN
  SELECT RAISE(ABORT, 'discovery_observations is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER discovery_observations_no_delete
BEFORE DELETE ON discovery_observations
BEGIN
  SELECT RAISE(ABORT, 'discovery_observations is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER routing_checkpoints_no_update
BEFORE UPDATE ON routing_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'routing_checkpoints is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER routing_checkpoints_no_delete
BEFORE DELETE ON routing_checkpoints
BEGIN
  SELECT RAISE(ABORT, 'routing_checkpoints is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER usage_observations_no_update
BEFORE UPDATE ON usage_observations
BEGIN
  SELECT RAISE(ABORT, 'usage_observations is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER usage_observations_no_delete
BEFORE DELETE ON usage_observations
BEGIN
  SELECT RAISE(ABORT, 'usage_observations is append-only');
END;

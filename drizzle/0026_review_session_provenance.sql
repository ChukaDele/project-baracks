ALTER TABLE independent_review_receipts ADD COLUMN review_session_ref text;
--> statement-breakpoint
ALTER TABLE independent_review_receipts ADD COLUMN reviewed_session_ref text;
--> statement-breakpoint
DROP TRIGGER IF EXISTS independent_review_receipts_canonical_run_insert;
--> statement-breakpoint
CREATE TRIGGER independent_review_receipts_canonical_run_insert
BEFORE INSERT ON independent_review_receipts
BEGIN
  SELECT CASE WHEN NEW.task_id IS NULL OR NEW.provider_id IS NULL
    OR NEW.provider_account_label IS NULL OR NEW.reviewed_run_id IS NULL
    OR NEW.review_session_ref IS NULL OR trim(NEW.review_session_ref) = ''
    OR NEW.reviewed_session_ref IS NULL OR trim(NEW.reviewed_session_ref) = ''
    OR NEW.source_tree_digest IS NULL OR length(NEW.source_tree_digest) <> 64
    OR NEW.source_tree_digest GLOB '*[^0-9a-f]*'
    OR NEW.reviewed_run_id = NEW.run_id
    OR NOT EXISTS (
      SELECT 1 FROM agent_runs review
      JOIN agent_providers ap ON ap.id = review.provider_id
      WHERE review.id = NEW.run_id AND review.task_id = NEW.task_id
        AND review.provider_id = NEW.provider_id
        AND ap.account_label = NEW.provider_account_label
        AND ap.name = CASE NEW.provider WHEN 'claude' THEN 'claude-code' ELSE NEW.provider END
        AND review.purpose = 'review' AND review.independence_loss IS NULL
        AND review.source_head = NEW.source_head AND review.status = 'succeeded'
        AND trim(review.session_ref) = trim(NEW.review_session_ref)
    ) OR NOT EXISTS (
      SELECT 1 FROM agent_runs reviewed
      WHERE reviewed.id = NEW.reviewed_run_id AND reviewed.task_id = NEW.task_id
        AND reviewed.purpose IN ('implementation', 'repair')
        AND reviewed.source_head = NEW.source_head AND reviewed.status = 'succeeded'
        AND trim(reviewed.session_ref) = trim(NEW.reviewed_session_ref)
    )
  THEN RAISE(ABORT, 'independent review receipt requires durable provider session identity for distinct canonical succeeded reviewed and review runs') END;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS supervisor_completion_commits_authority_insert;
--> statement-breakpoint
CREATE TRIGGER supervisor_completion_commits_authority_insert
BEFORE INSERT ON supervisor_completion_commits
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM independent_review_receipts irr
    JOIN agent_runs review ON review.id = irr.run_id AND review.task_id = irr.task_id
    JOIN agent_runs reviewed ON reviewed.id = irr.reviewed_run_id AND reviewed.task_id = irr.task_id
    JOIN agent_providers ap ON ap.id = irr.provider_id AND ap.id = review.provider_id
    WHERE irr.id = NEW.receipt_id AND irr.project = NEW.project AND irr.goal_id = NEW.goal_id
      AND irr.pending_claimed_at = NEW.pending_claimed_at AND irr.source_head = NEW.source_head
      AND irr.source_tree_digest = NEW.source_tree_digest AND irr.verdict = NEW.verdict
      AND irr.purpose = 'independent_completion_review' AND irr.execution_status = 'succeeded'
      AND irr.provider_account_label = ap.account_label
      AND ap.name = CASE irr.provider WHEN 'claude' THEN 'claude-code' ELSE irr.provider END
      AND review.purpose = 'review' AND review.independence_loss IS NULL
      AND review.source_head = NEW.source_head AND review.status = 'succeeded'
      AND trim(review.session_ref) <> '' AND review.session_ref = irr.review_session_ref
      AND reviewed.id <> review.id AND reviewed.purpose IN ('implementation', 'repair')
      AND reviewed.source_head = NEW.source_head AND reviewed.status = 'succeeded'
      AND trim(reviewed.session_ref) <> '' AND reviewed.session_ref = irr.reviewed_session_ref
  ) THEN RAISE(ABORT, 'supervisor completion commit requires session-bound canonical review authority') END;
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS tasks_completion_requires_major_review_provenance;
--> statement-breakpoint
CREATE TRIGGER tasks_completion_requires_major_review_provenance
BEFORE UPDATE ON tasks
WHEN NEW.status = 'completed' AND OLD.status <> 'completed'
  AND json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.review') = 'independent'
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM independent_review_receipts irr
    JOIN agent_runs review ON review.id = irr.run_id AND review.task_id = NEW.id
    JOIN agent_runs reviewed ON reviewed.id = irr.reviewed_run_id AND reviewed.task_id = NEW.id
    WHERE irr.task_id = NEW.id
      AND irr.source_head = json_extract(NEW.completion_criteria_snapshot_json, '$.progressiveValidation.candidateHead')
      AND irr.verdict = 'pass' AND irr.execution_status = 'succeeded'
      AND irr.dispatch_id IS NOT NULL AND trim(irr.dispatch_id) <> ''
      AND review.purpose = 'review' AND review.status = 'succeeded'
      AND review.independence_loss IS NULL
      AND trim(review.session_ref) <> '' AND review.session_ref = irr.review_session_ref
      AND reviewed.id <> review.id AND reviewed.purpose IN ('implementation', 'repair')
      AND reviewed.status = 'succeeded' AND reviewed.source_head = review.source_head
      AND trim(reviewed.session_ref) <> '' AND reviewed.session_ref = irr.reviewed_session_ref
  ) THEN RAISE(ABORT, 'independent task completion requires session-bound Major-owned execution review provenance') END;
END;
--> statement-breakpoint
CREATE TRIGGER independent_review_receipts_session_refs_immutable
BEFORE UPDATE OF review_session_ref, reviewed_session_ref ON independent_review_receipts
BEGIN
  SELECT RAISE(ABORT, 'independent review receipts are append-only');
END;

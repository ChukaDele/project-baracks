ALTER TABLE independent_review_receipts ADD COLUMN task_id text REFERENCES tasks(id);
--> statement-breakpoint
ALTER TABLE independent_review_receipts ADD COLUMN provider_id text REFERENCES agent_providers(id);
--> statement-breakpoint
ALTER TABLE independent_review_receipts ADD COLUMN provider_account_label text;
--> statement-breakpoint
CREATE TRIGGER independent_review_receipts_canonical_run_insert
BEFORE INSERT ON independent_review_receipts
WHEN NEW.task_id IS NOT NULL OR NEW.provider_id IS NOT NULL OR NEW.provider_account_label IS NOT NULL
BEGIN
  SELECT CASE WHEN NEW.task_id IS NULL OR NEW.provider_id IS NULL OR NEW.provider_account_label IS NULL
    OR NOT EXISTS (
      SELECT 1
      FROM agent_runs ar
      JOIN agent_providers ap ON ap.id = ar.provider_id
      WHERE ar.id = NEW.run_id
        AND ar.task_id = NEW.task_id
        AND ar.provider_id = NEW.provider_id
        AND ap.account_label = NEW.provider_account_label
        AND ap.name = CASE NEW.provider WHEN 'claude' THEN 'claude-code' ELSE NEW.provider END
        AND ar.purpose = 'review'
        AND ar.source_head = NEW.source_head
        AND ar.status = 'succeeded'
    )
  THEN RAISE(ABORT, 'independent review receipt requires canonical succeeded task review run') END;
END;
--> statement-breakpoint
CREATE TABLE supervisor_completion_commits (
  id text PRIMARY KEY NOT NULL,
  project text NOT NULL,
  goal_id text NOT NULL,
  receipt_id text NOT NULL UNIQUE REFERENCES independent_review_receipts(id),
  pending_claimed_at text NOT NULL,
  source_head text NOT NULL CHECK(length(source_head) = 40 AND source_head NOT GLOB '*[^0-9a-f]*'),
  source_tree_digest text NOT NULL CHECK(length(source_tree_digest) = 64 AND source_tree_digest NOT GLOB '*[^0-9a-f]*'),
  verdict text NOT NULL CHECK(verdict IN ('pass', 'fail')),
  final_goal_json text NOT NULL CHECK(
    json_valid(final_goal_json)
    AND json_extract(final_goal_json, '$.id') = goal_id
    AND json_extract(final_goal_json, '$.project') = project
    AND json_type(final_goal_json, '$.pendingCompletion') IS NULL
    AND (
      (verdict = 'pass' AND json_extract(final_goal_json, '$.status') = 'done')
      OR (verdict = 'fail' AND json_extract(final_goal_json, '$.status') = 'active')
    )
  ),
  created_at text NOT NULL
);
--> statement-breakpoint
CREATE INDEX supervisor_completion_commits_goal ON supervisor_completion_commits(project, goal_id);
--> statement-breakpoint
CREATE TRIGGER supervisor_completion_commits_authority_insert
BEFORE INSERT ON supervisor_completion_commits
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM independent_review_receipts irr
    JOIN agent_runs ar ON ar.id = irr.run_id AND ar.task_id = irr.task_id
    JOIN agent_providers ap ON ap.id = irr.provider_id AND ap.id = ar.provider_id
    WHERE irr.id = NEW.receipt_id
      AND irr.project = NEW.project
      AND irr.goal_id = NEW.goal_id
      AND irr.pending_claimed_at = NEW.pending_claimed_at
      AND irr.source_head = NEW.source_head
      AND irr.verdict = NEW.verdict
      AND irr.purpose = 'independent_completion_review'
      AND irr.execution_status = 'succeeded'
      AND irr.provider_account_label = ap.account_label
      AND ap.name = CASE irr.provider WHEN 'claude' THEN 'claude-code' ELSE irr.provider END
      AND ar.purpose = 'review'
      AND ar.source_head = NEW.source_head
      AND ar.status = 'succeeded'
  ) THEN RAISE(ABORT, 'supervisor completion commit requires canonical review authority') END;
END;
--> statement-breakpoint
CREATE TRIGGER supervisor_completion_commits_append_only_update
BEFORE UPDATE ON supervisor_completion_commits BEGIN
  SELECT RAISE(ABORT, 'supervisor completion commits are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER supervisor_completion_commits_append_only_delete
BEFORE DELETE ON supervisor_completion_commits BEGIN
  SELECT RAISE(ABORT, 'supervisor completion commits are append-only');
END;

CREATE TABLE `validation_leases` (
  `id` text PRIMARY KEY NOT NULL,
  `activation_slot` integer DEFAULT 1 NOT NULL,
  `token_hash` text NOT NULL,
  `authority_lease_id` text NOT NULL,
  `authority_artifact_digest` text NOT NULL,
  `authority_validation_nonce` text NOT NULL,
  `authority_expires_at` text NOT NULL,
  `release_repository` text NOT NULL,
  `release_source_checkout` text NOT NULL,
  `release_root` text NOT NULL,
  `release_branch` text NOT NULL,
  `release_sha` text NOT NULL,
  `release_tree_hash` text NOT NULL,
  `release_manifest_hash` text NOT NULL,
  `provider` text NOT NULL,
  `project_identity_hash` text NOT NULL,
  `project_root_hash` text NOT NULL,
  `case_id` text NOT NULL,
  `request_digest` text NOT NULL,
  `expected_evidence_hash` text NOT NULL,
  `expected_execution_status` text NOT NULL,
  `worker_id` text NOT NULL,
  `process_nonce` text NOT NULL,
  `resource_lease_id` text,
  `predecessor_lease_id` text,
  `status` text DEFAULT 'issued' NOT NULL,
  `expires_at` text NOT NULL,
  `admitted_at` text,
  `terminal_at` text,
  `run_id` text,
  `outcome_reason` text,
  `evidence_hash` text,
  `evidence_json` text,
  `result_session_ref_hash` text,
  `result_model` text,
  `result_event_hash` text,
  `result_event_count` integer,
  `result_workspace_hash` text,
  `created_at` text NOT NULL,
  `updated_at` text NOT NULL,
  CONSTRAINT `validation_leases_status_valid` CHECK(`status` IN ('issued','admitted','running','validating','succeeded','failed','cancelled','expired')),
  CONSTRAINT `validation_leases_activation_slot` CHECK(`activation_slot` = 1),
  CONSTRAINT `validation_leases_expected_status_valid` CHECK(`expected_execution_status` IN ('succeeded','cancelled')),
  CONSTRAINT `validation_leases_sha_valid` CHECK(length(`release_sha`) = 40 AND `release_sha` NOT GLOB '*[^0-9a-f]*'),
  CONSTRAINT `validation_leases_digest_valid` CHECK(
    length(`token_hash`) = 64 AND `token_hash` NOT GLOB '*[^0-9a-f]*'
    AND length(`authority_artifact_digest`) = 64 AND `authority_artifact_digest` NOT GLOB '*[^0-9a-f]*'
    AND length(`authority_validation_nonce`) = 36 AND `authority_validation_nonce` NOT GLOB '*[^0-9a-f-]*'
    AND length(`release_manifest_hash`) = 64 AND `release_manifest_hash` NOT GLOB '*[^0-9a-f]*'
    AND length(`release_tree_hash`) = 64 AND `release_tree_hash` NOT GLOB '*[^0-9a-f]*'
    AND length(`project_identity_hash`) = 64 AND `project_identity_hash` NOT GLOB '*[^0-9a-f]*'
    AND length(`project_root_hash`) = 64 AND `project_root_hash` NOT GLOB '*[^0-9a-f]*'
    AND length(`request_digest`) = 64 AND `request_digest` NOT GLOB '*[^0-9a-f]*'
    AND length(`expected_evidence_hash`) = 64 AND `expected_evidence_hash` NOT GLOB '*[^0-9a-f]*'
  )
);--> statement-breakpoint
CREATE UNIQUE INDEX `validation_leases_token_hash` ON `validation_leases` (`token_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `validation_leases_authority_request` ON `validation_leases` (`authority_artifact_digest`,`request_digest`);--> statement-breakpoint
CREATE UNIQUE INDEX `validation_leases_one_active` ON `validation_leases` (`activation_slot`) WHERE `status` IN ('issued','admitted','running','validating');--> statement-breakpoint
CREATE INDEX `validation_leases_release_sha` ON `validation_leases` (`release_sha`);--> statement-breakpoint
CREATE INDEX `validation_leases_status` ON `validation_leases` (`status`);--> statement-breakpoint

CREATE TRIGGER validation_leases_no_delete
BEFORE DELETE ON validation_leases
BEGIN
  SELECT RAISE(ABORT, 'validation lease history is append-only');
END;--> statement-breakpoint

CREATE TRIGGER validation_leases_immutable_identity
BEFORE UPDATE ON validation_leases
WHEN NEW.id <> OLD.id
  OR NEW.activation_slot <> OLD.activation_slot
  OR NEW.token_hash <> OLD.token_hash
  OR NEW.authority_lease_id <> OLD.authority_lease_id
  OR NEW.authority_artifact_digest <> OLD.authority_artifact_digest
  OR NEW.authority_validation_nonce <> OLD.authority_validation_nonce
  OR NEW.authority_expires_at <> OLD.authority_expires_at
  OR NEW.release_repository <> OLD.release_repository
  OR NEW.release_source_checkout <> OLD.release_source_checkout
  OR NEW.release_root <> OLD.release_root
  OR NEW.release_branch <> OLD.release_branch
  OR NEW.release_sha <> OLD.release_sha
  OR NEW.release_tree_hash <> OLD.release_tree_hash
  OR NEW.release_manifest_hash <> OLD.release_manifest_hash
  OR NEW.provider <> OLD.provider
  OR NEW.project_identity_hash <> OLD.project_identity_hash
  OR NEW.project_root_hash <> OLD.project_root_hash
  OR NEW.case_id <> OLD.case_id
  OR NEW.request_digest <> OLD.request_digest
  OR NEW.expected_evidence_hash <> OLD.expected_evidence_hash
  OR NEW.expected_execution_status <> OLD.expected_execution_status
  OR NEW.worker_id <> OLD.worker_id
  OR NEW.process_nonce <> OLD.process_nonce
  OR NEW.resource_lease_id IS NOT OLD.resource_lease_id
  OR NEW.predecessor_lease_id IS NOT OLD.predecessor_lease_id
  OR NEW.created_at <> OLD.created_at
BEGIN
  SELECT RAISE(ABORT, 'validation lease identity is immutable');
END;--> statement-breakpoint

CREATE TRIGGER validation_leases_result_attestation_immutable
BEFORE UPDATE ON validation_leases
WHEN OLD.status = 'validating' AND (
  NEW.run_id IS NOT OLD.run_id
  OR NEW.result_session_ref_hash IS NOT OLD.result_session_ref_hash
  OR NEW.result_model IS NOT OLD.result_model
  OR NEW.result_event_hash IS NOT OLD.result_event_hash
  OR NEW.result_event_count IS NOT OLD.result_event_count
  OR NEW.result_workspace_hash IS NOT OLD.result_workspace_hash
)
BEGIN
  SELECT RAISE(ABORT, 'validation result attestation is immutable');
END;--> statement-breakpoint

CREATE TRIGGER validation_leases_transition_valid
BEFORE UPDATE OF status ON validation_leases
WHEN NOT (
  (OLD.status = 'issued' AND NEW.status IN ('admitted','cancelled','expired'))
  OR (OLD.status = 'admitted' AND NEW.status IN ('running','cancelled','expired'))
  OR (OLD.status = 'running' AND NEW.status IN ('validating','failed','cancelled','expired'))
  OR (OLD.status = 'validating' AND NEW.status IN ('succeeded','failed','cancelled','expired'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid validation lease transition');
END;
--> statement-breakpoint
CREATE TRIGGER validation_leases_terminal_immutable
BEFORE UPDATE ON validation_leases
WHEN OLD.status IN ('succeeded','failed','cancelled','expired')
BEGIN
  SELECT RAISE(ABORT, 'terminal validation leases are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER validation_leases_admission_live
BEFORE UPDATE OF status ON validation_leases
WHEN NEW.status = 'admitted' AND (
  OLD.status <> 'issued'
  OR NEW.admitted_at IS NULL
  OR OLD.expires_at <= NEW.admitted_at
)
BEGIN
  SELECT RAISE(ABORT, 'validation admission requires an unexpired issued lease');
END;
--> statement-breakpoint
CREATE TRIGGER validation_leases_success_has_evidence
BEFORE UPDATE OF status ON validation_leases
WHEN NEW.status = 'succeeded' AND (
  OLD.status <> 'validating'
  OR NEW.run_id IS NOT OLD.run_id
  OR NEW.result_session_ref_hash IS NOT OLD.result_session_ref_hash
  OR NEW.result_model IS NOT OLD.result_model
  OR NEW.result_event_hash IS NOT OLD.result_event_hash
  OR NEW.result_event_count IS NOT OLD.result_event_count
  OR NEW.result_workspace_hash IS NOT OLD.result_workspace_hash
  OR NEW.evidence_hash IS NULL
  OR NEW.evidence_json IS NULL
  OR json_valid(NEW.evidence_json) <> 1
  OR sha256(NEW.evidence_json) <> NEW.evidence_hash
  OR EXISTS (
    SELECT 1 FROM json_each(NEW.evidence_json)
    WHERE key NOT IN (
      'gate','provider','phase','status','runId','cleanup','eventCount',
      'sessionEvidence','usageEvidence','modelEvidence','workspaceEvidence',
      'transcriptDigest','workspaceDigest'
    )
  )
  OR json_extract(NEW.evidence_json, '$.gate') IS NOT 'provider-field'
  OR json_type(NEW.evidence_json, '$.provider') IS NOT 'text'
  OR json_extract(NEW.evidence_json, '$.provider') NOT IN ('claude','codex','cursor','antigravity')
  OR json_extract(NEW.evidence_json, '$.provider') <> NEW.provider
  OR json_extract(NEW.evidence_json, '$.status') IS NOT 'PASS'
  OR json_extract(NEW.evidence_json, '$.cleanup') IS NOT 'complete'
  OR json_type(NEW.evidence_json, '$.eventCount') IS NOT 'integer'
  OR json_extract(NEW.evidence_json, '$.eventCount') < 1
  OR json_extract(NEW.evidence_json, '$.eventCount') <> NEW.result_event_count
  OR json_extract(NEW.evidence_json, '$.transcriptDigest') <> NEW.result_event_hash
  OR json_extract(NEW.evidence_json, '$.workspaceDigest') <> NEW.result_workspace_hash
  OR json_type(NEW.evidence_json, '$.runId') IS NOT 'text'
  OR json_extract(NEW.evidence_json, '$.runId') <> NEW.run_id
  OR length(json_extract(NEW.evidence_json, '$.runId')) <> 36
  OR json_extract(NEW.evidence_json, '$.runId') GLOB '*[^0-9a-f-]*'
  OR substr(json_extract(NEW.evidence_json, '$.runId'), 9, 1) <> '-'
  OR substr(json_extract(NEW.evidence_json, '$.runId'), 14, 1) <> '-'
  OR substr(json_extract(NEW.evidence_json, '$.runId'), 19, 1) <> '-'
  OR substr(json_extract(NEW.evidence_json, '$.runId'), 24, 1) <> '-'
  OR (
    NEW.provider = 'cursor' AND (
      (SELECT count(*) FROM json_each(NEW.evidence_json)) <> 12
      OR json_extract(NEW.evidence_json, '$.phase') NOT IN ('create','resume','cancel')
      OR (NEW.expected_execution_status = 'cancelled' AND json_extract(NEW.evidence_json, '$.phase') <> 'cancel')
      OR (NEW.expected_execution_status = 'succeeded' AND NEW.predecessor_lease_id IS NOT NULL AND json_extract(NEW.evidence_json, '$.phase') <> 'resume')
      OR (NEW.expected_execution_status = 'succeeded' AND NEW.predecessor_lease_id IS NULL AND json_extract(NEW.evidence_json, '$.phase') <> 'create')
      OR json_extract(NEW.evidence_json, '$.sessionEvidence') NOT IN ('present','not-applicable')
      OR json_extract(NEW.evidence_json, '$.modelEvidence') NOT IN ('present','not-applicable')
      OR json_extract(NEW.evidence_json, '$.workspaceEvidence') NOT IN ('exact-file','empty')
      OR (json_extract(NEW.evidence_json, '$.phase') IN ('create','resume') AND json_extract(NEW.evidence_json, '$.sessionEvidence') <> 'present')
      OR (json_extract(NEW.evidence_json, '$.phase') IN ('create','resume') AND json_extract(NEW.evidence_json, '$.modelEvidence') <> 'present')
      OR (json_extract(NEW.evidence_json, '$.phase') IN ('create','resume') AND json_extract(NEW.evidence_json, '$.workspaceEvidence') <> 'exact-file')
      OR (json_extract(NEW.evidence_json, '$.phase') = 'cancel' AND json_extract(NEW.evidence_json, '$.workspaceEvidence') <> 'empty')
    )
  )
  OR (
    NEW.provider <> 'cursor' AND (
      (SELECT count(*) FROM json_each(NEW.evidence_json)) <> 11
      OR json_extract(NEW.evidence_json, '$.sessionEvidence') NOT IN ('present','unsupported')
      OR json_extract(NEW.evidence_json, '$.usageEvidence') NOT IN ('present','unsupported')
      OR json_extract(NEW.evidence_json, '$.workspaceEvidence') NOT IN ('exact-single-file','empty')
      OR (NEW.provider = 'claude' AND json_extract(NEW.evidence_json, '$.workspaceEvidence') <> 'exact-single-file')
      OR (NEW.provider <> 'claude' AND json_extract(NEW.evidence_json, '$.workspaceEvidence') <> 'empty')
      OR (NEW.provider IN ('claude','codex') AND json_extract(NEW.evidence_json, '$.sessionEvidence') <> 'present')
    )
  )
  OR length(NEW.evidence_hash) <> 64
  OR NEW.evidence_hash GLOB '*[^0-9a-f]*'
)
BEGIN
  SELECT RAISE(ABORT, 'successful validation requires hashed evidence');
END;
--> statement-breakpoint
CREATE TRIGGER validation_leases_backend_start_live
BEFORE UPDATE OF status ON validation_leases
WHEN NEW.status = 'running' AND (
  OLD.status <> 'admitted'
  OR OLD.expires_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
)
BEGIN
  SELECT RAISE(ABORT, 'validation backend start requires an unexpired admitted lease');
END;
--> statement-breakpoint
CREATE TRIGGER validation_leases_result_live
BEFORE UPDATE OF status ON validation_leases
WHEN NEW.status IN ('succeeded','failed','validating') AND (
  NEW.terminal_at IS NULL
  OR OLD.expires_at <= NEW.terminal_at
  OR (NEW.status = 'validating' AND (
    NEW.run_id IS NULL
    OR NEW.result_event_hash IS NULL
    OR length(NEW.result_event_hash) <> 64
    OR NEW.result_event_hash GLOB '*[^0-9a-f]*'
    OR NEW.result_event_count IS NULL
    OR NEW.result_event_count < 1
    OR NEW.result_workspace_hash IS NULL
    OR length(NEW.result_workspace_hash) <> 64
    OR NEW.result_workspace_hash GLOB '*[^0-9a-f]*'
  ))
)
BEGIN
  SELECT RAISE(ABORT, 'validation result requires an unexpired running lease');
END;

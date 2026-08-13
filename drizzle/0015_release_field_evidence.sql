DROP TRIGGER validation_leases_success_has_evidence;--> statement-breakpoint
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
  OR json_type(NEW.evidence_json, '$.provider') IS NOT 'text'
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
  OR length(NEW.evidence_hash) <> 64
  OR NEW.evidence_hash GLOB '*[^0-9a-f]*'
  OR (
    NEW.case_id = 'provider-field' AND (
      EXISTS (
        SELECT 1 FROM json_each(NEW.evidence_json)
        WHERE key NOT IN (
          'gate','provider','phase','status','runId','cleanup','eventCount',
          'sessionEvidence','usageEvidence','modelEvidence','workspaceEvidence',
          'transcriptDigest','workspaceDigest'
        )
      )
      OR json_extract(NEW.evidence_json, '$.gate') IS NOT 'provider-field'
      OR json_extract(NEW.evidence_json, '$.provider') NOT IN ('claude','codex','cursor','antigravity')
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
    )
  )
  OR (
    NEW.case_id <> 'provider-field' AND (
      NEW.case_id NOT IN ('jss-field','surface-talent-field','cross-project-isolation','failure-recovery','burn-in-1','burn-in-2','burn-in-3')
      OR (SELECT count(*) FROM json_each(NEW.evidence_json)) <> 12
      OR EXISTS (
        SELECT 1 FROM json_each(NEW.evidence_json)
        WHERE key NOT IN (
          'gate','provider','status','runId','cleanup','eventCount','sessionEvidence',
          'workspaceEvidence','caseEvidence','transcriptDigest','workspaceDigest','projectSha'
        )
      )
      OR json_extract(NEW.evidence_json, '$.gate') <> NEW.case_id
      OR json_type(NEW.evidence_json, '$.projectSha') IS NOT 'text'
      OR length(json_extract(NEW.evidence_json, '$.projectSha')) <> 40
      OR json_extract(NEW.evidence_json, '$.projectSha') GLOB '*[^0-9a-f]*'
      OR json_extract(NEW.evidence_json, '$.sessionEvidence') NOT IN ('present','unsupported')
      OR json_extract(NEW.evidence_json, '$.workspaceEvidence') NOT IN ('read-only','exact-project-delta')
      OR json_extract(NEW.evidence_json, '$.caseEvidence') NOT IN (
        'project-tests-pass','observe-project-read','isolated-project-read',
        'recovered-after-observed-worker-stop','bounded-cycle-pass'
      )
      OR (NEW.case_id = 'jss-field' AND (
        NEW.provider <> 'claude'
        OR json_extract(NEW.evidence_json, '$.workspaceEvidence') <> 'exact-project-delta'
        OR json_extract(NEW.evidence_json, '$.caseEvidence') <> 'project-tests-pass'
      ))
      OR (NEW.case_id <> 'jss-field' AND (
        NEW.provider <> 'codex'
        OR json_extract(NEW.evidence_json, '$.workspaceEvidence') <> 'read-only'
      ))
      OR (NEW.case_id = 'failure-recovery' AND (
        NEW.predecessor_lease_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM validation_leases AS predecessor
          WHERE predecessor.id = NEW.predecessor_lease_id
            AND predecessor.status IN ('failed','cancelled')
            AND predecessor.provider = 'cursor'
            AND predecessor.release_sha = NEW.release_sha
            AND predecessor.project_identity_hash = NEW.project_identity_hash
            AND predecessor.project_root_hash = NEW.project_root_hash
            AND predecessor.outcome_reason LIKE '%errorKind=interrupted; cleanup=complete%'
        )
      ))
    )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'successful validation requires case-bound hashed evidence');
END;

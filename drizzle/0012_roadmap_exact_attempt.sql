-- M5 groundwork: enforce one persisted roadmap-mutation host and preserve
-- exact attempt identity on every applying-state transition.
CREATE TABLE roadmap_runtime_hosts (
  id text PRIMARY KEY NOT NULL,
  host_id text NOT NULL,
  created_at text NOT NULL
);
--> statement-breakpoint

CREATE TRIGGER roadmap_updates_attempt_identity_immutable
BEFORE UPDATE ON roadmap_updates
WHEN OLD.status = 'applying'
  AND NEW.status IN ('applied', 'rejected')
  AND (
    NEW.apply_attempt_id IS NOT OLD.apply_attempt_id
    OR NEW.apply_worker_id IS NOT OLD.apply_worker_id
    OR NEW.apply_lease_expires_at IS NOT OLD.apply_lease_expires_at
  )
BEGIN
  SELECT RAISE(ABORT, 'settling roadmap apply must preserve exact attempt identity');
END;
--> statement-breakpoint

CREATE TRIGGER roadmap_updates_requeue_requires_expired_exact_attempt
BEFORE UPDATE ON roadmap_updates
WHEN OLD.status = 'applying' AND NEW.status = 'proposed'
  AND (
    OLD.apply_attempt_id IS NULL
    OR OLD.apply_worker_id IS NULL
    OR OLD.apply_lease_expires_at IS NULL
    OR OLD.apply_lease_expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    OR NEW.apply_attempt_id IS NOT NULL
    OR NEW.apply_worker_id IS NOT NULL
    OR NEW.apply_lease_expires_at IS NOT NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'requeue requires the expired exact roadmap apply attempt');
END;

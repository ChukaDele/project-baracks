-- P1-6: a roadmap apply attempt gains an owner and a lease. Reconciliation
-- reclaims an 'applying' row only AFTER querying the adapter's idempotency
-- record (already-applied -> Applied, never re-written) and only once the
-- lease has lapsed, so a still-running external write is never displaced and
-- lease expiry alone never authorises another write.
ALTER TABLE `roadmap_updates` ADD COLUMN `apply_worker_id` text;--> statement-breakpoint
ALTER TABLE `roadmap_updates` ADD COLUMN `apply_lease_expires_at` text;

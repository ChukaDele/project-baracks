import { and, asc, eq, gt, lt, max } from 'drizzle-orm';
import type { Db, DbConn } from '../db/client.js';
import { taskClaims, tasks } from '../db/schema.js';
import { assertCapabilityAvailable } from '../security/capabilities.js';
import { newId } from './ids.js';
import { applyTransition, ConcurrencyError } from './task-service.js';

/**
 * Durable queue claims — the worker dispatch/lease model.
 *
 * IN THIS BUILD, WORKER OPERATIONS ARE DISABLED. Worker-owned downstream
 * mutations are an unavailable capability (src/security/capabilities.ts):
 * claimNextTask, heartbeatClaim, completeClaim and releaseClaim refuse
 * unconditionally, so nothing can acquire or exercise a work claim until
 * the combined M4 fencing boundary passes independent review and activation.
 * Only reads (getClaim) and the supervisor-side crash-recovery sweep
 * (recoverExpiredClaims) remain runnable. The lease/fencing machinery below
 * the gates — BEGIN IMMEDIATE claim transactions, the task_claims_one_active
 * unique index, the ownerFence predicate — is retained, compiled and
 * DB-backed as the quarantined M4 implementation.
 */

const DEFAULT_LEASE_MS = 5 * 60 * 1000;

export class StaleClaimError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StaleClaimError';
  }
}

export interface ClaimOptions {
  /** Durable worker identity, stable across the worker's lifetime. */
  workerId: string;
  leaseMs?: number;
  projectId?: string;
  now?: () => Date;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function getClaim(db: DbConn, claimId: string) {
  const row = db.select().from(taskClaims).where(eq(taskClaims.id, claimId)).get();
  if (!row) throw new Error(`claim not found: ${claimId}`);
  return row;
}

/**
 * Atomically claim the oldest queued task: insert an active claim (next
 * attempt number) and move the task queued -> running, all in one immediate
 * transaction.
 */
export function claimNextTask(db: Db, options: ClaimOptions) {
  assertCapabilityAvailable('worker-owned-downstream-mutations');
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  return db.transaction(
    (tx) => {
      const nowMs = (options.now?.() ?? new Date()).getTime();
      const conditions = options.projectId
        ? and(eq(tasks.status, 'queued'), eq(tasks.projectId, options.projectId))
        : eq(tasks.status, 'queued');
      const candidates = tx
        .select()
        .from(tasks)
        .where(conditions)
        .orderBy(asc(tasks.createdAt))
        .all();
      for (const task of candidates) {
        const active = tx
          .select()
          .from(taskClaims)
          .where(and(eq(taskClaims.taskId, task.id), eq(taskClaims.status, 'active')))
          .get();
        if (active) continue; // another worker holds it (should imply not 'queued')
        const lastAttempt =
          tx
            .select({ m: max(taskClaims.attempt) })
            .from(taskClaims)
            .where(eq(taskClaims.taskId, task.id))
            .get()?.m ?? 0;
        const claim = {
          id: newId('tclm'),
          taskId: task.id,
          workerId: options.workerId,
          attempt: lastAttempt + 1,
          status: 'active' as const,
          leaseExpiresAt: iso(nowMs + leaseMs),
          heartbeatAt: iso(nowMs),
        };
        tx.insert(taskClaims).values(claim).run();
        const fence = {
          claimId: claim.id,
          workerId: claim.workerId,
          ...(options.now ? { now: options.now } : {}),
        };
        const updated = applyTransition(tx, task.id, 'running', { fence });
        return { claim: getClaim(tx, claim.id), task: updated };
      }
      return undefined;
    },
    { behavior: 'immediate' },
  );
}

/** The fencing predicate: this worker's claim, still active, lease unexpired. */
function ownerFence(claimId: string, workerId: string, nowMs: number) {
  return and(
    eq(taskClaims.id, claimId),
    eq(taskClaims.workerId, workerId),
    eq(taskClaims.status, 'active'),
    gt(taskClaims.leaseExpiresAt, iso(nowMs)),
  );
}

/** Extend an active, unexpired claim's lease. Throws StaleClaimError when the
 * claim is no longer this worker's live claim — wrong worker, already closed,
 * or (crucially) lease already expired, even before a recovery sweep. */
export function heartbeatClaim(
  db: Db,
  claimId: string,
  workerId: string,
  leaseMs: number = DEFAULT_LEASE_MS,
  now: () => Date = () => new Date(),
) {
  assertCapabilityAvailable('worker-owned-downstream-mutations');
  const nowMs = now().getTime();
  const result = db
    .update(taskClaims)
    .set({ heartbeatAt: iso(nowMs), leaseExpiresAt: iso(nowMs + leaseMs) })
    .where(ownerFence(claimId, workerId, nowMs))
    .run();
  if (result.changes !== 1) {
    throw new StaleClaimError(
      `claim ${claimId} is not an active, unexpired claim of worker ${workerId}`,
    );
  }
  return getClaim(db, claimId);
}

function closeClaim(
  db: DbConn,
  claimId: string,
  workerId: string,
  status: 'completed' | 'released',
  reason: string,
  nowMs: number,
) {
  const result = db
    .update(taskClaims)
    .set({ status, outcomeReason: reason })
    .where(ownerFence(claimId, workerId, nowMs))
    .run();
  if (result.changes !== 1) {
    throw new StaleClaimError(
      `claim ${claimId} is not an active, unexpired claim of worker ${workerId}`,
    );
  }
  return getClaim(db, claimId);
}

/** Mark the claim finished after the task moved past 'running'. */
export function completeClaim(
  db: Db,
  claimId: string,
  workerId: string,
  reason = 'completed',
  now: () => Date = () => new Date(),
) {
  assertCapabilityAvailable('worker-owned-downstream-mutations');
  return db.transaction(
    (tx) => closeClaim(tx, claimId, workerId, 'completed', reason, now().getTime()),
    { behavior: 'immediate' },
  );
}

/**
 * Explicit cancellation/handback: release the claim and either requeue the
 * task (handback) or cancel it, atomically.
 */
export function releaseClaim(
  db: Db,
  options: {
    claimId: string;
    workerId: string;
    requeue: boolean;
    reason: string;
    now?: () => Date;
  },
) {
  assertCapabilityAvailable('worker-owned-downstream-mutations');
  return db.transaction(
    (tx) => {
      const nowMs = (options.now?.() ?? new Date()).getTime();
      const claim = closeClaim(
        tx,
        options.claimId,
        options.workerId,
        'released',
        options.reason,
        nowMs,
      );
      const task = applyTransition(tx, claim.taskId, options.requeue ? 'queued' : 'cancelled');
      return { claim, task };
    },
    { behavior: 'immediate' },
  );
}

/**
 * Crash recovery: expire every active claim whose lease has lapsed and
 * requeue its task. Idempotent — a second sweep (or a concurrent worker's
 * sweep) finds nothing left to do. Attempt history is preserved; the next
 * claim on the task gets a new attempt number.
 */
export function recoverExpiredClaims(db: Db, now: () => Date = () => new Date()) {
  return db.transaction(
    (tx) => {
      const nowIso = now().toISOString();
      const expired = tx
        .select()
        .from(taskClaims)
        .where(and(eq(taskClaims.status, 'active'), lt(taskClaims.leaseExpiresAt, nowIso)))
        .all();
      const recovered: { claimId: string; taskId: string }[] = [];
      for (const claim of expired) {
        const result = tx
          .update(taskClaims)
          .set({ status: 'expired', outcomeReason: `lease expired at ${claim.leaseExpiresAt}` })
          .where(and(eq(taskClaims.id, claim.id), eq(taskClaims.status, 'active')))
          .run();
        if (result.changes !== 1) {
          throw new ConcurrencyError(`claim ${claim.id} changed during recovery`);
        }
        const task = tx.select().from(tasks).where(eq(tasks.id, claim.taskId)).get();
        if (task?.status === 'running') {
          applyTransition(tx, claim.taskId, 'queued');
        }
        recovered.push({ claimId: claim.id, taskId: claim.taskId });
      }
      return recovered;
    },
    { behavior: 'immediate' },
  );
}

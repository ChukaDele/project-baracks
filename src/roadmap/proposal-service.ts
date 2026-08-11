import { and, eq, inArray } from 'drizzle-orm';
import { hostname } from 'node:os';
import type { Db } from '../db/client.js';
import {
  evidence,
  roadmapItems,
  roadmapRuntimeHosts,
  roadmapUpdates,
  tasks,
} from '../db/schema.js';
import { assertCapabilityAvailable } from '../security/capabilities.js';
import { isApprovedDecision } from '../domain/decision-service.js';
import { newId, nowIso } from '../domain/ids.js';
import {
  idempotencyKeyMatchesPayload,
  proposalIdempotencyKey,
  proposalPayloadHash,
} from './canonical.js';
import type { DiffEntry, RoadmapAdapter, RowChange, UpdateProposal } from './types.js';

/**
 * DB-backed proposal lifecycle for roadmap writes.
 *
 * IN THIS BUILD, APPLY IS DISABLED. External roadmap application is an
 * unavailable capability (src/security/capabilities.ts): applyRoadmapUpdate
 * and reconcileRoadmapApplies refuse unconditionally before touching the
 * adapter or the update record, so no external roadmap write can occur
 * through any code path. Proposals and their recorded dry runs remain fully
 * available — proposing stores local records and uses only the adapter's
 * read-side (revision/dryRun).
 *
 * The apply/reconcile protocol below the gates carries exact persisted attempt
 * identity. It remains quarantined until combined independent review and a
 * representative live-adapter test authorize activation.
 *
 * Roadmap permission grants NOTHING else: no merge, deploy, paid-usage or
 * destructive authority is inferred from the ability to propose updates.
 */

const DONE_VALUES = ['done', 'complete', 'completed'];

export interface ProposeInput {
  roadmapItemId: string;
  /** Human-meaningful key prefix; the payload hash is appended automatically. */
  baseKey: string;
  changes: RowChange[];
  rationale: string;
  evidenceIds?: string[];
  proposedByRunId?: string;
}

function isDoneChange(changes: readonly RowChange[]): boolean {
  return changes.some((change) =>
    Object.entries(change.columns).some(
      ([column, value]) => column === 'Status' && DONE_VALUES.includes(value.toLowerCase()),
    ),
  );
}

function getUpdate(db: Db, updateId: string) {
  const row = db.select().from(roadmapUpdates).where(eq(roadmapUpdates.id, updateId)).get();
  if (!row) throw new Error(`roadmap update not found: ${updateId}`);
  return row;
}

/** Create the proposal record WITH its dry run, bound to the source revision. */
export async function proposeRoadmapUpdate(db: Db, adapter: RoadmapAdapter, input: ProposeInput) {
  const item = db.select().from(roadmapItems).where(eq(roadmapItems.id, input.roadmapItemId)).get();
  if (!item) throw new Error(`roadmap item not found: ${input.roadmapItemId}`);

  const evidenceIds = input.evidenceIds ?? [];
  const proposal: UpdateProposal = {
    idempotencyKey: proposalIdempotencyKey(input.baseKey, { changes: input.changes }),
    changes: input.changes,
    rationale: input.rationale,
    evidenceRefs: evidenceIds,
  };

  if (isDoneChange(input.changes)) {
    assertDoneEvidence(db, input.roadmapItemId, evidenceIds);
  }

  const revision = await adapter.revision();
  const dryRun = await adapter.dryRun(proposal);
  if (!dryRun.ok) {
    throw new Error(`dry run rejected the proposal: ${dryRun.violations.join('; ')}`);
  }

  const row = {
    id: newId('rupd'),
    roadmapItemId: input.roadmapItemId,
    proposedByRunId: input.proposedByRunId ?? null,
    idempotencyKey: proposal.idempotencyKey,
    payloadHash: proposalPayloadHash(proposal),
    sourceRevision: revision,
    changesJson: JSON.stringify(input.changes),
    rationale: input.rationale,
    evidenceIdsJson: JSON.stringify(evidenceIds),
    dryRunDiff: JSON.stringify(dryRun.diff),
    dryRunAt: nowIso(),
    status: 'proposed' as const,
  };
  db.insert(roadmapUpdates).values(row).run();
  return getUpdate(db, row.id);
}

/** Done needs proof: every evidence id must exist and belong to a task of
 * THIS roadmap item. A non-empty evidence string proves nothing. */
function assertDoneEvidence(db: Db, roadmapItemId: string, evidenceIds: string[]) {
  if (evidenceIds.length === 0) {
    throw new Error('marking Done requires at least one evidence record');
  }
  const rows = db.select().from(evidence).where(inArray(evidence.id, evidenceIds)).all();
  const found = new Map(rows.map((r) => [r.id, r]));
  for (const id of evidenceIds) {
    const row = found.get(id);
    if (!row) throw new Error(`evidence not found: ${id}`);
    const task = db.select().from(tasks).where(eq(tasks.id, row.taskId)).get();
    if (task?.roadmapItemId !== roadmapItemId) {
      throw new Error(`evidence ${id} does not belong to a task of roadmap item ${roadmapItemId}`);
    }
  }
}

const DEFAULT_APPLY_LEASE_MS = 5 * 60 * 1000;
const ROADMAP_HOST_SINGLETON = 'roadmap-mutation-host';

/** Persist and enforce the supported single-host mutation assumption. */
export function bindRoadmapRuntimeHost(db: Db, hostId = hostname()): string {
  return db.transaction(
    (tx) => {
      const existing = tx
        .select()
        .from(roadmapRuntimeHosts)
        .where(eq(roadmapRuntimeHosts.id, ROADMAP_HOST_SINGLETON))
        .get();
      if (!existing) {
        tx.insert(roadmapRuntimeHosts).values({ id: ROADMAP_HOST_SINGLETON, hostId }).run();
        return hostId;
      }
      if (existing.hostId !== hostId) {
        throw new Error(
          `roadmap mutation is bound to host ${existing.hostId}; refusing host ${hostId}`,
        );
      }
      return existing.hostId;
    },
    { behavior: 'immediate' },
  );
}

export interface ApplyRoadmapOptions {
  /** Required when the proposal marks a row Done. */
  roadmapDoneDecisionId?: string;
  /** Durable identity of the worker performing the apply. */
  workerId?: string;
  /** How long the apply attempt holds its lease (default 5 minutes). */
  applyLeaseMs?: number;
  now?: () => Date;
}

/** Rebuild the canonical proposal from a stored update and verify that the
 * stored payload identity still binds the stored changes and key. */
function proposalFromUpdate(update: ReturnType<typeof getUpdate>): UpdateProposal {
  const changes = JSON.parse(update.changesJson) as RowChange[];
  const proposal: UpdateProposal = {
    idempotencyKey: update.idempotencyKey,
    changes,
    rationale: update.rationale,
    evidenceRefs: JSON.parse(update.evidenceIdsJson) as string[],
  };
  if (proposalPayloadHash(proposal) !== update.payloadHash) {
    throw new Error(`roadmap update ${update.id} payload hash mismatch — record tampered`);
  }
  if (!idempotencyKeyMatchesPayload(update.idempotencyKey, proposal)) {
    throw new Error(`roadmap update ${update.id} idempotency key does not bind its payload`);
  }
  return proposal;
}

/** Compare-and-swap the update into 'applying' under a fresh attempt id, owner
 * and lease. Exactly one worker can win this claim; everyone else throws. */
function claimApply(
  db: Db,
  updateId: string,
  owner: { workerId: string; leaseMs: number; now: () => Date },
): string {
  const attemptId = newId('rapl');
  const nowMs = owner.now().getTime();
  return db.transaction(
    (tx) => {
      const result = tx
        .update(roadmapUpdates)
        .set({
          status: 'applying',
          applyAttemptId: attemptId,
          applyStartedAt: new Date(nowMs).toISOString(),
          applyWorkerId: owner.workerId,
          applyLeaseExpiresAt: new Date(nowMs + owner.leaseMs).toISOString(),
        })
        .where(and(eq(roadmapUpdates.id, updateId), eq(roadmapUpdates.status, 'proposed')))
        .run();
      if (result.changes !== 1) {
        throw new Error(
          `roadmap update ${updateId} could not be claimed for apply (concurrent apply in progress or already resolved)`,
        );
      }
      return attemptId;
    },
    { behavior: 'immediate' },
  );
}

function settle(
  db: Db,
  updateId: string,
  attemptId: string,
  status: 'applied' | 'rejected' | 'superseded',
) {
  const patch: Partial<typeof roadmapUpdates.$inferInsert> = { status };
  if (status === 'applied') patch.appliedAt = nowIso();
  const result = db
    .update(roadmapUpdates)
    .set(patch)
    .where(
      and(
        eq(roadmapUpdates.id, updateId),
        eq(roadmapUpdates.status, 'applying'),
        eq(roadmapUpdates.applyAttemptId, attemptId),
      ),
    )
    .run();
  if (result.changes !== 1) {
    throw new Error(`roadmap update ${updateId} apply attempt ${attemptId} was displaced`);
  }
  return getUpdate(db, updateId);
}

/**
 * Apply a proposed update through a crash-consistent protocol:
 *
 *   1. validate payload binding and the recorded dry run;
 *   2. reconcile idempotency FIRST — if the source already holds this
 *      idempotency key (a previous attempt crashed after the external write),
 *      the update is marked applied, never superseded;
 *   3. only then can a changed source revision supersede the proposal;
 *   4. Done changes re-verify evidence and the approved decision;
 *   5. CAS proposed -> 'applying' under a fresh attempt id (one worker only);
 *   6. external adapter.apply (a crash here leaves durable 'applying' state
 *      that reconcileRoadmapApplies resolves);
 *   7. CAS 'applying' -> applied/rejected under the same attempt id.
 */
export async function applyRoadmapUpdate(
  db: Db,
  adapter: RoadmapAdapter,
  updateId: string,
  options: ApplyRoadmapOptions = {},
) {
  // External roadmap application is unavailable in this build: refuse before
  // reading the update or touching the adapter (milestone M5).
  assertCapabilityAvailable('external-roadmap-application');
  bindRoadmapRuntimeHost(db);
  const update = getUpdate(db, updateId);
  if (update.status === 'applied') return { status: 'already_applied' as const, update };
  if (update.status === 'applying') {
    throw new Error(
      `roadmap update ${updateId} has an apply in progress (attempt ${update.applyAttemptId}); ` +
        'run reconciliation before retrying',
    );
  }
  if (update.status !== 'proposed') {
    throw new Error(`roadmap update ${updateId} is ${update.status}, not applicable`);
  }
  if (!update.dryRunDiff || !update.dryRunAt) {
    throw new Error(`roadmap update ${updateId} has no recorded dry run`);
  }

  const proposal = proposalFromUpdate(update);
  const changes = proposal.changes;
  const owner = {
    workerId: options.workerId ?? newId('rapw'),
    leaseMs: options.applyLeaseMs ?? DEFAULT_APPLY_LEASE_MS,
    now: options.now ?? (() => new Date()),
  };

  // Reconcile before any revision-based invalidation: an already-applied
  // idempotency key means a prior attempt reached the source.
  const revision = await adapter.revision();
  if (update.sourceRevision !== revision) {
    if (await adapter.wasApplied(update.idempotencyKey)) {
      const attemptId = claimApply(db, updateId, owner);
      return { status: 'applied' as const, update: settle(db, updateId, attemptId, 'applied') };
    }
    const superseded = db
      .update(roadmapUpdates)
      .set({ status: 'superseded' })
      .where(and(eq(roadmapUpdates.id, updateId), eq(roadmapUpdates.status, 'proposed')))
      .run();
    if (superseded.changes !== 1) {
      throw new Error(`roadmap update ${updateId} changed during revision reconciliation`);
    }
    return { status: 'superseded' as const, update: getUpdate(db, updateId) };
  }

  if (isDoneChange(changes)) {
    assertDoneEvidence(db, update.roadmapItemId, proposal.evidenceRefs);
    const decisionId = options.roadmapDoneDecisionId;
    if (!decisionId || !isApprovedDecision(db, decisionId, { category: 'roadmap_done' })) {
      throw new Error(
        'marking a roadmap item Done requires an approved roadmap_done DecisionRequest',
      );
    }
  }

  const attemptId = claimApply(db, updateId, owner);
  const expectedDiff = JSON.parse(update.dryRunDiff) as DiffEntry[];
  const result = await adapter.apply(proposal, { expectedDiff });
  // A crash on the line above leaves this update in durable 'applying' state;
  // reconcileRoadmapApplies() resolves it from the adapter's idempotency
  // record. From here on we settle the SAME attempt we claimed.
  if (result.status === 'rejected') {
    return {
      status: 'rejected' as const,
      violations: result.violations,
      update: settle(db, updateId, attemptId, 'rejected'),
    };
  }
  return { status: 'applied' as const, update: settle(db, updateId, attemptId, 'applied') };
}

/**
 * Crash recovery for the apply protocol. For every update stuck in 'applying':
 *
 *   1. query the adapter's idempotency record FIRST — an already-applied key
 *      reconciles to Applied (never a second write), regardless of the lease;
 *   2. otherwise the attempt may still be running: reclaim it ONLY once its
 *      lease has lapsed, and return it to 'proposed' for a fresh, fully
 *      re-validated attempt. A still-leased attempt is left untouched, so a
 *      concurrent reconciler cannot displace an in-flight external write, and
 *      lease expiry alone never triggers another write — the idempotency
 *      query always runs first.
 *
 * Adapter idempotency (RoadmapAdapter.wasApplied + idempotent apply) is the
 * contract that makes this safe even in the residual window where a reclaimed
 * attempt's write was in fact still in flight: re-applying the same key is a
 * no-op at the source.
 */
export async function reconcileRoadmapApplies(
  db: Db,
  adapter: RoadmapAdapter,
  options: { now?: () => Date } = {},
) {
  // Part of the quarantined apply protocol: reconciliation can settle updates
  // to 'applied', so it is gated with apply itself (milestone M5).
  assertCapabilityAvailable('external-roadmap-application');
  bindRoadmapRuntimeHost(db);
  const nowIsoStr = (options.now?.() ?? new Date()).toISOString();
  const stuck = db.select().from(roadmapUpdates).where(eq(roadmapUpdates.status, 'applying')).all();
  const resolved: { updateId: string; outcome: 'applied' | 'requeued' | 'rejected' }[] = [];
  for (const update of stuck) {
    if (!update.applyAttemptId || !update.applyWorkerId || !update.applyLeaseExpiresAt) {
      const rejected = db
        .update(roadmapUpdates)
        .set({ status: 'rejected' })
        .where(and(eq(roadmapUpdates.id, update.id), eq(roadmapUpdates.status, 'applying')))
        .run();
      if (rejected.changes === 1) resolved.push({ updateId: update.id, outcome: 'rejected' });
      continue;
    }
    if (await adapter.wasApplied(update.idempotencyKey)) {
      const settled = db
        .update(roadmapUpdates)
        .set({ status: 'applied', appliedAt: nowIso() })
        .where(
          and(
            eq(roadmapUpdates.id, update.id),
            eq(roadmapUpdates.status, 'applying'),
            eq(roadmapUpdates.applyAttemptId, update.applyAttemptId),
            eq(roadmapUpdates.applyWorkerId, update.applyWorkerId),
            eq(roadmapUpdates.applyLeaseExpiresAt, update.applyLeaseExpiresAt),
          ),
        )
        .run();
      if (settled.changes === 1) resolved.push({ updateId: update.id, outcome: 'applied' });
      continue;
    }
    // Not applied at the source. Leave a still-leased attempt alone.
    if (update.applyLeaseExpiresAt !== null && update.applyLeaseExpiresAt > nowIsoStr) {
      continue;
    }
    const requeued = db
      .update(roadmapUpdates)
      .set({
        status: 'proposed',
        applyAttemptId: null,
        applyWorkerId: null,
        applyLeaseExpiresAt: null,
      })
      .where(
        and(
          eq(roadmapUpdates.id, update.id),
          eq(roadmapUpdates.status, 'applying'),
          eq(roadmapUpdates.applyAttemptId, update.applyAttemptId),
          eq(roadmapUpdates.applyWorkerId, update.applyWorkerId),
          eq(roadmapUpdates.applyLeaseExpiresAt, update.applyLeaseExpiresAt),
        ),
      )
      .run();
    if (requeued.changes === 1) resolved.push({ updateId: update.id, outcome: 'requeued' });
  }
  return resolved;
}

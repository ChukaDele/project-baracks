import { eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { evidence, roadmapItems, roadmapUpdates, tasks } from '../db/schema.js';
import { isApprovedDecision } from '../domain/decision-service.js';
import { newId, nowIso } from '../domain/ids.js';
import {
  idempotencyKeyMatchesPayload,
  proposalIdempotencyKey,
  proposalPayloadHash,
} from './canonical.js';
import type { DiffEntry, RoadmapAdapter, RowChange, UpdateProposal } from './types.js';

/**
 * DB-backed proposal lifecycle for roadmap writes. A proposal is bound to its
 * canonical payload hash and the source revision observed at dry-run time;
 * apply requires that exact prior dry run, re-verifies the source revision,
 * and — for Done changes — an approved 'roadmap_done' DecisionRequest plus
 * evidence rows that genuinely belong to tasks of this roadmap item.
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

export interface ApplyRoadmapOptions {
  /** Required when the proposal marks a row Done. */
  roadmapDoneDecisionId?: string;
}

export async function applyRoadmapUpdate(
  db: Db,
  adapter: RoadmapAdapter,
  updateId: string,
  options: ApplyRoadmapOptions = {},
) {
  const update = getUpdate(db, updateId);
  if (update.status === 'applied') return { status: 'already_applied' as const, update };
  if (update.status !== 'proposed') {
    throw new Error(`roadmap update ${updateId} is ${update.status}, not applicable`);
  }
  if (!update.dryRunDiff || !update.dryRunAt) {
    throw new Error(`roadmap update ${updateId} has no recorded dry run`);
  }

  const changes = JSON.parse(update.changesJson) as RowChange[];
  const proposal: UpdateProposal = {
    idempotencyKey: update.idempotencyKey,
    changes,
    rationale: update.rationale,
    evidenceRefs: JSON.parse(update.evidenceIdsJson) as string[],
  };

  // The stored payload identity must still match the stored changes and key.
  if (proposalPayloadHash(proposal) !== update.payloadHash) {
    throw new Error(`roadmap update ${updateId} payload hash mismatch — record tampered`);
  }
  if (!idempotencyKeyMatchesPayload(update.idempotencyKey, proposal)) {
    throw new Error(`roadmap update ${updateId} idempotency key does not bind its payload`);
  }

  // Changed source state invalidates the proposal.
  const revision = await adapter.revision();
  if (update.sourceRevision !== revision) {
    db.update(roadmapUpdates)
      .set({ status: 'superseded' })
      .where(eq(roadmapUpdates.id, updateId))
      .run();
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

  const expectedDiff = JSON.parse(update.dryRunDiff) as DiffEntry[];
  const result = await adapter.apply(proposal, { expectedDiff });
  if (result.status === 'rejected') {
    db.update(roadmapUpdates)
      .set({ status: 'rejected' })
      .where(eq(roadmapUpdates.id, updateId))
      .run();
    return {
      status: 'rejected' as const,
      violations: result.violations,
      update: getUpdate(db, updateId),
    };
  }
  db.update(roadmapUpdates)
    .set({ status: 'applied', appliedAt: nowIso() })
    .where(eq(roadmapUpdates.id, updateId))
    .run();
  return { status: 'applied' as const, update: getUpdate(db, updateId) };
}

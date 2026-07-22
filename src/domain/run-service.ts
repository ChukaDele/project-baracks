import { desc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { agentRunEvents, agentRuns, usageObservations, type BillingMode } from '../db/schema.js';
import { newId, nowIso } from './ids.js';

export interface NewRunInput {
  taskId: string;
  providerId: string;
  modelId?: string;
  modelRef: string;
  purpose: (typeof agentRuns.$inferInsert)['purpose'];
  billingMode: BillingMode;
  routingReason: string;
  independenceLoss?: string;
  allowanceState?: string;
  worktreeId?: string;
}

export function createRun(db: Db, input: NewRunInput) {
  const row = {
    id: newId('arun'),
    taskId: input.taskId,
    providerId: input.providerId,
    modelId: input.modelId ?? null,
    modelRef: input.modelRef,
    purpose: input.purpose,
    billingMode: input.billingMode,
    routingReason: input.routingReason,
    independenceLoss: input.independenceLoss ?? null,
    allowanceState: input.allowanceState ?? null,
    worktreeId: input.worktreeId ?? null,
    status: 'pending' as const,
  };
  db.insert(agentRuns).values(row).run();
  return row;
}

export function getRun(db: Db, runId: string) {
  const row = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get();
  if (!row) throw new Error(`agent run not found: ${runId}`);
  return row;
}

export function setRunStatus(
  db: Db,
  runId: string,
  status: (typeof agentRuns.$inferInsert)['status'],
) {
  const patch: Partial<typeof agentRuns.$inferInsert> = { status };
  if (status === 'running') patch.startedAt = nowIso();
  if (status && ['succeeded', 'failed', 'cancelled', 'timed_out', 'checkpointed'].includes(status))
    patch.endedAt = nowIso();
  db.update(agentRuns).set(patch).where(eq(agentRuns.id, runId)).run();
  return getRun(db, runId);
}

/** Append an event to the run's immutable history. Sequence numbers are per-run. */
export function appendRunEvent(db: Db, runId: string, type: string, payload: unknown = {}) {
  const last = db
    .select({ seq: agentRunEvents.seq })
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, runId))
    .orderBy(desc(agentRunEvents.seq))
    .limit(1)
    .get();
  const row = {
    id: newId('aevt'),
    runId,
    seq: (last?.seq ?? 0) + 1,
    type,
    payloadJson: JSON.stringify(payload),
  };
  db.insert(agentRunEvents).values(row).run();
  return row;
}

export function listRunEvents(db: Db, runId: string) {
  return db
    .select()
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, runId))
    .orderBy(agentRunEvents.seq)
    .all();
}

export function recordUsage(
  db: Db,
  input: {
    providerId: string;
    modelId?: string;
    agentRunId?: string;
    kind: (typeof usageObservations.$inferInsert)['kind'];
    data: unknown;
  },
) {
  const row = {
    id: newId('usage'),
    providerId: input.providerId,
    modelId: input.modelId ?? null,
    agentRunId: input.agentRunId ?? null,
    kind: input.kind,
    dataJson: JSON.stringify(input.data ?? {}),
  };
  db.insert(usageObservations).values(row).run();
  return row;
}

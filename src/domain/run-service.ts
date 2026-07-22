import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Db, DbConn } from '../db/client.js';
import {
  agentRunEvents,
  agentRuns,
  usageObservations,
  verificationRuns,
  type BillingMode,
} from '../db/schema.js';
import { redactValue } from '../security/redact.js';
import { newId, nowIso } from './ids.js';

export interface NewRunInput {
  taskId: string;
  providerId: string;
  claimId?: string;
  modelId?: string;
  modelRef: string;
  purpose: (typeof agentRuns.$inferInsert)['purpose'];
  billingMode: BillingMode;
  routingReason: string;
  /** Mandatory (DB CHECK) when billingMode is a paid mode. */
  paidUsageDecisionId?: string;
  independenceLoss?: string;
  allowanceState?: string;
  worktreeId?: string;
}

export function createRun(db: DbConn, input: NewRunInput) {
  const row = {
    id: newId('arun'),
    taskId: input.taskId,
    providerId: input.providerId,
    claimId: input.claimId ?? null,
    modelId: input.modelId ?? null,
    modelRef: input.modelRef,
    purpose: input.purpose,
    billingMode: input.billingMode,
    routingReason: input.routingReason,
    paidUsageDecisionId: input.paidUsageDecisionId ?? null,
    independenceLoss: input.independenceLoss ?? null,
    allowanceState: input.allowanceState ?? null,
    worktreeId: input.worktreeId ?? null,
    status: 'pending' as const,
  };
  db.insert(agentRuns).values(row).run();
  return row;
}

export function getRun(db: DbConn, runId: string) {
  const row = db.select().from(agentRuns).where(eq(agentRuns.id, runId)).get();
  if (!row) throw new Error(`agent run not found: ${runId}`);
  return row;
}

export function setRunStatus(
  db: DbConn,
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

export class ConflictingEventError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConflictingEventError';
  }
}

function hashEventPayload(type: string, payloadJson: string): string {
  return createHash('sha256').update(`${type}\n${payloadJson}`).digest('hex');
}

export interface AppendedEvent {
  event: typeof agentRunEvents.$inferSelect;
  /** True when an identical event with the same eventKey already existed. */
  duplicate: boolean;
}

/**
 * Append an event to the run's immutable history. The payload is redacted
 * BEFORE persistence — secrets never reach durable storage. Sequence numbers
 * are assigned inside the same immediate transaction as the insert, so
 * concurrent appenders cannot collide. With an eventKey, redelivery of the
 * identical event is an idempotent no-op; a *different* payload under the
 * same key is rejected as a conflicting replacement.
 */
export function appendRunEvent(
  db: Db,
  runId: string,
  type: string,
  payload: unknown = {},
  options: { eventKey?: string } = {},
): AppendedEvent {
  const payloadJson = JSON.stringify(redactValue(payload ?? {}));
  const payloadHash = hashEventPayload(type, payloadJson);
  return db.transaction(
    (tx): AppendedEvent => {
      if (options.eventKey !== undefined) {
        const existing = tx
          .select()
          .from(agentRunEvents)
          .where(
            and(eq(agentRunEvents.runId, runId), eq(agentRunEvents.eventKey, options.eventKey)),
          )
          .get();
        if (existing) {
          if (existing.payloadHash === payloadHash && existing.type === type) {
            return { event: existing, duplicate: true };
          }
          throw new ConflictingEventError(
            `event key ${options.eventKey} of run ${runId} already exists with different content`,
          );
        }
      }
      const last = tx
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
        eventKey: options.eventKey ?? null,
        payloadHash,
        payloadJson,
      };
      tx.insert(agentRunEvents).values(row).run();
      return { event: getEvent(tx, row.id), duplicate: false };
    },
    { behavior: 'immediate' },
  );
}

function getEvent(db: DbConn, eventId: string) {
  const row = db.select().from(agentRunEvents).where(eq(agentRunEvents.id, eventId)).get();
  if (!row) throw new Error(`run event not found: ${eventId}`);
  return row;
}

export function listRunEvents(db: DbConn, runId: string) {
  return db
    .select()
    .from(agentRunEvents)
    .where(eq(agentRunEvents.runId, runId))
    .orderBy(agentRunEvents.seq)
    .all();
}

/** Record a deterministic verification run (the completion proof's backbone). */
export function recordVerificationRun(
  db: DbConn,
  input: {
    taskId: string;
    command: string;
    status: (typeof verificationRuns.$inferInsert)['status'];
    exitCode?: number;
    outputSummary?: string;
    agentRunId?: string;
    startedAt?: string;
    endedAt?: string;
  },
) {
  const row = {
    id: newId('vrun'),
    taskId: input.taskId,
    agentRunId: input.agentRunId ?? null,
    command: input.command,
    status: input.status,
    exitCode: input.exitCode ?? null,
    outputSummary: input.outputSummary ?? null,
    startedAt: input.startedAt ?? null,
    endedAt: input.endedAt ?? null,
  };
  db.insert(verificationRuns).values(row).run();
  return row;
}

export function recordUsage(
  db: DbConn,
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
    dataJson: JSON.stringify(redactValue(input.data ?? {})),
  };
  db.insert(usageObservations).values(row).run();
  return row;
}

import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { Db, DbConn } from '../db/client.js';
import {
  agentModels,
  agentProviders,
  agentRunEvents,
  agentRuns,
  decisionRequests,
  taskClaims,
  tasks,
  usageObservations,
  verificationRuns,
  type BillingMode,
} from '../db/schema.js';
import { assertCapabilityAvailable } from '../security/capabilities.js';
import { redactText, redactValue } from '../security/redact.js';
import { StaleClaimError } from './claim-service.js';
import { isApprovedDecision } from './decision-service.js';
import { newId, nowIso } from './ids.js';

export class RunAuthorisationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunAuthorisationError';
  }
}

const PAID_BILLING_MODES: readonly BillingMode[] = ['usage_credits', 'api_billing'];

export interface NewRunInput {
  taskId: string;
  providerId: string;
  claimId?: string;
  claimWorkerId?: string;
  modelId?: string;
  modelRef: string;
  purpose: (typeof agentRuns.$inferInsert)['purpose'];
  billingMode: BillingMode;
  routingReason: string;
  /** Mandatory when billingMode is paid: id of an APPROVED 'paid_usage'
   * DecisionRequest bound to this exact task/project and covering this
   * provider/model. Validated inside the run-creation transaction. */
  paidUsageDecisionId?: string;
  independenceLoss?: string;
  allowanceState?: string;
  worktreeId?: string;
  now?: () => Date;
}

/**
 * Create a run record inside one immediate transaction. In this build a run
 * row is ledger/planning state only — nothing executes it (live agent
 * execution is an unavailable capability, see src/security/capabilities.ts).
 *
 * Validations that remain live: the task exists, and the billing mode is
 * known (an 'unknown' cost basis is unroutable) and must match the model's
 * authoritatively observed billing.
 *
 * QUARANTINED paths: a PAID billing mode is refused unconditionally (paid
 * provider execution is unavailable — M2), and a claim-bound run is refused
 * unconditionally (worker-owned downstream mutations are unavailable — M4).
 * The validation code for those paths below the gates is retained as the
 * milestone starting point but is unreachable until then; independent review
 * found it incomplete (approval scoping/consumption, fencing coverage), so it
 * must not be presented as an enforced boundary.
 */
export function createRun(db: Db, rawInput: NewRunInput) {
  // Single-read snapshot of the caller-owned input (see task-service.ts
  // snapshotTaskInput): the paid-billing and claim-bound capability gates
  // below and the persisted row must observe the same values even against a
  // stateful getter or Proxy that answers differently on successive reads.
  const input = Object.freeze({
    taskId: rawInput.taskId,
    providerId: rawInput.providerId,
    claimId: rawInput.claimId,
    claimWorkerId: rawInput.claimWorkerId,
    modelId: rawInput.modelId,
    modelRef: rawInput.modelRef,
    purpose: rawInput.purpose,
    billingMode: rawInput.billingMode,
    routingReason: rawInput.routingReason,
    paidUsageDecisionId: rawInput.paidUsageDecisionId,
    independenceLoss: rawInput.independenceLoss,
    allowanceState: rawInput.allowanceState,
    worktreeId: rawInput.worktreeId,
    now: rawInput.now,
  });
  if (PAID_BILLING_MODES.includes(input.billingMode)) {
    assertCapabilityAvailable('paid-provider-execution');
  }
  if (input.claimId !== undefined) {
    assertCapabilityAvailable('worker-owned-downstream-mutations');
  }
  return db.transaction(
    (tx) => {
      const task = tx.select().from(tasks).where(eq(tasks.id, input.taskId)).get();
      if (!task) throw new Error(`task not found: ${input.taskId}`);

      if (input.billingMode === 'unknown') {
        throw new RunAuthorisationError(
          'billing mode is unknown: refusing to create a run whose cost basis is unproven',
        );
      }

      // Billing derives from authoritative persisted model state, never from
      // caller input: when the model is persisted, the run's billing must
      // equal the model's observed billing, and an unobserved ('unknown')
      // model is unroutable. Configuration/installation/heuristics prove
      // nothing about cost.
      const model = tx
        .select()
        .from(agentModels)
        .where(
          and(
            eq(agentModels.providerId, input.providerId),
            eq(agentModels.modelRef, input.modelRef),
          ),
        )
        .get();
      if (!model || model.billingMode === 'unknown') {
        throw new RunAuthorisationError(
          `model ${input.modelRef} has no authoritative billing observation: unroutable`,
        );
      }
      if (model.billingMode !== input.billingMode) {
        throw new RunAuthorisationError(
          `run billing '${input.billingMode}' does not match the authoritative persisted ` +
            `billing '${model.billingMode}' of model ${input.modelRef}`,
        );
      }
      if (input.modelId !== undefined && input.modelId !== model.id) {
        throw new RunAuthorisationError(
          `modelId ${input.modelId} does not match ${input.modelRef}`,
        );
      }

      if (input.claimId !== undefined) {
        const claim = tx.select().from(taskClaims).where(eq(taskClaims.id, input.claimId)).get();
        const nowIsoStr = (input.now?.() ?? new Date()).toISOString();
        if (
          !claim ||
          claim.taskId !== input.taskId ||
          claim.status !== 'active' ||
          claim.leaseExpiresAt <= nowIsoStr ||
          claim.workerId !== input.claimWorkerId
        ) {
          throw new StaleClaimError(
            `claim ${input.claimId} is not the current active, unexpired claim of task ${input.taskId}`,
          );
        }
      }

      if (PAID_BILLING_MODES.includes(input.billingMode)) {
        if (!input.paidUsageDecisionId) {
          throw new RunAuthorisationError(
            'paid billing requires an approved paid_usage DecisionRequest',
          );
        }
        const provider = tx
          .select()
          .from(agentProviders)
          .where(eq(agentProviders.id, input.providerId))
          .get();
        const now = input.now?.();
        const authorised = isApprovedDecision(tx, input.paidUsageDecisionId, {
          category: 'paid_usage',
          taskId: input.taskId,
          projectId: task.projectId,
          scope: {
            provider: provider?.name ?? '',
            modelRef: input.modelRef,
            purpose: input.purpose,
          },
          requireExpiry: true,
          requireUnconsumed: true,
          ...(now ? { now } : {}),
        });
        if (!authorised) {
          throw new RunAuthorisationError(
            `DecisionRequest ${input.paidUsageDecisionId} does not authorise paid usage for ` +
              `this task, project and provider/model scope (approved, unexpired, unconsumed, scoped)`,
          );
        }
      }

      const row = {
        id: newId('arun'),
        taskId: input.taskId,
        providerId: input.providerId,
        claimId: input.claimId ?? null,
        claimWorkerId: input.claimWorkerId ?? null,
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
      tx.insert(agentRuns).values(row).run();

      // SQLite consumes paid approvals in an AFTER INSERT trigger. Verify the
      // durable boundary did so; the service never performs its own competing
      // check-then-stamp implementation.
      if (PAID_BILLING_MODES.includes(input.billingMode) && input.paidUsageDecisionId) {
        const decision = tx
          .select({ consumedByRunId: decisionRequests.consumedByRunId })
          .from(decisionRequests)
          .where(eq(decisionRequests.id, input.paidUsageDecisionId))
          .get();
        if (decision?.consumedByRunId !== row.id) {
          throw new RunAuthorisationError(
            `paid approval ${input.paidUsageDecisionId} was not consumed by run ${row.id}`,
          );
        }
      }
      return row;
    },
    { behavior: 'immediate' },
  );
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

/**
 * Record a deterministic verification run (the completion proof's backbone).
 * A 'passed' record must be internally consistent: exit code 0 and completed
 * timestamps (defaulted to now when the caller ran the command synchronously)
 * — a bare 'passed' label proves nothing and is refused here and by the DB.
 */
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
  // Single reads of the caller-owned fields the consistency check validates
  // (see createRun): the check and the persisted row must agree.
  const { status, exitCode, outputSummary } = input;
  const terminal = status === 'passed' || status === 'failed';
  if (status === 'passed' && exitCode !== 0) {
    throw new Error(`a passed verification run requires exit code 0, got ${exitCode}`);
  }
  const row = {
    id: newId('vrun'),
    taskId: input.taskId,
    agentRunId: input.agentRunId ?? null,
    command: input.command,
    status,
    exitCode: exitCode ?? null,
    outputSummary: outputSummary !== undefined ? redactText(outputSummary) : null,
    startedAt: input.startedAt ?? (terminal ? nowIso() : null),
    endedAt: input.endedAt ?? (terminal ? nowIso() : null),
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

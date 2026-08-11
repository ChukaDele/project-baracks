import { createHash } from 'node:crypto';
import { and, count, desc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import type { Db, DbConn } from '../db/client.js';
import {
  evidence,
  taskDependencies,
  tasks,
  taskSuggestions,
  type SuggestionSourceType,
  type TaskComplexity,
} from '../db/schema.js';
import { taskClaims } from '../db/schema.js';
import { assertCapabilityAvailable } from '../security/capabilities.js';
import { StaleClaimError } from './claim-service.js';
import { evaluateCompletionProof, parseCompletionCriteria } from './completion.js';
import { newId, nowIso } from './ids.js';
import { assertTransition, type TaskStatus, TERMINAL_STATUSES } from './lifecycle.js';

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
  }
}

/**
 * Refusal raised by the canonical suggestion-approval boundary. Approving a
 * suggestion materialises it into a live task that feeds the (disabled)
 * execution pipeline; this dry-run / inspection-only foundation does not
 * approve suggestions. Unconditional and self-contained — no configuration,
 * environment variable, database value or caller option is consulted — so the
 * only way to re-enable approval is a reviewed code change under a future
 * supervised-approval milestone. Read-only suggestion inspection
 * (getSuggestion / listTasks) and the underlying relational model are retained.
 */
export class SuggestionApprovalUnavailableError extends Error {
  constructor() {
    super(
      'suggestion approval is unavailable in this disabled foundation: approving a suggestion ' +
        'materialises a live task and is not permitted in this dry-run / inspection-only build',
    );
    this.name = 'SuggestionApprovalUnavailableError';
  }
}

/**
 * Fail closed on suggestion approval. Always throws in this build. Declared to
 * return void (not never) so the retained approval groundwork below stays
 * compiled and type-checked, mirroring assertCapabilityAvailable().
 */
function assertApprovalEnabled(): void {
  throw new SuggestionApprovalUnavailableError();
}

/**
 * A worker's fencing token: a transition performed on behalf of a claim must
 * present it, and the claim must still be that worker's live (active,
 * unexpired) claim of THIS task, or the transition is refused as stale.
 */
export interface ClaimFence {
  claimId: string;
  workerId: string;
  now?: () => Date;
}

function assertLiveClaim(db: DbConn, fence: ClaimFence, taskId: string) {
  const nowIso = (fence.now?.() ?? new Date()).toISOString();
  const claim = db.select().from(taskClaims).where(eq(taskClaims.id, fence.claimId)).get();
  if (
    !claim ||
    claim.workerId !== fence.workerId ||
    claim.taskId !== taskId ||
    claim.status !== 'active' ||
    claim.leaseExpiresAt <= nowIso
  ) {
    throw new StaleClaimError(
      `claim ${fence.claimId} is not the live claim of worker ${fence.workerId} on task ${taskId}`,
    );
  }
}

export interface NewTaskInput {
  projectId: string;
  title: string;
  description?: string;
  complexity?: TaskComplexity;
  roadmapItemId?: string;
  suggestionId?: string;
  completionCriteriaJson?: string;
}

/**
 * Immutable, module-owned snapshot of a task-creation request. Untrusted
 * input is mutable and potentially accessor-backed: a stateful getter or
 * Proxy can return different values on successive reads, so a guard that
 * reads a property and a persistence path that reads it again can be shown
 * different worlds. Everything after snapshotTaskInput() must consult only
 * this frozen plain object, never the caller's object.
 */
interface TaskInputSnapshot {
  readonly projectId: string;
  readonly title: string;
  readonly description: string | undefined;
  readonly complexity: TaskComplexity | undefined;
  readonly roadmapItemId: string | undefined;
  readonly suggestionId: string | undefined;
  readonly completionCriteriaJson: string | undefined;
}

/**
 * Read EVERY property of the caller-owned input exactly once — in particular
 * suggestionId, the only suggestion-provenance field — and freeze the result.
 * Validation and persistence both operate on the returned snapshot, so the
 * value the suggestion-materialisation gate saw is the value that persists.
 */
function snapshotTaskInput(input: NewTaskInput): TaskInputSnapshot {
  return Object.freeze({
    projectId: input.projectId,
    title: input.title,
    description: input.description,
    complexity: input.complexity,
    roadmapItemId: input.roadmapItemId,
    suggestionId: input.suggestionId,
    completionCriteriaJson: input.completionCriteriaJson,
  });
}

/**
 * Raw task insert. Module-PRIVATE and NOT exported: it is the only path that
 * can persist a task carrying suggestion provenance, and it is reachable only
 * through approveSuggestion (itself gated). Keeping it unexported means the
 * exported surface offers no alternate suggestion-materialisation route. It
 * accepts only a module-created TaskInputSnapshot — never the caller-owned
 * object — so it cannot re-invoke a caller's getter or Proxy trap.
 */
function insertTask(db: DbConn, input: TaskInputSnapshot) {
  if (input.completionCriteriaJson !== undefined) {
    parseCompletionCriteria(input.completionCriteriaJson); // fail loudly on invalid criteria
  }
  const row = {
    id: newId('task'),
    projectId: input.projectId,
    roadmapItemId: input.roadmapItemId ?? null,
    suggestionId: input.suggestionId ?? null,
    title: input.title,
    description: input.description ?? '',
    status: 'draft' as const,
    complexity: input.complexity ?? ('bounded' as const),
    completionCriteriaJson: input.completionCriteriaJson ?? null,
  };
  db.insert(tasks).values(row).run();
  return getTask(db, row.id);
}

/**
 * Create a task directly (draft status). This is the canonical production
 * mutation boundary for task creation, so the suggestion-materialisation gate
 * lives HERE, not only in the CLI: a task carrying suggestion provenance
 * (suggestionId) is exactly what approveSuggestion produces, and approval is
 * disabled in this build. Such a request is refused BEFORE any write — no
 * transaction, no task insert, no suggestion change, no relationship/approval
 * record — so the exported API cannot be used to bypass approveSuggestion. No
 * environment variable, config file, database value or caller option is
 * consulted. Ordinary human-created tasks (no suggestion provenance) remain
 * usable; roadmap-linked tasks (roadmapItemId) are not suggestion provenance
 * and remain usable.
 *
 * The input is snapshotted ONCE, up front: the gate and the insert both read
 * the frozen snapshot, so a stateful getter or Proxy cannot show the gate
 * `suggestionId: undefined` and persistence a real pending suggestion id.
 */
export function addTask(db: DbConn, input: NewTaskInput) {
  const snapshot = snapshotTaskInput(input);
  if (snapshot.suggestionId !== undefined) assertApprovalEnabled();
  return insertTask(db, snapshot);
}

export function getTask(db: DbConn, taskId: string) {
  const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) throw new Error(`task not found: ${taskId}`);
  return row;
}

export function incompleteDependencyCount(db: DbConn, taskId: string): number {
  const deps = db
    .select({ dependsOn: taskDependencies.dependsOnTaskId })
    .from(taskDependencies)
    .where(eq(taskDependencies.taskId, taskId))
    .all();
  if (deps.length === 0) return 0;
  const result = db
    .select({ n: count() })
    .from(tasks)
    .where(
      and(
        inArray(
          tasks.id,
          deps.map((d) => d.dependsOn),
        ),
        notInArray(tasks.status, ['completed']),
      ),
    )
    .get();
  return result?.n ?? 0;
}

/**
 * Apply a guarded transition using the CURRENT connection/transaction.
 * Compare-and-swap on (status, version): a concurrent writer that moved the
 * task first makes this throw ConcurrencyError instead of silently clobbering.
 * Callers that need atomicity with other writes run this inside their own
 * BEGIN IMMEDIATE transaction (see claim-service, approveSuggestion).
 */
export function applyTransition(
  db: DbConn,
  taskId: string,
  to: TaskStatus,
  opts: { fence?: ClaimFence } = {},
) {
  // Read the caller-owned options' fence exactly once (see snapshotTaskInput):
  // the capability gate and the live-claim check must see the same value even
  // against a stateful accessor.
  const fence = opts.fence;
  // Worker-owned downstream mutations are unavailable in this build: a
  // fence-carrying (worker-attributed) transition is refused outright,
  // regardless of the fence's validity (milestone M4 — fencing coverage is
  // incomplete). The live-claim check below is retained for M4.
  if (fence) assertCapabilityAvailable('worker-owned-downstream-mutations');
  // Automated task completion is unavailable in this build: NO service-layer
  // path reaches 'completed' (milestone M3 — completion criteria are mutable,
  // so the proof set cannot yet be trusted as task-specific and immutable).
  // The proof evaluation below is retained for M3.
  if (to === 'completed') assertCapabilityAvailable('automated-task-completion');
  if (fence) assertLiveClaim(db, fence, taskId);
  const task = getTask(db, taskId);
  const guards: Parameters<typeof assertTransition>[2] = {
    incompleteDependencyCount: incompleteDependencyCount(db, taskId),
  };
  if (to === 'completed') {
    // The proof set is evaluated here, atomically with the transition.
    guards.completionProof = evaluateCompletionProof(
      db,
      taskId,
      parseCompletionCriteria(task.completionCriteriaSnapshotJson),
    );
  }
  assertTransition(task.status, to, guards);
  const patch: Partial<typeof tasks.$inferInsert> = {
    status: to,
    version: task.version + 1,
    mutationClaimId: fence?.claimId ?? null,
    mutationWorkerId: fence?.workerId ?? null,
  };
  if (to === 'queued' && task.completionCriteriaSnapshotJson === null) {
    patch.completionCriteriaSnapshotJson = task.completionCriteriaJson ?? '{}';
    patch.completionCriteriaLockedAt = nowIso();
  }
  const result = db
    .update(tasks)
    .set(patch)
    .where(
      and(eq(tasks.id, taskId), eq(tasks.status, task.status), eq(tasks.version, task.version)),
    )
    .run();
  if (result.changes !== 1) {
    throw new ConcurrencyError(
      `task ${taskId} was modified concurrently during ${task.status} -> ${to}`,
    );
  }
  return getTask(db, taskId);
}

/**
 * The ONLY sanctioned way to change a task's status from non-transactional
 * code: wraps applyTransition in its own immediate transaction.
 */
export function transitionTask(
  db: Db,
  taskId: string,
  to: TaskStatus,
  opts: { fence?: ClaimFence } = {},
) {
  return db.transaction((tx) => applyTransition(tx, taskId, to, opts), { behavior: 'immediate' });
}

export function addDependency(db: DbConn, taskId: string, dependsOnTaskId: string) {
  if (taskId === dependsOnTaskId) throw new Error('a task cannot depend on itself');
  getTask(db, taskId);
  getTask(db, dependsOnTaskId);
  const row = { id: newId('tdep'), taskId, dependsOnTaskId };
  db.insert(taskDependencies).values(row).run();
  return row;
}

export function addEvidence(
  db: DbConn,
  input: {
    taskId: string;
    kind: (typeof evidence.$inferInsert)['kind'];
    summary: string;
    ref?: string;
    dataJson?: string;
    agentRunId?: string;
  },
) {
  const row = {
    id: newId('evid'),
    taskId: input.taskId,
    agentRunId: input.agentRunId ?? null,
    kind: input.kind,
    summary: input.summary,
    ref: input.ref ?? null,
    dataJson: input.dataJson ?? null,
  };
  // Linked-record kinds are validated against the referenced table by DB
  // triggers; anything invalid aborts the insert.
  db.insert(evidence).values(row).run();
  return row;
}

/**
 * Normalised fingerprint of a suggestion's scope: case, punctuation and
 * whitespace insensitive, so re-worded duplicates of the same ask collide.
 */
export function scopeFingerprint(title: string, description = ''): string {
  const normalized = `${title}\n${description}`
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return createHash('sha256').update(normalized).digest('hex');
}

export interface NewSuggestionInput {
  projectId: string;
  title: string;
  description?: string;
  rationale?: string;
  suggestedBy?: string;
  sourceType?: SuggestionSourceType;
  /** Id of the originating record (finding/run/evidence/task). */
  sourceRef?: string;
  roadmapItemId?: string;
  /** Explicitly supersede a previously rejected suggestion with this scope. */
  supersedes?: string;
}

export type SuggestionOutcome =
  | { outcome: 'created'; suggestion: typeof taskSuggestions.$inferSelect }
  | { outcome: 'duplicate'; suggestion: typeof taskSuggestions.$inferSelect }
  | { outcome: 'suppressed'; suggestion: typeof taskSuggestions.$inferSelect };

/**
 * Suggested tasks live in task_suggestions and stay out of tasks until
 * approved. Duplicates of a pending suggestion are folded into it; scopes
 * that were already rejected are suppressed unless explicitly superseded.
 */
export function addSuggestion(db: Db, rawInput: NewSuggestionInput): SuggestionOutcome {
  // Single-read snapshot of the caller-owned input (see snapshotTaskInput):
  // the dedup fingerprint, the supersede decision and the persisted row must
  // all observe the same values even against a stateful getter or Proxy.
  const input = Object.freeze({
    projectId: rawInput.projectId,
    title: rawInput.title,
    description: rawInput.description,
    rationale: rawInput.rationale,
    suggestedBy: rawInput.suggestedBy,
    sourceType: rawInput.sourceType,
    sourceRef: rawInput.sourceRef,
    roadmapItemId: rawInput.roadmapItemId,
    supersedes: rawInput.supersedes,
  });
  return db.transaction(
    (tx): SuggestionOutcome => {
      const fingerprint = scopeFingerprint(input.title, input.description);

      const pending = tx
        .select()
        .from(taskSuggestions)
        .where(
          and(
            eq(taskSuggestions.projectId, input.projectId),
            eq(taskSuggestions.scopeFingerprint, fingerprint),
            eq(taskSuggestions.status, 'pending'),
          ),
        )
        .get();
      if (pending) return { outcome: 'duplicate', suggestion: pending };

      const rejected = tx
        .select()
        .from(taskSuggestions)
        .where(
          and(
            eq(taskSuggestions.projectId, input.projectId),
            eq(taskSuggestions.scopeFingerprint, fingerprint),
            eq(taskSuggestions.status, 'rejected'),
            isNull(taskSuggestions.supersededById),
          ),
        )
        .orderBy(desc(taskSuggestions.createdAt))
        .get();
      if (rejected && input.supersedes !== rejected.id) {
        return { outcome: 'suppressed', suggestion: rejected };
      }

      const row = {
        id: newId('tsug'),
        projectId: input.projectId,
        roadmapItemId: input.roadmapItemId ?? null,
        title: input.title,
        description: input.description ?? '',
        rationale: input.rationale ?? '',
        suggestedBy: input.suggestedBy ?? 'human',
        sourceType: input.sourceType ?? ('human' as const),
        sourceRef: input.sourceRef ?? null,
        scopeFingerprint: fingerprint,
        status: 'pending' as const,
      };
      tx.insert(taskSuggestions).values(row).run();
      if (rejected && input.supersedes === rejected.id) {
        tx.update(taskSuggestions)
          .set({ supersededById: row.id })
          .where(eq(taskSuggestions.id, rejected.id))
          .run();
      }
      return { outcome: 'created', suggestion: getSuggestion(tx, row.id) };
    },
    { behavior: 'immediate' },
  );
}

export function getSuggestion(db: DbConn, suggestionId: string) {
  const row = db.select().from(taskSuggestions).where(eq(taskSuggestions.id, suggestionId)).get();
  if (!row) throw new Error(`suggestion not found: ${suggestionId}`);
  return row;
}

/**
 * Transactional approval — the ONLY path that materialises a suggestion into
 * a Task (the conceptual suggested -> draft transition). Compare-and-swap on
 * status 'pending' means two concurrent approvals cannot both create tasks;
 * the tasks_suggestion_unique index backs this up at the DB level.
 */
export function approveSuggestion(db: Db, suggestionId: string, note?: string) {
  // Fail closed BEFORE opening any transaction or reading/writing a row: the
  // disabled foundation never materialises a suggestion into a task. This is
  // the canonical mutation boundary, so a direct lower-level call refuses here
  // exactly as the CLI does — no argument, environment or database value can
  // enable it. The transaction below is retained (and type-checked) groundwork
  // for the future supervised-approval milestone, but is unreachable now.
  assertApprovalEnabled();
  return db.transaction(
    (tx) => {
      const suggestion = getSuggestion(tx, suggestionId);
      if (suggestion.status !== 'pending') {
        throw new Error(`suggestion ${suggestionId} already ${suggestion.status}`);
      }
      assertTransition('suggested', 'draft');
      const taskInput: NewTaskInput = {
        projectId: suggestion.projectId,
        suggestionId: suggestion.id,
        title: suggestion.title,
        description: suggestion.description,
      };
      if (suggestion.roadmapItemId !== null) taskInput.roadmapItemId = suggestion.roadmapItemId;
      // Uses the private insertTask, not the public addTask: the suggestion gate
      // is enforced once, at approval entry (assertApprovalEnabled above).
      const task = insertTask(tx, snapshotTaskInput(taskInput));
      const result = tx
        .update(taskSuggestions)
        .set({
          status: 'approved',
          approvedTaskId: task.id,
          decidedAt: nowIso(),
          decisionNote: note ?? null,
        })
        .where(and(eq(taskSuggestions.id, suggestionId), eq(taskSuggestions.status, 'pending')))
        .run();
      if (result.changes !== 1) {
        throw new ConcurrencyError(`suggestion ${suggestionId} was decided concurrently`);
      }
      return { suggestion: getSuggestion(tx, suggestionId), task };
    },
    { behavior: 'immediate' },
  );
}

export function rejectSuggestion(db: Db, suggestionId: string, note?: string) {
  return db.transaction(
    (tx) => {
      const suggestion = getSuggestion(tx, suggestionId);
      if (suggestion.status !== 'pending') {
        throw new Error(`suggestion ${suggestionId} already ${suggestion.status}`);
      }
      const result = tx
        .update(taskSuggestions)
        .set({ status: 'rejected', decidedAt: nowIso(), decisionNote: note ?? null })
        .where(and(eq(taskSuggestions.id, suggestionId), eq(taskSuggestions.status, 'pending')))
        .run();
      if (result.changes !== 1) {
        throw new ConcurrencyError(`suggestion ${suggestionId} was decided concurrently`);
      }
      return getSuggestion(tx, suggestionId);
    },
    { behavior: 'immediate' },
  );
}

export function listTasks(db: DbConn, projectId?: string) {
  const query = projectId
    ? db.select().from(tasks).where(eq(tasks.projectId, projectId))
    : db.select().from(tasks);
  return query.all();
}

/** Tasks eligible to run next: queued, or ready with all dependencies completed. */
export function queueableTasks(db: DbConn, projectId?: string) {
  return listTasks(db, projectId)
    .filter((t) => !TERMINAL_STATUSES.includes(t.status))
    .filter(
      (t) =>
        t.status === 'queued' ||
        (t.status === 'ready' && incompleteDependencyCount(db, t.id) === 0),
    );
}

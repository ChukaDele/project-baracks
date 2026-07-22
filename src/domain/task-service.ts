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
import { evaluateCompletionProof, parseCompletionCriteria } from './completion.js';
import { newId, nowIso } from './ids.js';
import { assertTransition, type TaskStatus, TERMINAL_STATUSES } from './lifecycle.js';

export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConcurrencyError';
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

export function addTask(db: DbConn, input: NewTaskInput) {
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
export function applyTransition(db: DbConn, taskId: string, to: TaskStatus) {
  const task = getTask(db, taskId);
  const guards: Parameters<typeof assertTransition>[2] = {
    incompleteDependencyCount: incompleteDependencyCount(db, taskId),
  };
  if (to === 'completed') {
    // The proof set is evaluated here, atomically with the transition.
    guards.completionProof = evaluateCompletionProof(
      db,
      taskId,
      parseCompletionCriteria(task.completionCriteriaJson),
    );
  }
  assertTransition(task.status, to, guards);
  const result = db
    .update(tasks)
    .set({ status: to, version: task.version + 1 })
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
export function transitionTask(db: Db, taskId: string, to: TaskStatus) {
  return db.transaction((tx) => applyTransition(tx, taskId, to), { behavior: 'immediate' });
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
  },
) {
  const row = {
    id: newId('evid'),
    taskId: input.taskId,
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
export function addSuggestion(db: Db, input: NewSuggestionInput): SuggestionOutcome {
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
      const task = addTask(tx, taskInput);
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

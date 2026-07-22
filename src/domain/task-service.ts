import { and, count, eq, inArray, notInArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import {
  evidence,
  taskDependencies,
  tasks,
  taskSuggestions,
  type TaskComplexity,
} from '../db/schema.js';
import { newId, nowIso } from './ids.js';
import { assertTransition, type TaskStatus, TERMINAL_STATUSES } from './lifecycle.js';

export interface NewTaskInput {
  projectId: string;
  title: string;
  description?: string;
  complexity?: TaskComplexity;
  roadmapItemId?: string;
  suggestionId?: string;
}

export function addTask(db: Db, input: NewTaskInput) {
  const row = {
    id: newId('task'),
    projectId: input.projectId,
    roadmapItemId: input.roadmapItemId ?? null,
    suggestionId: input.suggestionId ?? null,
    title: input.title,
    description: input.description ?? '',
    status: 'draft' as const,
    complexity: input.complexity ?? ('bounded' as const),
  };
  db.insert(tasks).values(row).run();
  return getTask(db, row.id);
}

export function getTask(db: Db, taskId: string) {
  const row = db.select().from(tasks).where(eq(tasks.id, taskId)).get();
  if (!row) throw new Error(`task not found: ${taskId}`);
  return row;
}

export function incompleteDependencyCount(db: Db, taskId: string): number {
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

export function evidenceCount(db: Db, taskId: string): number {
  const result = db.select({ n: count() }).from(evidence).where(eq(evidence.taskId, taskId)).get();
  return result?.n ?? 0;
}

/**
 * The ONLY sanctioned way to change a task's status. Loads the guard data
 * the transition needs and validates centrally.
 */
export function transitionTask(db: Db, taskId: string, to: TaskStatus) {
  const task = getTask(db, taskId);
  assertTransition(task.status, to, {
    incompleteDependencyCount: incompleteDependencyCount(db, taskId),
    evidenceCount: evidenceCount(db, taskId),
  });
  db.update(tasks).set({ status: to }).where(eq(tasks.id, taskId)).run();
  return getTask(db, taskId);
}

export function addDependency(db: Db, taskId: string, dependsOnTaskId: string) {
  if (taskId === dependsOnTaskId) throw new Error('a task cannot depend on itself');
  getTask(db, taskId);
  getTask(db, dependsOnTaskId);
  const row = { id: newId('tdep'), taskId, dependsOnTaskId };
  db.insert(taskDependencies).values(row).run();
  return row;
}

export function addEvidence(
  db: Db,
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
  db.insert(evidence).values(row).run();
  return row;
}

export interface NewSuggestionInput {
  projectId: string;
  title: string;
  description?: string;
  rationale?: string;
  suggestedBy?: string;
  roadmapItemId?: string;
}

/** Suggested tasks live in task_suggestions and stay out of tasks until approved. */
export function addSuggestion(db: Db, input: NewSuggestionInput) {
  const row = {
    id: newId('tsug'),
    projectId: input.projectId,
    roadmapItemId: input.roadmapItemId ?? null,
    title: input.title,
    description: input.description ?? '',
    rationale: input.rationale ?? '',
    suggestedBy: input.suggestedBy ?? 'human',
    status: 'pending' as const,
  };
  db.insert(taskSuggestions).values(row).run();
  return row;
}

export function getSuggestion(db: Db, suggestionId: string) {
  const row = db.select().from(taskSuggestions).where(eq(taskSuggestions.id, suggestionId)).get();
  if (!row) throw new Error(`suggestion not found: ${suggestionId}`);
  return row;
}

/** Performs the conceptual suggested -> draft transition by materialising a Task. */
export function approveSuggestion(db: Db, suggestionId: string, note?: string) {
  const suggestion = getSuggestion(db, suggestionId);
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
  const task = addTask(db, taskInput);
  db.update(taskSuggestions)
    .set({
      status: 'approved',
      approvedTaskId: task.id,
      decidedAt: nowIso(),
      decisionNote: note ?? null,
    })
    .where(eq(taskSuggestions.id, suggestionId))
    .run();
  return { suggestion: getSuggestion(db, suggestionId), task };
}

export function rejectSuggestion(db: Db, suggestionId: string, note?: string) {
  const suggestion = getSuggestion(db, suggestionId);
  if (suggestion.status !== 'pending') {
    throw new Error(`suggestion ${suggestionId} already ${suggestion.status}`);
  }
  db.update(taskSuggestions)
    .set({ status: 'rejected', decidedAt: nowIso(), decisionNote: note ?? null })
    .where(eq(taskSuggestions.id, suggestionId))
    .run();
  return getSuggestion(db, suggestionId);
}

export function listTasks(db: Db, projectId?: string) {
  const query = projectId
    ? db.select().from(tasks).where(eq(tasks.projectId, projectId))
    : db.select().from(tasks);
  return query.all();
}

/** Tasks eligible to run next: queued, or ready with all dependencies completed. */
export function queueableTasks(db: Db, projectId?: string) {
  return listTasks(db, projectId)
    .filter((t) => !TERMINAL_STATUSES.includes(t.status))
    .filter(
      (t) =>
        t.status === 'queued' ||
        (t.status === 'ready' && incompleteDependencyCount(db, t.id) === 0),
    );
}

import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { agentProviders, agentRunEvents, roadmapItems, tasks } from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import {
  appendRunEvent,
  createRun,
  listRunEvents,
  recordUsage,
  setRunStatus,
} from '../src/domain/run-service.js';
import {
  addDependency,
  addEvidence,
  addSuggestion,
  addTask,
  approveSuggestion,
  queueableTasks,
  rejectSuggestion,
  transitionTask,
} from '../src/domain/task-service.js';
import { seedProject, testDb } from './helpers.js';

function readyTask(db: ReturnType<typeof testDb>, projectId: string, title: string) {
  const task = addTask(db, { projectId, title });
  transitionTask(db, task.id, 'ready');
  return task;
}

describe('suggestions', () => {
  it('keeps suggestions out of the tasks table until approved', () => {
    const db = testDb();
    const project = seedProject(db);
    const suggestion = addSuggestion(db, { projectId: project.id, title: 'Add caching' });
    expect(db.select().from(tasks).all()).toHaveLength(0);

    const { suggestion: approved, task } = approveSuggestion(db, suggestion.id, 'good idea');
    expect(approved.status).toBe('approved');
    expect(approved.approvedTaskId).toBe(task.id);
    expect(task.status).toBe('draft');
    expect(task.suggestionId).toBe(suggestion.id);
    expect(db.select().from(tasks).all()).toHaveLength(1);
  });

  it('rejects suggestions without creating a task, and blocks double decisions', () => {
    const db = testDb();
    const project = seedProject(db);
    const suggestion = addSuggestion(db, { projectId: project.id, title: 'Rewrite in Rust' });
    const rejected = rejectSuggestion(db, suggestion.id, 'no');
    expect(rejected.status).toBe('rejected');
    expect(db.select().from(tasks).all()).toHaveLength(0);
    expect(() => approveSuggestion(db, suggestion.id)).toThrow(/already rejected/);
    expect(() => rejectSuggestion(db, suggestion.id)).toThrow(/already rejected/);
  });
});

describe('dependency blocking', () => {
  it('blocks queueing until dependencies complete', () => {
    const db = testDb();
    const project = seedProject(db);
    const blocker = readyTask(db, project.id, 'schema first');
    const dependent = readyTask(db, project.id, 'api second');
    addDependency(db, dependent.id, blocker.id);

    expect(() => transitionTask(db, dependent.id, 'queued')).toThrow(/blocked by 1/);
    expect(queueableTasks(db).map((t) => t.id)).toEqual([blocker.id]);

    // Drive the blocker to completed, with evidence.
    for (const status of [
      'queued',
      'running',
      'verifying',
      'reviewing',
      'ready_to_merge',
    ] as const) {
      transitionTask(db, blocker.id, status);
    }
    addEvidence(db, { taskId: blocker.id, kind: 'test_result', summary: 'tests green' });
    transitionTask(db, blocker.id, 'completed');

    expect(transitionTask(db, dependent.id, 'queued').status).toBe('queued');
  });

  it('refuses self-dependencies', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'solo' });
    expect(() => addDependency(db, task.id, task.id)).toThrow(/cannot depend on itself/);
  });
});

describe('evidence gating', () => {
  it('refuses to complete a task without evidence', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = readyTask(db, project.id, 'ship it');
    for (const status of [
      'queued',
      'running',
      'verifying',
      'reviewing',
      'ready_to_merge',
    ] as const) {
      transitionTask(db, task.id, status);
    }
    expect(() => transitionTask(db, task.id, 'completed')).toThrow(/without.*evidence/);
    addEvidence(db, { taskId: task.id, kind: 'verification_run', summary: 'pnpm test passed' });
    expect(transitionTask(db, task.id, 'completed').status).toBe('completed');
  });
});

describe('task-to-roadmap relationships', () => {
  it('lets one roadmap item own many tasks', () => {
    const db = testDb();
    const project = seedProject(db);
    const item = { id: newId('ritem'), projectId: project.id, stableRef: 'RM-1', title: 'Auth' };
    db.insert(roadmapItems).values(item).run();

    const a = addTask(db, { projectId: project.id, roadmapItemId: item.id, title: 'login' });
    const b = addTask(db, { projectId: project.id, roadmapItemId: item.id, title: 'logout' });
    const linked = db.select().from(tasks).where(eq(tasks.roadmapItemId, item.id)).all();
    expect(linked.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('agent runs', () => {
  function seedRun(db: ReturnType<typeof testDb>) {
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'work' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();
    const run = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'sonnet',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'test route',
    });
    return { db, task, providerId, run };
  }

  it('supports many runs per task and records routing metadata', () => {
    const { db, task, providerId, run } = seedRun(testDb());
    const second = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'opus',
      purpose: 'review',
      billingMode: 'subscription_included',
      routingReason: 'escalated review',
      independenceLoss: 'same-provider review',
    });
    expect(run.taskId).toBe(task.id);
    expect(second.taskId).toBe(task.id);
    expect(second.independenceLoss).toMatch(/same-provider/);
    expect(setRunStatus(db, run.id, 'running').startedAt).toBeTruthy();
    expect(setRunStatus(db, run.id, 'succeeded').endedAt).toBeTruthy();
  });

  it('keeps run event history append-only with per-run sequence numbers', () => {
    const { db, run } = seedRun(testDb());
    appendRunEvent(db, run.id, 'started', { pid: 1 });
    appendRunEvent(db, run.id, 'message', { text: 'hello' });
    const events = listRunEvents(db, run.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);

    // UPDATE and DELETE are blocked by DB triggers.
    expect(() => db.update(agentRunEvents).set({ type: 'tampered' }).run()).toThrow(/append-only/);
    expect(() => db.delete(agentRunEvents).run()).toThrow(/append-only/);
  });

  it('records usage observations', () => {
    const { db, providerId, run } = seedRun(testDb());
    const usage = recordUsage(db, {
      providerId,
      agentRunId: run.id,
      kind: 'tokens',
      data: { input: 100, output: 20 },
    });
    expect(JSON.parse(usage.dataJson)).toEqual({ input: 100, output: 20 });
  });
});

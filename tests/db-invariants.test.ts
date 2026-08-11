import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  agentProviders,
  agentRuns,
  reviewFindings,
  roadmapItems,
  tasks,
  taskSuggestions,
  verificationRuns,
} from '../src/db/schema.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { createRun, recordVerificationRun } from '../src/domain/run-service.js';
import { addSuggestion, addTask, transitionTask } from '../src/domain/task-service.js';
import {
  ensureObservedModel,
  materialiseApprovedSuggestion,
  recordQualifyingVerification,
  seedProject,
  testDb,
} from './helpers.js';

describe('database-enforced invariants', () => {
  it("refuses persisting a task with status 'suggested'", () => {
    const db = testDb();
    const project = seedProject(db);
    expect(() =>
      db
        .insert(tasks)
        .values({
          id: newId('task'),
          projectId: project.id,
          title: 'sneaky',
          status: 'suggested',
          scope: undefined,
        } as never)
        .run(),
    ).toThrow(/CHECK|constraint/i);
  });

  it('refuses invalid statuses and complexities outright', () => {
    const db = testDb();
    const project = seedProject(db);
    expect(() =>
      db
        .insert(tasks)
        .values({
          id: newId('task'),
          projectId: project.id,
          title: 'bad',
          status: 'done-ish',
        } as never)
        .run(),
    ).toThrow(/CHECK|constraint/i);
  });

  it('enforces one approved task per suggestion at the DB level', () => {
    const db = testDb();
    const project = seedProject(db);
    const { suggestion } = addSuggestion(db, { projectId: project.id, title: 'once only' });
    const { task } = materialiseApprovedSuggestion(db, suggestion.id);
    expect(task.suggestionId).toBe(suggestion.id);
    expect(() =>
      db
        .insert(tasks)
        .values({
          id: newId('task'),
          projectId: project.id,
          suggestionId: suggestion.id,
          title: 'second materialisation',
        })
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it('refuses a task whose roadmap item belongs to a different project', () => {
    const db = testDb();
    const projectA = seedProject(db, 'alpha');
    const projectB = seedProject(db, 'beta');
    const item = { id: newId('ritem'), projectId: projectA.id, stableRef: 'RM-1', title: 'x' };
    db.insert(roadmapItems).values(item).run();
    expect(() =>
      addTask(db, { projectId: projectB.id, roadmapItemId: item.id, title: 'cross-project' }),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('refuses verification/review rows citing a run of a different task', () => {
    const db = testDb();
    const project = seedProject(db);
    const taskA = addTask(db, { projectId: project.id, title: 'A' });
    const taskB = addTask(db, { projectId: project.id, title: 'B' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();
    ensureObservedModel(db, providerId);
    const runOnA = createRun(db, {
      taskId: taskA.id,
      providerId,
      modelRef: 'sonnet',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'test',
    });
    const now = new Date().toISOString();
    expect(() =>
      db
        .insert(verificationRuns)
        .values({
          id: newId('vrun'),
          taskId: taskB.id,
          agentRunId: runOnA.id,
          command: 'pnpm test',
          status: 'passed',
          exitCode: 0,
          startedAt: now,
          endedAt: now,
        })
        .run(),
    ).toThrow(/FOREIGN KEY/i);
    expect(() =>
      db
        .insert(reviewFindings)
        .values({
          id: newId('rfind'),
          taskId: taskB.id,
          agentRunId: runOnA.id,
          severity: 'major',
          summary: 'misattributed finding',
        })
        .run(),
    ).toThrow(/FOREIGN KEY/i);
  });

  it('task relationships cannot be silently reassigned', () => {
    const db = testDb();
    const projectA = seedProject(db, 'alpha');
    const projectB = seedProject(db, 'beta');
    const { suggestion } = addSuggestion(db, { projectId: projectA.id, title: 'origin' });
    const { task } = materialiseApprovedSuggestion(db, suggestion.id);

    expect(() =>
      db.update(tasks).set({ projectId: projectB.id }).where(eq(tasks.id, task.id)).run(),
    ).toThrow(/immutable/);
    expect(() =>
      db.update(tasks).set({ suggestionId: null }).where(eq(tasks.id, task.id)).run(),
    ).toThrow(/immutable/);
  });

  it('suggestion decisions and linkage cannot be rewritten', () => {
    const db = testDb();
    const project = seedProject(db);
    const { suggestion } = addSuggestion(db, { projectId: project.id, title: 'decided' });
    const { task } = materialiseApprovedSuggestion(db, suggestion.id);

    expect(() =>
      db
        .update(taskSuggestions)
        .set({ status: 'rejected', approvedTaskId: null })
        .where(eq(taskSuggestions.id, suggestion.id))
        .run(),
    ).toThrow(/cannot change status|immutable/);

    const otherTask = addTask(db, { projectId: project.id, title: 'other' });
    expect(() =>
      db
        .update(taskSuggestions)
        .set({ approvedTaskId: otherTask.id })
        .where(eq(taskSuggestions.id, suggestion.id))
        .run(),
    ).toThrow(/immutable/);
    void task;
  });

  it('a suggestion cannot claim approved status without a task (CHECK)', () => {
    const db = testDb();
    const project = seedProject(db);
    expect(() =>
      db
        .insert(taskSuggestions)
        .values({
          id: newId('tsug'),
          projectId: project.id,
          title: 'phantom approval',
          scopeFingerprint: 'fp',
          status: 'approved',
        })
        .run(),
    ).toThrow(/CHECK|constraint/i);
  });

  it('only one pending suggestion per scope per project (partial unique index)', () => {
    const db = testDb();
    const project = seedProject(db);
    db.insert(taskSuggestions)
      .values({
        id: newId('tsug'),
        projectId: project.id,
        title: 'one',
        scopeFingerprint: 'same-fp',
      })
      .run();
    expect(() =>
      db
        .insert(taskSuggestions)
        .values({
          id: newId('tsug'),
          projectId: project.id,
          title: 'two',
          scopeFingerprint: 'same-fp',
        })
        .run(),
    ).toThrow(/UNIQUE/i);
  });

  it('resolved decisions are immutable', () => {
    const db = testDb();
    const project = seedProject(db);
    const decision = createDecisionRequest(db, {
      projectId: project.id,
      category: 'merge',
      question: 'merge?',
    });
    resolveDecision(db, decision.id, 'rejected', 'not yet');
    expect(() => resolveDecision(db, decision.id, 'approved')).toThrow(/not open/);
  });

  it('a direct write cannot mark a task completed without qualifying proof', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'no shortcuts' });

    // from a non-ready_to_merge status, however the write arrives
    expect(() =>
      db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, task.id)).run(),
    ).toThrow(/only ready_to_merge may complete/);

    // even FROM ready_to_merge, completion needs the full proof set
    transitionTask(db, task.id, 'ready');
    for (const status of ['queued', 'running', 'verifying', 'reviewing', 'ready_to_merge'] as const)
      transitionTask(db, task.id, status);
    expect(() =>
      db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, task.id)).run(),
    ).toThrow(/qualifying passed verification run/);

    // a bare 'passed' verification row (no run provenance, no evidence) is not proof
    recordVerificationRun(db, {
      taskId: task.id,
      command: 'pnpm test',
      status: 'passed',
      exitCode: 0,
    });
    expect(() =>
      db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, task.id)).run(),
    ).toThrow(/qualifying passed verification run/);

    // with a fully qualifying record, the same direct write is accepted
    recordQualifyingVerification(db, task.id);
    db.update(tasks).set({ status: 'completed' }).where(eq(tasks.id, task.id)).run();
  });

  it('a task cannot be inserted directly in completed status', () => {
    const db = testDb();
    const project = seedProject(db);
    expect(() =>
      db
        .insert(tasks)
        .values({
          id: newId('task'),
          projectId: project.id,
          title: 'born finished',
          status: 'completed',
        })
        .run(),
    ).toThrow(/cannot be created directly in completed/);
  });

  it('verification runs refuse inconsistent passed labels and are immutable once terminal', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'verified work' });

    // direct insert of a 'passed' row without exit code 0 / timestamps
    expect(() =>
      db
        .insert(verificationRuns)
        .values({
          id: newId('vrun'),
          taskId: task.id,
          command: 'pnpm test',
          status: 'passed',
          exitCode: 1,
          startedAt: new Date().toISOString(),
          endedAt: new Date().toISOString(),
        })
        .run(),
    ).toThrow(/exit code 0/);

    const vrun = recordVerificationRun(db, {
      taskId: task.id,
      command: 'pnpm test',
      status: 'failed',
      exitCode: 1,
    });
    // a terminal record cannot be laundered into 'passed' after the fact
    expect(() =>
      db
        .update(verificationRuns)
        .set({ status: 'passed', exitCode: 0 })
        .where(eq(verificationRuns.id, vrun.id))
        .run(),
    ).toThrow(/immutable/);
  });

  it('agent runs enforce valid enums at the DB level', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'work' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();
    ensureObservedModel(db, providerId);
    expect(() =>
      db
        .insert(agentRuns)
        .values({
          id: newId('arun'),
          taskId: task.id,
          providerId,
          modelRef: 'sonnet',
          purpose: 'world-domination',
          billingMode: 'subscription_included',
          routingReason: 'nope',
        } as never)
        .run(),
    ).toThrow(/CHECK|constraint/i);
  });
});

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
import { createRun } from '../src/domain/run-service.js';
import { addSuggestion, addTask, approveSuggestion } from '../src/domain/task-service.js';
import { seedProject, testDb } from './helpers.js';

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
    const { task } = approveSuggestion(db, suggestion.id);
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
    const runOnA = createRun(db, {
      taskId: taskA.id,
      providerId,
      modelRef: 'sonnet',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'test',
    });
    expect(() =>
      db
        .insert(verificationRuns)
        .values({
          id: newId('vrun'),
          taskId: taskB.id,
          agentRunId: runOnA.id,
          command: 'pnpm test',
          status: 'passed',
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
    const { task } = approveSuggestion(db, suggestion.id);

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
    const { task } = approveSuggestion(db, suggestion.id);

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

  it('agent runs enforce valid enums at the DB level', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'work' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();
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

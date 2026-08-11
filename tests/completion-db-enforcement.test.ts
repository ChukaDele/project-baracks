import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import { agentProviders } from '../src/db/schema.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { createRun, recordVerificationRun, setRunStatus } from '../src/domain/run-service.js';
import { addEvidence, addTask, transitionTask } from '../src/domain/task-service.js';
import { ensureObservedModel, seedProject } from './helpers.js';

/**
 * P1-3 reproducer: task-specific completion criteria must be enforced at the
 * SQLite boundary, not only by the service layer. A direct SQL UPDATE to
 * 'completed' must not bypass minPassedVerificationRuns, requireArtifact or
 * requiredDecisionCategories.
 */

function harness() {
  const { db, sqlite } = openDb(':memory:');
  const project = seedProject(db);
  const providerId = newId('aprov');
  db.insert(agentProviders).values({ id: providerId, name: 'p' }).run();
  ensureObservedModel(db, providerId);

  // Criteria the service enforces: two verifications, an artifact, a merge decision.
  const task = addTask(db, {
    projectId: project.id,
    title: 'strict completion',
    completionCriteriaJson: JSON.stringify({
      minPassedVerificationRuns: 2,
      requireArtifact: true,
      requiredDecisionCategories: ['merge'],
    }),
  });
  for (const s of [
    'ready',
    'queued',
    'running',
    'verifying',
    'reviewing',
    'ready_to_merge',
  ] as const) {
    transitionTask(db, task.id, s);
  }

  // Supply exactly ONE qualifying verification: enough for the old trigger,
  // short of the task's own criteria.
  const run = createRun(db, {
    taskId: task.id,
    providerId,
    modelRef: 'sonnet',
    purpose: 'verification',
    billingMode: 'subscription_included',
    routingReason: 'one verification',
  });
  setRunStatus(db, run.id, 'succeeded');
  const vrun = recordVerificationRun(db, {
    taskId: task.id,
    command: 'pnpm test',
    status: 'passed',
    exitCode: 0,
    agentRunId: run.id,
  });
  addEvidence(db, { taskId: task.id, kind: 'verification_run', ref: vrun.id, summary: 'green' });

  const forceComplete = () =>
    sqlite
      .prepare(`UPDATE tasks SET status = 'completed', version = version + 1 WHERE id = ?`)
      .run(task.id);

  return { db, sqlite, project, task, providerId, forceComplete };
}

describe('P1-3 database-enforced completion criteria', () => {
  it('captures the exact criteria at dispatch and refuses later weakening', () => {
    const { sqlite, task } = harness();
    const row = sqlite
      .prepare(
        `SELECT completion_criteria_json AS criteria,
                completion_criteria_snapshot_json AS snapshot,
                completion_criteria_locked_at AS lockedAt
         FROM tasks WHERE id = ?`,
      )
      .get(task.id) as { criteria: string; snapshot: string; lockedAt: string };
    expect(row.snapshot).toBe(row.criteria);
    expect(row.lockedAt).toBeTruthy();
    expect(() =>
      sqlite
        .prepare(
          `UPDATE tasks SET completion_criteria_json = '{"minPassedVerificationRuns":1}' WHERE id = ?`,
        )
        .run(task.id),
    ).toThrow(/immutable/);
  });

  it('refuses weakening criteria in the same direct update that dispatches', () => {
    const { db, sqlite } = openDb(':memory:');
    const project = seedProject(db);
    const task = addTask(db, {
      projectId: project.id,
      title: 'cannot weaken at dispatch',
      completionCriteriaJson: JSON.stringify({ minPassedVerificationRuns: 3 }),
    });
    transitionTask(db, task.id, 'ready');
    const weaker = JSON.stringify({ minPassedVerificationRuns: 1 });
    expect(() =>
      sqlite
        .prepare(
          `UPDATE tasks
           SET status = 'queued', completion_criteria_json = ?,
               completion_criteria_snapshot_json = ?, completion_criteria_locked_at = ?
           WHERE id = ?`,
        )
        .run(weaker, weaker, new Date().toISOString(), task.id),
    ).toThrow(/exact pre-dispatch/);
  });

  it('refuses a task inserted directly into a dispatched state', () => {
    const { db, sqlite } = openDb(':memory:');
    const project = seedProject(db);
    expect(() =>
      sqlite
        .prepare(
          `INSERT INTO tasks
           (id, project_id, title, description, status, complexity, version,
            completion_criteria_json, completion_criteria_snapshot_json,
            completion_criteria_locked_at, created_at, updated_at)
           VALUES (?, ?, 'bypass', '', 'queued', 'bounded', 0, '{}', '{}', ?, ?, ?)`,
        )
        .run(
          newId('task'),
          project.id,
          new Date().toISOString(),
          new Date().toISOString(),
          new Date().toISOString(),
        ),
    ).toThrow(/cannot be inserted directly.*dispatched/);
  });

  it('direct SQL cannot complete a task short of its minimum verifications', () => {
    const { forceComplete } = harness();
    expect(() => forceComplete()).toThrow();
  });

  it('completes via direct SQL only once every task-specific criterion is met', () => {
    const { db, project, task, providerId, sqlite, forceComplete } = harness();

    // second qualifying verification
    const run2 = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'sonnet',
      purpose: 'verification',
      billingMode: 'subscription_included',
      routingReason: 'second verification',
    });
    setRunStatus(db, run2.id, 'succeeded');
    const vrun2 = recordVerificationRun(db, {
      taskId: task.id,
      command: 'pnpm typecheck',
      status: 'passed',
      exitCode: 0,
      agentRunId: run2.id,
    });
    addEvidence(db, {
      taskId: task.id,
      kind: 'verification_run',
      ref: vrun2.id,
      summary: 'green2',
    });

    // still missing artifact + merge decision
    expect(() => forceComplete()).toThrow();

    addEvidence(db, { taskId: task.id, kind: 'artifact', ref: 'abc1234', summary: 'commit' });
    expect(() => forceComplete()).toThrow();

    const otherProject = seedProject(db, 'other');
    const wrongProjectDecision = createDecisionRequest(db, {
      projectId: otherProject.id,
      taskId: task.id,
      category: 'merge',
      question: 'wrong project merge?',
    });
    resolveDecision(db, wrongProjectDecision.id, 'approved', 'not sufficient');
    expect(() => forceComplete()).toThrow(/project- and task-bound/);

    const merge = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'merge',
      question: 'merge?',
    });
    resolveDecision(db, merge.id, 'approved', 'lgtm');

    // now every criterion is satisfied
    forceComplete();
    expect(sqlite.prepare(`SELECT status FROM tasks WHERE id = ?`).get(task.id)).toMatchObject({
      status: 'completed',
    });
  });
});

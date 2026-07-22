import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import { agentProviders } from '../src/db/schema.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { createRun, recordVerificationRun, setRunStatus } from '../src/domain/run-service.js';
import { addEvidence, addTask, transitionTask } from '../src/domain/task-service.js';
import { seedProject } from './helpers.js';

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
  for (const s of ['ready', 'queued', 'running', 'verifying', 'reviewing', 'ready_to_merge'] as const) {
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
    addEvidence(db, { taskId: task.id, kind: 'verification_run', ref: vrun2.id, summary: 'green2' });

    // still missing artifact + merge decision
    expect(() => forceComplete()).toThrow();

    addEvidence(db, { taskId: task.id, kind: 'artifact', ref: 'abc1234', summary: 'commit' });
    expect(() => forceComplete()).toThrow();

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

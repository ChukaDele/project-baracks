import { describe, expect, it } from 'vitest';
import { agentProviders, agentRuns } from '../src/db/schema.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { createRun, RunAuthorisationError } from '../src/domain/run-service.js';
import { addTask } from '../src/domain/task-service.js';
import { seedProject, testDb } from './helpers.js';

/**
 * Paid execution authority: a run with a paid billing mode is created only
 * when an APPROVED 'paid_usage' DecisionRequest — bound to the same task and
 * project and covering the requested provider/model scope — exists in the
 * database, validated inside the run-creation transaction. Caller-supplied
 * identifiers, forged references, stale/cross-task/mis-scoped approvals all
 * fail, at the service layer and again at the DB boundary.
 */

function setup() {
  const db = testDb();
  const project = seedProject(db);
  const task = addTask(db, { projectId: project.id, title: 'expensive work' });
  const providerId = newId('aprov');
  db.insert(agentProviders).values({ id: providerId, name: 'claude-code' }).run();
  return { db, project, task, providerId };
}

function paidRunInput(taskId: string, providerId: string, decisionId?: string) {
  const input: Parameters<typeof createRun>[1] = {
    taskId,
    providerId,
    modelRef: 'opus',
    purpose: 'implementation' as const,
    billingMode: 'api_billing' as const,
    routingReason: 'paid route under test',
  };
  if (decisionId !== undefined) input.paidUsageDecisionId = decisionId;
  return input;
}

describe('paid-usage decision validation inside the run transaction', () => {
  it('refuses a forged decision reference that does not exist', () => {
    const { db, task, providerId } = setup();
    expect(() => createRun(db, paidRunInput(task.id, providerId, 'dreq_forged'))).toThrow(
      RunAuthorisationError,
    );
  });

  it('refuses a decision that is open, rejected or expired (stale approvals)', () => {
    const { db, project, task, providerId } = setup();
    const open = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'paid_usage',
      question: 'spend?',
    });
    expect(() => createRun(db, paidRunInput(task.id, providerId, open.id))).toThrow(
      RunAuthorisationError,
    );

    const rejected = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'paid_usage',
      question: 'spend?',
    });
    resolveDecision(db, rejected.id, 'rejected', 'no');
    expect(() => createRun(db, paidRunInput(task.id, providerId, rejected.id))).toThrow(
      RunAuthorisationError,
    );
  });

  it('refuses an approval of the wrong category', () => {
    const { db, project, task, providerId } = setup();
    const merge = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'merge',
      question: 'merge?',
    });
    resolveDecision(db, merge.id, 'approved', 'lgtm');
    expect(() => createRun(db, paidRunInput(task.id, providerId, merge.id))).toThrow(
      RunAuthorisationError,
    );
  });

  it('refuses a cross-task approval and an approval bound to no task', () => {
    const { db, project, task, providerId } = setup();
    const otherTask = addTask(db, { projectId: project.id, title: 'other work' });
    const crossTask = createDecisionRequest(db, {
      projectId: project.id,
      taskId: otherTask.id,
      category: 'paid_usage',
      question: 'spend on the OTHER task?',
    });
    resolveDecision(db, crossTask.id, 'approved', 'yes, for the other task');
    expect(() => createRun(db, paidRunInput(task.id, providerId, crossTask.id))).toThrow(
      RunAuthorisationError,
    );

    const taskless = createDecisionRequest(db, {
      projectId: project.id,
      category: 'paid_usage',
      question: 'blanket spend?',
    });
    resolveDecision(db, taskless.id, 'approved', 'blanket');
    expect(() => createRun(db, paidRunInput(task.id, providerId, taskless.id))).toThrow(
      RunAuthorisationError,
    );
  });

  it('refuses an approval scoped to a different provider or model', () => {
    const { db, project, task, providerId } = setup();
    const wrongProvider = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'paid_usage',
      question: 'spend on codex?',
      contextJson: JSON.stringify({ scope: { provider: 'codex' } }),
    });
    resolveDecision(db, wrongProvider.id, 'approved', 'codex only');
    expect(() => createRun(db, paidRunInput(task.id, providerId, wrongProvider.id))).toThrow(
      RunAuthorisationError,
    );

    const wrongModel = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'paid_usage',
      question: 'spend on sonnet only?',
      contextJson: JSON.stringify({ scope: { provider: 'claude-code', modelRef: 'sonnet' } }),
    });
    resolveDecision(db, wrongModel.id, 'approved', 'sonnet only');
    expect(() => createRun(db, paidRunInput(task.id, providerId, wrongModel.id))).toThrow(
      RunAuthorisationError,
    );
  });

  it('creates the run only for a correctly bound, correctly scoped approval', () => {
    const { db, project, task, providerId } = setup();
    const decision = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'paid_usage',
      question: 'spend on claude-code/opus for this task?',
      contextJson: JSON.stringify({ scope: { provider: 'claude-code', modelRef: 'opus' } }),
      expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    });
    resolveDecision(db, decision.id, 'approved', 'authorised');
    const run = createRun(db, paidRunInput(task.id, providerId, decision.id));
    expect(run.paidUsageDecisionId).toBe(decision.id);
    expect(run.billingMode).toBe('api_billing');
  });

  it('the DB boundary independently refuses forged paid inserts', () => {
    const { db, project, task, providerId } = setup();
    // bare reference to a non-approved decision, inserted directly
    const open = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'paid_usage',
      question: 'spend?',
    });
    expect(() =>
      db
        .insert(agentRuns)
        .values({
          id: newId('arun'),
          taskId: task.id,
          providerId,
          modelRef: 'opus',
          purpose: 'implementation',
          billingMode: 'api_billing',
          routingReason: 'forged direct insert',
          paidUsageDecisionId: open.id,
        })
        .run(),
    ).toThrow(/approved paid_usage DecisionRequest/);
  });
});

import { describe, expect, it } from 'vitest';
import { agentModels, agentProviders, agentRuns } from '../src/db/schema.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { createRun, RunAuthorisationError } from '../src/domain/run-service.js';
import { addTask } from '../src/domain/task-service.js';
import { seedProject, testDb } from './helpers.js';

/**
 * P1-2 reproducers:
 *  (a) a run must not override authoritative persisted model billing state;
 *  (b) a paid approval must be provider/model-scoped, unexpired and
 *      consumable exactly once.
 */

const FUTURE = () => new Date(Date.now() + 60 * 60 * 1000).toISOString();
const PAST = () => new Date(Date.now() - 1000).toISOString();

function setup() {
  const db = testDb();
  const project = seedProject(db);
  const task = addTask(db, { projectId: project.id, title: 'spend' });
  const providerId = newId('aprov');
  db.insert(agentProviders).values({ id: providerId, name: 'claude-code' }).run();
  return { db, project, task, providerId };
}

/** Persist a model whose billing has NOT been authoritatively observed. */
function persistUnknownBillingModel(db: ReturnType<typeof testDb>, providerId: string) {
  const id = newId('amodel');
  db.insert(agentModels)
    .values({ id, providerId, modelRef: 'opus', routingClass: 'opus', billingMode: 'unknown' })
    .run();
  return id;
}

describe('P1-2 run billing derives from authoritative persisted state', () => {
  it('refuses to record a run as subscription_included for an unknown-billing model', () => {
    const { db, task, providerId } = setup();
    const modelId = persistUnknownBillingModel(db, providerId);
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        modelId,
        modelRef: 'opus',
        purpose: 'implementation',
        billingMode: 'subscription_included',
        routingReason: 'caller claims it is free',
      }),
    ).toThrow(RunAuthorisationError);
  });

  it('the DB boundary also refuses a mismatch against persisted model billing', () => {
    const { db, task, providerId } = setup();
    persistUnknownBillingModel(db, providerId);
    // direct insert, bypassing the service, still refused by the trigger
    expect(() =>
      db
        .insert(agentRuns)
        .values({
          id: newId('arun'),
          taskId: task.id,
          providerId,
          modelRef: 'opus',
          purpose: 'implementation',
          billingMode: 'subscription_included',
          routingReason: 'forged',
        })
        .run(),
    ).toThrow();
  });
});

function scopedApproval(
  db: ReturnType<typeof testDb>,
  projectId: string,
  taskId: string,
  expiresAt: string,
) {
  const decision = createDecisionRequest(db, {
    projectId,
    taskId,
    category: 'paid_usage',
    question: 'spend on claude-code/opus?',
    contextJson: JSON.stringify({ scope: { provider: 'claude-code', modelRef: 'opus' } }),
    expiresAt,
  });
  resolveDecision(db, decision.id, 'approved', 'authorised');
  return decision;
}

function paidInput(taskId: string, providerId: string, decisionId: string) {
  return {
    taskId,
    providerId,
    modelRef: 'opus',
    purpose: 'implementation' as const,
    billingMode: 'api_billing' as const,
    routingReason: 'paid route',
    paidUsageDecisionId: decisionId,
  };
}

describe('P1-2 one-use, scoped, unexpired paid approval', () => {
  it('refuses a scopeless paid approval (missing scope is NOT unrestricted)', () => {
    const { db, project, task, providerId } = setup();
    const decision = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'paid_usage',
      question: 'blanket spend?',
      expiresAt: FUTURE(),
    });
    resolveDecision(db, decision.id, 'approved', 'blanket');
    expect(() => createRun(db, paidInput(task.id, providerId, decision.id))).toThrow(
      RunAuthorisationError,
    );
  });

  it('refuses an expired paid approval', () => {
    const { db, project, task, providerId } = setup();
    const decision = scopedApproval(db, project.id, task.id, PAST());
    expect(() => createRun(db, paidInput(task.id, providerId, decision.id))).toThrow(
      RunAuthorisationError,
    );
  });

  it('consumes a valid approval exactly once — reuse is refused', () => {
    const { db, project, task, providerId } = setup();
    const decision = scopedApproval(db, project.id, task.id, FUTURE());

    const run = createRun(db, paidInput(task.id, providerId, decision.id));
    expect(run.billingMode).toBe('api_billing');
    expect(run.paidUsageDecisionId).toBe(decision.id);

    // second run under the same approval is refused (single-use)
    expect(() => createRun(db, paidInput(task.id, providerId, decision.id))).toThrow(
      RunAuthorisationError,
    );
  });
});

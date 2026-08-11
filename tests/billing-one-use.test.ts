import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { agentModels, agentProviders, agentRuns } from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import { createRun, RunAuthorisationError } from '../src/domain/run-service.js';
import { addTask } from '../src/domain/task-service.js';
import { recordBillingObservation } from '../src/providers/discovery-store.js';
import { seedProject, testDb } from './helpers.js';

/**
 * Billing authority for the FREE path (the only path that can create runs in
 * this build): a run's billing must match the model's authoritatively
 * observed billing, and an unobserved ('unknown') model is unroutable.
 * Paid billing modes are refused outright — see billing-authority.test.ts.
 * One-use paid approval consumption is deferred to milestone M2.
 */

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

describe('run billing derives from authoritative persisted state', () => {
  it('refuses a caller-supplied billing mode when no persisted model exists', () => {
    const { db, task, providerId } = setup();
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        modelRef: 'missing',
        purpose: 'implementation',
        billingMode: 'subscription_included',
        routingReason: 'caller claims it is free',
      }),
    ).toThrow(/no authoritative billing observation/);
  });

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

  it('refuses a run whose declared billing mode is unknown', () => {
    const { db, task, providerId } = setup();
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        modelRef: 'mystery',
        purpose: 'implementation',
        billingMode: 'unknown',
        routingReason: 'unproven cost basis',
      }),
    ).toThrow(/billing mode is unknown/);
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

  it('the DB boundary refuses setting known billing without an observation', () => {
    const { db, providerId } = setup();
    const modelId = persistUnknownBillingModel(db, providerId);
    expect(() =>
      db
        .update(agentModels)
        .set({ billingMode: 'subscription_included' })
        .where(eq(agentModels.id, modelId))
        .run(),
    ).toThrow(/authoritative persisted observation/);
  });

  it('permits a free run after the authoritative observation is persisted', () => {
    const { db, task, providerId } = setup();
    persistUnknownBillingModel(db, providerId);
    recordBillingObservation(db, {
      providerName: 'claude-code',
      modelRef: 'opus',
      billingMode: 'subscription_included',
      source: 'human',
      note: 'subscription account verified',
    });
    const run = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'opus',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'authoritatively observed',
    });
    expect(run.billingMode).toBe('subscription_included');
  });
});

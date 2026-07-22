import { describe, expect, it } from 'vitest';
import { agentProviders, agentRuns } from '../src/db/schema.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { createRun } from '../src/domain/run-service.js';
import { addTask } from '../src/domain/task-service.js';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';
import { seedProject, testDb } from './helpers.js';

/**
 * Paid provider execution is an unavailable capability in this build: run
 * creation refuses EVERY paid billing mode unconditionally — before the
 * transaction, before any approval lookup — no matter how well-formed the
 * approval is. The decision-scoping/consumption semantics are deferred to
 * milestone M2. The DB boundary keeps its own backstop against forged direct
 * paid inserts.
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

describe('paid run creation is disabled (paid-provider-execution unavailable)', () => {
  it('refuses a paid run with no decision reference', () => {
    const { db, task, providerId } = setup();
    expect(() => createRun(db, paidRunInput(task.id, providerId))).toThrow(
      CapabilityUnavailableError,
    );
  });

  it('refuses a paid run even with a fully approved, correctly scoped decision', () => {
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
    expect(() => createRun(db, paidRunInput(task.id, providerId, decision.id))).toThrow(
      CapabilityUnavailableError,
    );
    // nothing was written and nothing was consumed
    expect(db.select().from(agentRuns).all()).toHaveLength(0);
  });

  it('refuses usage_credits the same as api_billing', () => {
    const { db, task, providerId } = setup();
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        modelRef: 'opus',
        purpose: 'implementation',
        billingMode: 'usage_credits',
        routingReason: 'paid route under test',
      }),
    ).toThrow(CapabilityUnavailableError);
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

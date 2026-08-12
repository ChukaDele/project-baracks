import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { agentModels, agentProviders, agentRuns, decisionRequests } from '../src/db/schema.js';
import {
  createDecisionRequest,
  isApprovedDecision,
  resolveDecision,
} from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { createRun, RunAuthorisationError } from '../src/domain/run-service.js';
import { addTask } from '../src/domain/task-service.js';
import { recordBillingObservation } from '../src/providers/discovery-store.js';
import { seedProject, testDb } from './helpers.js';

/** Paid runs require authoritative billing plus an exact, one-use approval. */

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

function authorisePaidModel(db: ReturnType<typeof testDb>, providerId: string) {
  db.insert(agentModels)
    .values({
      id: newId('amodel'),
      providerId,
      modelRef: 'opus',
      routingClass: 'opus',
      billingMode: 'unknown',
    })
    .run();
  recordBillingObservation(db, {
    providerName: 'claude-code',
    modelRef: 'opus',
    billingMode: 'api_billing',
    source: 'human',
    note: 'owner confirmed API billing',
  });
}

function approvePaidUsage(
  db: ReturnType<typeof testDb>,
  input: {
    projectId: string;
    taskId: string;
    purpose?: string;
    expiresAt?: string;
  },
) {
  const decision = createDecisionRequest(db, {
    projectId: input.projectId,
    taskId: input.taskId,
    category: 'paid_usage',
    question: 'spend on claude-code/opus for this task?',
    contextJson: JSON.stringify({
      scope: {
        provider: 'claude-code',
        modelRef: 'opus',
        purpose: input.purpose ?? 'implementation',
      },
    }),
    expiresAt: input.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
  });
  resolveDecision(db, decision.id, 'approved', 'authorised');
  return decision;
}

function insertPaidRun(
  db: ReturnType<typeof testDb>,
  input: {
    taskId: string;
    providerId: string;
    decisionId: string;
    purpose?: 'implementation' | 'review';
  },
) {
  const id = newId('arun');
  db.insert(agentRuns)
    .values({
      id,
      taskId: input.taskId,
      providerId: input.providerId,
      modelRef: 'opus',
      purpose: input.purpose ?? 'implementation',
      billingMode: 'api_billing',
      routingReason: 'direct boundary probe',
      paidUsageDecisionId: input.decisionId,
    })
    .run();
  return id;
}

describe('activated paid run authorisation', () => {
  it('treats an empty expected decision scope as authorising nothing', () => {
    const { db, project, task } = setup();
    const decision = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'paid_usage',
      question: 'approve a scoped provider run?',
      contextJson: JSON.stringify({
        scope: { provider: 'claude-code', modelRef: 'opus', purpose: 'implementation' },
      }),
    });
    resolveDecision(db, decision.id, 'approved');
    expect(isApprovedDecision(db, decision.id, { category: 'paid_usage', scope: {} })).toBe(false);
  });

  it('refuses a paid run with no decision reference', () => {
    const { db, task, providerId } = setup();
    authorisePaidModel(db, providerId);
    expect(() => createRun(db, paidRunInput(task.id, providerId))).toThrow(RunAuthorisationError);
    expect(db.select().from(agentRuns).all()).toHaveLength(0);
  });

  it('creates a paid run only with authoritative billing and the exact approved scope', () => {
    const { db, project, task, providerId } = setup();
    authorisePaidModel(db, providerId);
    const decision = approvePaidUsage(db, { projectId: project.id, taskId: task.id });
    const run = createRun(db, paidRunInput(task.id, providerId, decision.id));
    expect(run.paidUsageDecisionId).toBe(decision.id);
    expect(
      db.select().from(decisionRequests).where(eq(decisionRequests.id, decision.id)).get()
        ?.consumedByRunId,
    ).toBe(run.id);
  });

  it('refuses replay, expired approval and wrong-purpose scope through createRun', () => {
    const { db, project, task, providerId } = setup();
    authorisePaidModel(db, providerId);

    const exact = approvePaidUsage(db, { projectId: project.id, taskId: task.id });
    createRun(db, paidRunInput(task.id, providerId, exact.id));
    expect(() => createRun(db, paidRunInput(task.id, providerId, exact.id))).toThrow(
      /unconsumed|exactly once/,
    );

    const expired = approvePaidUsage(db, {
      projectId: project.id,
      taskId: task.id,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(() => createRun(db, paidRunInput(task.id, providerId, expired.id))).toThrow(
      RunAuthorisationError,
    );

    const wrongPurpose = approvePaidUsage(db, {
      projectId: project.id,
      taskId: task.id,
      purpose: 'review',
    });
    expect(() => createRun(db, paidRunInput(task.id, providerId, wrongPurpose.id))).toThrow(
      RunAuthorisationError,
    );
  });

  it('requires exact approval for usage credits as well as API billing', () => {
    const { db, task, providerId } = setup();
    db.insert(agentModels)
      .values({
        id: newId('amodel'),
        providerId,
        modelRef: 'opus',
        routingClass: 'opus',
        billingMode: 'unknown',
      })
      .run();
    recordBillingObservation(db, {
      providerName: 'claude-code',
      modelRef: 'opus',
      billingMode: 'usage_credits',
      source: 'human',
      note: 'owner confirmed usage credits',
    });
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        modelRef: 'opus',
        purpose: 'implementation',
        billingMode: 'usage_credits',
        routingReason: 'paid route under test',
      }),
    ).toThrow(RunAuthorisationError);
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
    ).toThrow(/approved.*paid_usage decision/i);
  });
});

describe('paid approval SQLite boundary', () => {
  it('consumes a correctly scoped approval atomically on a direct insert', () => {
    const { db, project, task, providerId } = setup();
    authorisePaidModel(db, providerId);
    const decision = approvePaidUsage(db, { projectId: project.id, taskId: task.id });
    const runId = insertPaidRun(db, { taskId: task.id, providerId, decisionId: decision.id });
    const consumed = db
      .select()
      .from(decisionRequests)
      .where(eq(decisionRequests.id, decision.id))
      .get();
    expect(consumed?.consumedByRunId).toBe(runId);

    expect(() =>
      insertPaidRun(db, { taskId: task.id, providerId, decisionId: decision.id }),
    ).toThrow(/unconsumed|exactly once/);
    expect(db.select().from(agentRuns).all()).toHaveLength(1);
  });

  it('refuses a decision scoped to a different purpose', () => {
    const { db, project, task, providerId } = setup();
    authorisePaidModel(db, providerId);
    const decision = approvePaidUsage(db, {
      projectId: project.id,
      taskId: task.id,
      purpose: 'review',
    });
    expect(() =>
      insertPaidRun(db, { taskId: task.id, providerId, decisionId: decision.id }),
    ).toThrow(/scoped.*purpose/);
  });

  it('refuses an expired approval', () => {
    const { db, project, task, providerId } = setup();
    authorisePaidModel(db, providerId);
    const decision = approvePaidUsage(db, {
      projectId: project.id,
      taskId: task.id,
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(() =>
      insertPaidRun(db, { taskId: task.id, providerId, decisionId: decision.id }),
    ).toThrow(/unexpired/);
  });

  it('refuses a forged consumption stamp that was not produced by its paid run', () => {
    const { db, project, task } = setup();
    const decision = approvePaidUsage(db, { projectId: project.id, taskId: task.id });
    expect(() =>
      db
        .update(decisionRequests)
        .set({ consumedByRunId: newId('arun') })
        .where(eq(decisionRequests.id, decision.id))
        .run(),
    ).toThrow(/immutable/);
  });

  it('cannot convert an authorised free run into a paid run by direct update', () => {
    const { db, project, task, providerId } = setup();
    db.insert(agentModels)
      .values({
        id: newId('amodel'),
        providerId,
        modelRef: 'sonnet',
        routingClass: 'sonnet',
        billingMode: 'unknown',
      })
      .run();
    recordBillingObservation(db, {
      providerName: 'claude-code',
      modelRef: 'sonnet',
      billingMode: 'subscription_included',
      source: 'human',
    });
    const free = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'sonnet',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'free',
    });
    const decision = approvePaidUsage(db, { projectId: project.id, taskId: task.id });
    expect(() =>
      db
        .update(agentRuns)
        .set({ billingMode: 'api_billing', paidUsageDecisionId: decision.id })
        .where(eq(agentRuns.id, free.id))
        .run(),
    ).toThrow(/authority.*immutable/);
  });
});

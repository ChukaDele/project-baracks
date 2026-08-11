import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { agentProviders, agentRuns, taskClaims } from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import { appendRunEvent, createRun, setRunStatus } from '../src/domain/run-service.js';
import { addTask, transitionTask } from '../src/domain/task-service.js';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';
import { ensureObservedModel, seedProject, testDb } from './helpers.js';

/**
 * Worker-owned downstream mutations are an unavailable capability in this
 * build: every fence-carrying or claim-bound write refuses unconditionally,
 * BEFORE any fencing logic runs — comprehensive fencing is deferred to
 * milestone M4 (independent review found the current fencing incomplete).
 * The DB-level fencing triggers on run-linked writes are retained as a
 * backstop and verified here with directly seeded rows.
 */

function runningTask(db: ReturnType<typeof testDb>) {
  const project = seedProject(db);
  const task = addTask(db, { projectId: project.id, title: 'work' });
  transitionTask(db, task.id, 'ready');
  transitionTask(db, task.id, 'queued');
  transitionTask(db, task.id, 'running');
  const providerId = newId('aprov');
  db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();
  ensureObservedModel(db, providerId);
  return { project, task, providerId };
}

function seedClaim(db: ReturnType<typeof testDb>, taskId: string, expired = false) {
  const row = {
    id: newId('tclm'),
    taskId,
    workerId: 'w1',
    attempt: 1,
    status: 'active' as const,
    leaseExpiresAt: new Date(Date.now() + (expired ? -60_000 : 60_000)).toISOString(),
    heartbeatAt: new Date().toISOString(),
  };
  db.insert(taskClaims).values(row).run();
  return row;
}

describe('claim-bound writes are disabled (worker-owned-downstream-mutations)', () => {
  it('createRun refuses any claim-bound run, even under a live claim', () => {
    const db = testDb();
    const { task, providerId } = runningTask(db);
    const claim = seedClaim(db, task.id);
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        claimId: claim.id,
        modelRef: 'sonnet',
        purpose: 'implementation',
        billingMode: 'subscription_included',
        routingReason: 'live claim, still refused',
      }),
    ).toThrow(CapabilityUnavailableError);
    expect(db.select().from(agentRuns).all()).toHaveLength(0);
  });

  it('a fence-carrying task transition refuses before any fencing logic runs', () => {
    const db = testDb();
    const { task } = runningTask(db);
    const claim = seedClaim(db, task.id);
    expect(() =>
      transitionTask(db, task.id, 'verifying', {
        fence: { claimId: claim.id, workerId: 'w1' },
      }),
    ).toThrow(CapabilityUnavailableError);
    // an invalid fence gets the same refusal — the gate fires first
    expect(() =>
      transitionTask(db, task.id, 'verifying', {
        fence: { claimId: 'tclm_forged', workerId: 'intruder' },
      }),
    ).toThrow(CapabilityUnavailableError);
  });

  it('unfenced supervisor transitions remain possible (no worker attribution)', () => {
    const db = testDb();
    const { task } = runningTask(db);
    expect(transitionTask(db, task.id, 'verifying').status).toBe('verifying');
  });
});

describe('DB fencing backstop on run-linked writes (retained for M4)', () => {
  function seededClaimedRun(db: ReturnType<typeof testDb>) {
    const { task, providerId } = runningTask(db);
    const claim = seedClaim(db, task.id);
    const run = {
      id: newId('arun'),
      taskId: task.id,
      providerId,
      claimId: claim.id,
      modelRef: 'sonnet',
      purpose: 'implementation' as const,
      billingMode: 'subscription_included' as const,
      routingReason: 'seeded directly (service path is gated)',
      status: 'pending' as const,
    };
    db.insert(agentRuns).values(run).run();
    return { task, claim, run };
  }

  it('refuses run status changes and run events once the claim lease expired', () => {
    const db = testDb();
    const { claim, run } = seededClaimedRun(db);
    db.update(taskClaims)
      .set({ leaseExpiresAt: new Date(Date.now() - 1000).toISOString() })
      .where(eq(taskClaims.id, claim.id))
      .run();
    expect(() => setRunStatus(db, run.id, 'running')).toThrow();
    expect(() => appendRunEvent(db, run.id, 'result', { ok: true })).toThrow(/live claim/);
  });

  it('permits run-linked writes while the seeded claim is live', () => {
    const db = testDb();
    const { run } = seededClaimedRun(db);
    expect(setRunStatus(db, run.id, 'running').status).toBe('running');
    expect(appendRunEvent(db, run.id, 'note', { ok: true }).duplicate).toBe(false);
  });
});

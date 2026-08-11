import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { taskClaims, tasks } from '../src/db/schema.js';
import {
  claimNextTask,
  completeClaim,
  getClaim,
  heartbeatClaim,
  recoverExpiredClaims,
  releaseClaim,
} from '../src/domain/claim-service.js';
import { newId } from '../src/domain/ids.js';
import { addTask, getTask, transitionTask } from '../src/domain/task-service.js';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';
import { seedProject, testDb } from './helpers.js';

/**
 * Worker-owned downstream mutations are an unavailable capability in this
 * build: nothing can acquire or exercise a work claim. Every worker-facing
 * claim operation refuses unconditionally; only reads and the supervisor-side
 * crash-recovery sweep remain runnable. The claim/lease machinery (unique
 * active claim, immutable attempt history, recovery) is retained at the DB
 * level for milestone M4 and is tested here with directly seeded rows.
 */

function queuedTask(db: ReturnType<typeof testDb>, projectId: string, title = 'work') {
  const task = addTask(db, { projectId, title });
  transitionTask(db, task.id, 'ready');
  transitionTask(db, task.id, 'queued');
  return task;
}

function seedClaim(
  db: ReturnType<typeof testDb>,
  taskId: string,
  overrides: Partial<typeof taskClaims.$inferInsert> = {},
) {
  const row = {
    id: newId('tclm'),
    taskId,
    workerId: 'seeded-worker',
    attempt: 1,
    status: 'active' as const,
    leaseExpiresAt: new Date(Date.now() + 60_000).toISOString(),
    heartbeatAt: new Date().toISOString(),
    ...overrides,
  };
  db.insert(taskClaims).values(row).run();
  return row;
}

function startClaimedTask(
  db: ReturnType<typeof testDb>,
  taskId: string,
  claim: ReturnType<typeof seedClaim>,
) {
  db.update(tasks)
    .set({ status: 'running', mutationClaimId: claim.id, mutationWorkerId: claim.workerId })
    .where(eq(tasks.id, taskId))
    .run();
}

describe('worker claim operations are disabled (worker-owned-downstream-mutations)', () => {
  it('claimNextTask refuses even with a queued task waiting, leaving it untouched', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    expect(() => claimNextTask(db, { workerId: 'w1' })).toThrow(CapabilityUnavailableError);
    expect(getTask(db, task.id).status).toBe('queued');
    expect(db.select().from(taskClaims).all()).toHaveLength(0);
  });

  it('heartbeat, complete and release refuse regardless of arguments', () => {
    const db = testDb();
    expect(() => heartbeatClaim(db, 'tclm_any', 'w1')).toThrow(CapabilityUnavailableError);
    expect(() => completeClaim(db, 'tclm_any', 'w1')).toThrow(CapabilityUnavailableError);
    expect(() =>
      releaseClaim(db, { claimId: 'tclm_any', workerId: 'w1', requeue: true, reason: 'x' }),
    ).toThrow(CapabilityUnavailableError);
  });

  it('a live seeded claim changes nothing: worker operations still refuse', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const claim = seedClaim(db, task.id);
    expect(() => heartbeatClaim(db, claim.id, claim.workerId)).toThrow(CapabilityUnavailableError);
    expect(() => completeClaim(db, claim.id, claim.workerId)).toThrow(CapabilityUnavailableError);
    expect(getClaim(db, claim.id).status).toBe('active');
  });
});

describe('claim model DB backstops (retained for M4)', () => {
  it('the DB refuses a second active claim on the same task outright', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    seedClaim(db, task.id);
    expect(() => seedClaim(db, task.id, { id: 'tclm_forged', workerId: 'w2', attempt: 2 })).toThrow(
      /UNIQUE/i,
    );
  });

  it('attempt history is immutable at the DB level', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const claim = seedClaim(db, task.id);
    expect(() =>
      db.update(taskClaims).set({ workerId: 'rewritten' }).where(eq(taskClaims.id, claim.id)).run(),
    ).toThrow(/immutable/);
    expect(() => db.delete(taskClaims).where(eq(taskClaims.id, claim.id)).run()).toThrow(
      /append-only/,
    );
  });
});

describe('crash recovery (supervisor-side, still runnable)', () => {
  it('expires lapsed leases, requeues tasks, and is idempotent', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const claim = seedClaim(db, task.id, {
      leaseExpiresAt: new Date(Date.now() + 50).toISOString(),
    });
    startClaimedTask(db, task.id, claim);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 75);

    const recovered = recoverExpiredClaims(db);
    expect(recovered).toEqual([{ claimId: claim.id, taskId: task.id }]);
    expect(getTask(db, task.id).status).toBe('queued');
    expect(getClaim(db, claim.id).status).toBe('expired');
    expect(recoverExpiredClaims(db)).toEqual([]); // idempotent
  });

  it('leaves live leases alone', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const claim = seedClaim(db, task.id);
    startClaimedTask(db, task.id, claim);
    expect(recoverExpiredClaims(db)).toEqual([]);
    expect(getClaim(db, claim.id).status).toBe('active');
    expect(getTask(db, task.id).status).toBe('running');
  });
});

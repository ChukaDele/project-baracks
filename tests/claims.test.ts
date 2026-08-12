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
  StaleClaimError,
} from '../src/domain/claim-service.js';
import { newId } from '../src/domain/ids.js';
import { addTask, getTask, transitionTask } from '../src/domain/task-service.js';
import { seedProject, testDb } from './helpers.js';

/** Durable worker claims and their DB-level fencing backstops. */

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

describe('activated worker claim operations', () => {
  it('claims, heartbeats and releases a queued task atomically', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const claimed = claimNextTask(db, { workerId: 'w1' });
    expect(claimed?.task.status).toBe('running');
    expect(heartbeatClaim(db, claimed!.claim.id, 'w1').status).toBe('active');
    const released = releaseClaim(db, {
      claimId: claimed!.claim.id,
      workerId: 'w1',
      requeue: true,
      reason: 'handoff',
    });
    expect(released.claim.status).toBe('released');
    expect(released.task.status).toBe('queued');
    expect(getTask(db, task.id).status).toBe('queued');
  });

  it('heartbeat, complete and release reject a missing or stale claim', () => {
    const db = testDb();
    expect(() => heartbeatClaim(db, 'tclm_any', 'w1')).toThrow(StaleClaimError);
    expect(() => completeClaim(db, 'tclm_any', 'w1')).toThrow(StaleClaimError);
    expect(() =>
      releaseClaim(db, { claimId: 'tclm_any', workerId: 'w1', requeue: true, reason: 'x' }),
    ).toThrow(StaleClaimError);
  });

  it('heartbeats and completes a live seeded claim for its exact worker', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const claim = seedClaim(db, task.id);
    startClaimedTask(db, task.id, claim);
    expect(heartbeatClaim(db, claim.id, claim.workerId).status).toBe('active');
    expect(completeClaim(db, claim.id, claim.workerId).status).toBe('completed');
    expect(getClaim(db, claim.id).status).toBe('completed');
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

import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/client.js';
import { agentProviders, taskClaims } from '../src/db/schema.js';
import {
  claimNextTask,
  getClaim,
  heartbeatClaim,
  completeClaim,
  recoverExpiredClaims,
  releaseClaim,
  StaleClaimError,
} from '../src/domain/claim-service.js';
import { newId } from '../src/domain/ids.js';
import { createRun } from '../src/domain/run-service.js';
import { addTask, transitionTask, getTask } from '../src/domain/task-service.js';
import { seedProject, tempDbPath, testDb } from './helpers.js';

function queuedTask(db: ReturnType<typeof testDb>, projectId: string, title = 'work') {
  const task = addTask(db, { projectId, title });
  transitionTask(db, task.id, 'ready');
  transitionTask(db, task.id, 'queued');
  return task;
}

describe('claiming', () => {
  it('claims the oldest queued task and moves it to running', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const claimed = claimNextTask(db, { workerId: 'w1' });
    expect(claimed?.task.id).toBe(task.id);
    expect(claimed?.task.status).toBe('running');
    expect(claimed?.claim.attempt).toBe(1);
    expect(claimed?.claim.workerId).toBe('w1');
  });

  it('returns undefined when nothing is queued', () => {
    const db = testDb();
    seedProject(db);
    expect(claimNextTask(db, { workerId: 'w1' })).toBeUndefined();
  });

  it('two workers on separate file-backed connections never claim the same task', () => {
    const path = tempDbPath();
    const a = openDb(path).db;
    const b = openDb(path).db;
    const project = seedProject(a);
    queuedTask(a, project.id, 'one');
    queuedTask(a, project.id, 'two');

    const first = claimNextTask(a, { workerId: 'worker-a' });
    const second = claimNextTask(b, { workerId: 'worker-b' });
    const third = claimNextTask(b, { workerId: 'worker-b' });

    expect(first).toBeDefined();
    expect(second).toBeDefined();
    expect(first!.task.id).not.toBe(second!.task.id);
    expect(third).toBeUndefined(); // queue drained
  });

  it('the DB refuses a second active claim on the same task outright', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const claimed = claimNextTask(db, { workerId: 'w1' })!;
    expect(() =>
      db
        .insert(taskClaims)
        .values({
          id: 'tclm_forged',
          taskId: task.id,
          workerId: 'w2',
          attempt: claimed.claim.attempt + 1,
          status: 'active',
          leaseExpiresAt: new Date(Date.now() + 60000).toISOString(),
          heartbeatAt: new Date().toISOString(),
        })
        .run(),
    ).toThrow(/UNIQUE/i);
  });
});

describe('leases, heartbeat, cancellation', () => {
  it('heartbeat extends the lease; a stale worker is refused', () => {
    const db = testDb();
    const project = seedProject(db);
    queuedTask(db, project.id);
    const { claim } = claimNextTask(db, { workerId: 'w1' })!;
    const extended = heartbeatClaim(db, claim.id, 'w1', 10 * 60_000);
    expect(extended.leaseExpiresAt > claim.leaseExpiresAt).toBe(true);
    expect(() => heartbeatClaim(db, claim.id, 'intruder')).toThrow(StaleClaimError);
  });

  it('explicit release requeues (handback) or cancels the task', () => {
    const db = testDb();
    const project = seedProject(db);
    queuedTask(db, project.id, 'handback');
    const first = claimNextTask(db, { workerId: 'w1' })!;
    const released = releaseClaim(db, {
      claimId: first.claim.id,
      workerId: 'w1',
      requeue: true,
      reason: 'shutting down',
    });
    expect(released.claim.status).toBe('released');
    expect(released.task.status).toBe('queued');

    const second = claimNextTask(db, { workerId: 'w2' })!;
    expect(second.claim.attempt).toBe(2);
    const cancelled = releaseClaim(db, {
      claimId: second.claim.id,
      workerId: 'w2',
      requeue: false,
      reason: 'human cancelled',
    });
    expect(cancelled.task.status).toBe('cancelled');
  });

  it('completeClaim closes the claim without touching the task status', () => {
    const db = testDb();
    const project = seedProject(db);
    queuedTask(db, project.id);
    const { claim, task } = claimNextTask(db, { workerId: 'w1' })!;
    transitionTask(db, task.id, 'verifying');
    const closed = completeClaim(db, claim.id, 'w1');
    expect(closed.status).toBe('completed');
    expect(getTask(db, task.id).status).toBe('verifying');
  });
});

describe('lease fencing', () => {
  const claimAt = (offsetMs: number) => () => new Date(Date.now() + offsetMs);

  it('fences a stale worker out of heartbeat the moment its lease expires', () => {
    const db = testDb();
    const project = seedProject(db);
    queuedTask(db, project.id);
    // lease of 30s taken 60s in the past: expired, but NOT yet recovered
    const { claim } = claimNextTask(db, {
      workerId: 'stalled',
      now: claimAt(-60_000),
      leaseMs: 30_000,
    })!;
    expect(getClaim(db, claim.id).status).toBe('active');
    expect(() => heartbeatClaim(db, claim.id, 'stalled')).toThrow(StaleClaimError);
  });

  it('fences a stale worker out of completion and release before any recovery sweep', () => {
    const db = testDb();
    const project = seedProject(db);
    queuedTask(db, project.id);
    const { claim } = claimNextTask(db, {
      workerId: 'stalled',
      now: claimAt(-60_000),
      leaseMs: 30_000,
    })!;
    expect(() => completeClaim(db, claim.id, 'stalled')).toThrow(StaleClaimError);
    expect(() =>
      releaseClaim(db, { claimId: claim.id, workerId: 'stalled', requeue: true, reason: 'late' }),
    ).toThrow(StaleClaimError);
    // the claim row itself is untouched: recovery still owns the transition
    expect(getClaim(db, claim.id).status).toBe('active');
  });

  it('run creation is fenced by the claim token: expired or foreign claims are refused', () => {
    const db = testDb();
    const project = seedProject(db);
    const taskA = queuedTask(db, project.id, 'A');
    const taskB = queuedTask(db, project.id, 'B');
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();

    const expired = claimNextTask(db, {
      workerId: 'w-old',
      now: claimAt(-60_000),
      leaseMs: 30_000,
    })!;
    expect(() =>
      createRun(db, {
        taskId: expired.task.id,
        providerId,
        claimId: expired.claim.id,
        modelRef: 'sonnet',
        purpose: 'implementation',
        billingMode: 'subscription_included',
        routingReason: 'stale claim',
      }),
    ).toThrow(StaleClaimError);

    const live = claimNextTask(db, { workerId: 'w-live' })!;
    const otherTask = live.task.id === taskA.id ? taskB : taskA;
    // a live claim cannot authorise a run on a DIFFERENT task
    expect(() =>
      createRun(db, {
        taskId: otherTask.id,
        providerId,
        claimId: live.claim.id,
        modelRef: 'sonnet',
        purpose: 'implementation',
        billingMode: 'subscription_included',
        routingReason: 'cross-task claim',
      }),
    ).toThrow(StaleClaimError);

    const run = createRun(db, {
      taskId: live.task.id,
      providerId,
      claimId: live.claim.id,
      modelRef: 'sonnet',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'valid claim',
    });
    expect(run.claimId).toBe(live.claim.id);
  });

  it('a duplicate worker holding a recovered claim id cannot write over the new attempt', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const first = claimNextTask(db, { workerId: 'w-dup', now: claimAt(-60_000), leaseMs: 30_000 })!;
    recoverExpiredClaims(db);
    const second = claimNextTask(db, { workerId: 'w-new' })!;
    expect(second.task.id).toBe(task.id);
    expect(second.claim.attempt).toBe(first.claim.attempt + 1);

    // the zombie worker's token (old claim id / attempt) no longer writes
    expect(() => heartbeatClaim(db, first.claim.id, 'w-dup')).toThrow(StaleClaimError);
    expect(() => completeClaim(db, first.claim.id, 'w-dup')).toThrow(StaleClaimError);
    // and it cannot masquerade as the new attempt either
    expect(() => heartbeatClaim(db, second.claim.id, 'w-dup')).toThrow(StaleClaimError);
    // the legitimate holder still works
    expect(heartbeatClaim(db, second.claim.id, 'w-new').status).toBe('active');
  });
});

describe('crash recovery', () => {
  it('expires lapsed leases, requeues tasks, and is idempotent', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = queuedTask(db, project.id);
    const past = () => new Date(Date.now() - 10 * 60_000);
    const { claim } = claimNextTask(db, { workerId: 'crashed-worker', now: past })!;

    const recovered = recoverExpiredClaims(db);
    expect(recovered).toEqual([{ claimId: claim.id, taskId: task.id }]);
    expect(getTask(db, task.id).status).toBe('queued');
    expect(recoverExpiredClaims(db)).toEqual([]); // idempotent

    // the crashed worker's heartbeat is now refused
    expect(() => heartbeatClaim(db, claim.id, 'crashed-worker')).toThrow(StaleClaimError);

    // a new worker picks the task up as a fresh attempt
    const retaken = claimNextTask(db, { workerId: 'fresh-worker' })!;
    expect(retaken.task.id).toBe(task.id);
    expect(retaken.claim.attempt).toBe(2);
  });

  it('recovery works across a process restart (new connection on the same file)', () => {
    const path = tempDbPath();
    const before = openDb(path).db;
    const project = seedProject(before);
    const task = queuedTask(before, project.id);
    const past = () => new Date(Date.now() - 60_000);
    claimNextTask(before, { workerId: 'w-dead', now: past, leaseMs: 30_000 });

    // simulate restart: fresh connection
    const after = openDb(path).db;
    const recovered = recoverExpiredClaims(after);
    expect(recovered).toHaveLength(1);
    expect(getTask(after, task.id).status).toBe('queued');
  });

  it('attempt history is immutable', () => {
    const db = testDb();
    const project = seedProject(db);
    queuedTask(db, project.id);
    const { claim } = claimNextTask(db, { workerId: 'w1' })!;
    expect(() =>
      db.update(taskClaims).set({ workerId: 'rewritten' }).where(eq(taskClaims.id, claim.id)).run(),
    ).toThrow(/immutable/);
    expect(() => db.delete(taskClaims).where(eq(taskClaims.id, claim.id)).run()).toThrow(
      /append-only/,
    );
    completeClaim(db, claim.id, 'w1');
    expect(() =>
      db.update(taskClaims).set({ status: 'active' }).where(eq(taskClaims.id, claim.id)).run(),
    ).toThrow(/terminal/);
  });
});

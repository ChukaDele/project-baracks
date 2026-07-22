import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../src/db/client.js';
import { agentProviders, taskClaims } from '../src/db/schema.js';
import {
  claimNextTask,
  recoverExpiredClaims,
  StaleClaimError,
} from '../src/domain/claim-service.js';
import { newId } from '../src/domain/ids.js';
import {
  appendRunEvent,
  createRun,
  recordUsage,
  recordVerificationRun,
  setRunStatus,
} from '../src/domain/run-service.js';
import { addTask, transitionTask } from '../src/domain/task-service.js';
import { seedProject } from './helpers.js';

/**
 * P1-4 reproducers: an expired claimant must be fenced out of EVERY downstream
 * owner mutation — run status changes, run events, usage, verification runs and
 * worker-driven task transitions — the instant its lease lapses, before any
 * recovery sweep. Fencing is DB-enforced (run-linked writes) and validated in
 * the transition transaction (task state).
 */

function expireLease(db: Db, claimId: string) {
  db.update(taskClaims)
    .set({ leaseExpiresAt: new Date(Date.now() - 1000).toISOString() })
    .where(eq(taskClaims.id, claimId))
    .run();
}

function claimedRun(db: Db) {
  const project = seedProject(db);
  const task = addTask(db, { projectId: project.id, title: 'work' });
  transitionTask(db, task.id, 'ready');
  transitionTask(db, task.id, 'queued');
  const providerId = newId('aprov');
  db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();
  const claimed = claimNextTask(db, { workerId: 'w1' })!;
  const run = createRun(db, {
    taskId: claimed.task.id,
    providerId,
    claimId: claimed.claim.id,
    modelRef: 'sonnet',
    purpose: 'implementation',
    billingMode: 'subscription_included',
    routingReason: 'live',
  });
  setRunStatus(db, run.id, 'running'); // succeeds while the lease is live
  return { db, providerId, task: claimed.task, claim: claimed.claim, run };
}

describe('P1-4 expired claimants are fenced from downstream writes', () => {
  it('cannot mark its run succeeded once the lease expired', () => {
    const { db, claim, run } = claimedRun(openDb(':memory:').db);
    expireLease(db, claim.id);
    expect(() => setRunStatus(db, run.id, 'succeeded')).toThrow();
  });

  it('cannot append a run event once the lease expired', () => {
    const { db, claim, run } = claimedRun(openDb(':memory:').db);
    expireLease(db, claim.id);
    expect(() => appendRunEvent(db, run.id, 'result', { ok: true })).toThrow(/live claim/);
  });

  it('cannot record usage or a verification run once the lease expired', () => {
    const { db, providerId, claim, run } = claimedRun(openDb(':memory:').db);
    expireLease(db, claim.id);
    expect(() =>
      recordUsage(db, { providerId, agentRunId: run.id, kind: 'tokens', data: { n: 1 } }),
    ).toThrow(/live claim/);
    expect(() =>
      recordVerificationRun(db, {
        taskId: run.taskId,
        command: 'pnpm test',
        status: 'passed',
        exitCode: 0,
        agentRunId: run.id,
      }),
    ).toThrow(/live claim/);
  });

  it('cannot advance the task it holds once the lease expired', () => {
    const { db, task, claim } = claimedRun(openDb(':memory:').db);
    expireLease(db, claim.id);
    expect(() =>
      transitionTask(db, task.id, 'verifying', {
        fence: { claimId: claim.id, workerId: 'w1' },
      }),
    ).toThrow(StaleClaimError);
  });

  it('a live claimant still performs all of these', () => {
    const { db, providerId, task, claim, run } = claimedRun(openDb(':memory:').db);
    expect(setRunStatus(db, run.id, 'succeeded').status).toBe('succeeded');
    // re-open a run for the remaining writes (a succeeded run is terminal in intent)
    appendRunEvent(db, run.id, 'note', { ok: true });
    recordUsage(db, { providerId, agentRunId: run.id, kind: 'tokens', data: { n: 1 } });
    const moved = transitionTask(db, task.id, 'verifying', {
      fence: { claimId: claim.id, workerId: 'w1' },
    });
    expect(moved.status).toBe('verifying');
  });
});

describe('P1-4 recovery issues a strictly newer token; old workers cannot write', () => {
  it('after recovery the zombie run write is fenced and a new attempt owns the task', () => {
    const { db, claim, run } = claimedRun(openDb(':memory:').db);
    expireLease(db, claim.id);

    const recovered = recoverExpiredClaims(db);
    expect(recovered).toHaveLength(1);

    // the new attempt is strictly newer
    const next = claimNextTask(db, { workerId: 'w2' })!;
    expect(next.claim.attempt).toBe(claim.attempt + 1);

    // the zombie worker's run can no longer be advanced
    expect(() => setRunStatus(db, run.id, 'succeeded')).toThrow();
  });
});

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import {
  agentProviders,
  agentRunEvents,
  agentRuns,
  evidence,
  reviewFindings,
  roadmapItems,
  roadmapUpdates,
  taskClaims,
  tasks,
  usageObservations,
  verificationRuns,
} from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import { StaleClaimError } from '../src/domain/claim-service.js';
import { appendRunEvent, createRun, setRunStatus } from '../src/domain/run-service.js';
import { addTask, transitionTask } from '../src/domain/task-service.js';
import { ensureObservedModel, seedProject, testDb } from './helpers.js';

/** Worker-owned downstream writes must carry the exact live claim fence. */

function runningTask(db: ReturnType<typeof testDb>) {
  const project = seedProject(db);
  const roadmapItemId = newId('ritem');
  db.insert(roadmapItems)
    .values({ id: roadmapItemId, projectId: project.id, stableRef: roadmapItemId, title: 'work' })
    .run();
  const task = addTask(db, { projectId: project.id, roadmapItemId, title: 'work' });
  transitionTask(db, task.id, 'ready');
  transitionTask(db, task.id, 'queued');
  const providerId = newId('aprov');
  db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();
  ensureObservedModel(db, providerId);
  return { project, roadmapItemId, task, providerId };
}

function seedClaim(db: ReturnType<typeof testDb>, taskId: string, leaseMs = 60_000) {
  const row = {
    id: newId('tclm'),
    taskId,
    workerId: 'w1',
    attempt: 1,
    status: 'active' as const,
    leaseExpiresAt: new Date(Date.now() + leaseMs).toISOString(),
    heartbeatAt: new Date().toISOString(),
  };
  db.insert(taskClaims).values(row).run();
  return row;
}

describe('activated claim-bound writes', () => {
  it('creates a claim-bound run only under the exact live worker fence', () => {
    const db = testDb();
    const { task, providerId } = runningTask(db);
    const claim = seedClaim(db, task.id);
    db.update(tasks)
      .set({ status: 'running', mutationClaimId: claim.id, mutationWorkerId: claim.workerId })
      .where(eq(tasks.id, task.id))
      .run();
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        claimId: claim.id,
        claimWorkerId: claim.workerId,
        modelRef: 'sonnet',
        purpose: 'implementation',
        billingMode: 'subscription_included',
        routingReason: 'live fenced claim',
      }),
    ).not.toThrow();
    expect(db.select().from(agentRuns).all()).toHaveLength(1);
  });

  it('accepts the exact fence and rejects a forged fence', () => {
    const db = testDb();
    const { task } = runningTask(db);
    const claim = seedClaim(db, task.id);
    db.update(tasks)
      .set({ status: 'running', mutationClaimId: claim.id, mutationWorkerId: claim.workerId })
      .where(eq(tasks.id, task.id))
      .run();
    expect(() =>
      transitionTask(db, task.id, 'verifying', {
        fence: { claimId: 'tclm_forged', workerId: 'intruder' },
      }),
    ).toThrow(StaleClaimError);
    expect(
      transitionTask(db, task.id, 'verifying', {
        fence: { claimId: claim.id, workerId: claim.workerId },
      }),
    ).toMatchObject({ status: 'verifying', mutationClaimId: claim.id });
  });

  it('rejects service writes after the exact claim lease expires', () => {
    const db = testDb();
    const { task, providerId } = runningTask(db);
    const claim = seedClaim(db, task.id, 60_000);
    db.update(tasks)
      .set({ status: 'running', mutationClaimId: claim.id, mutationWorkerId: claim.workerId })
      .where(eq(tasks.id, task.id))
      .run();

    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        claimId: claim.id,
        claimWorkerId: claim.workerId,
        modelRef: 'sonnet',
        purpose: 'implementation',
        billingMode: 'subscription_included',
        routingReason: 'expired fence',
        now: () => new Date(Date.now() + 120_000),
      }),
    ).toThrow(StaleClaimError);
    expect(() =>
      transitionTask(db, task.id, 'verifying', {
        fence: {
          claimId: claim.id,
          workerId: claim.workerId,
          now: () => new Date(Date.now() + 120_000),
        },
      }),
    ).toThrow(StaleClaimError);
  });

  it('unfenced supervisor transitions remain possible only before a worker claim exists', () => {
    const db = testDb();
    const { task } = runningTask(db);
    expect(transitionTask(db, task.id, 'running').status).toBe('running');
    expect(transitionTask(db, task.id, 'verifying').status).toBe('verifying');
  });
});

describe('DB fencing backstop on run-linked writes (retained for M4)', () => {
  function seededClaimedRun(db: ReturnType<typeof testDb>, leaseMs = 60_000) {
    const { task, providerId, roadmapItemId } = runningTask(db);
    const claim = seedClaim(db, task.id, leaseMs);
    db.update(tasks)
      .set({ status: 'running', mutationClaimId: claim.id, mutationWorkerId: claim.workerId })
      .where(eq(tasks.id, task.id))
      .run();
    const run = {
      id: newId('arun'),
      taskId: task.id,
      providerId,
      claimId: claim.id,
      claimWorkerId: claim.workerId,
      modelRef: 'sonnet',
      purpose: 'implementation' as const,
      billingMode: 'subscription_included' as const,
      routingReason: 'seeded directly (service path is gated)',
      status: 'pending' as const,
    };
    db.insert(agentRuns).values(run).run();
    return { task, claim, run, providerId, roadmapItemId };
  }

  it('enforces queued acquisition, monotonic attempts and no expired-lease revival', () => {
    const db = testDb();
    const { task } = runningTask(db);
    const now = new Date();
    expect(() =>
      db
        .insert(taskClaims)
        .values({
          id: newId('tclm'),
          taskId: task.id,
          workerId: 'w1',
          attempt: 2,
          status: 'active',
          leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
          heartbeatAt: now.toISOString(),
        })
        .run(),
    ).toThrow(/next monotonic/);
    const expired = seedClaim(db, task.id, -60_000);
    expect(() =>
      db
        .update(taskClaims)
        .set({
          heartbeatAt: new Date(now.getTime() + 1_000).toISOString(),
          leaseExpiresAt: new Date(now.getTime() + 60_000).toISOString(),
        })
        .where(eq(taskClaims.id, expired.id))
        .run(),
    ).toThrow(/live lease/);
  });

  it('refuses run status changes and run events once the claim lease expired', () => {
    const db = testDb();
    // 500ms lease / 550ms wait matches the margin already used below for the
    // same kind of assertion (line ~369): under full-suite load, this
    // helper's own setup writes can themselves take tens of ms, so a lease
    // much shorter than that (e.g. 50ms/75ms) can appear already expired
    // before the test's own deliberate wait even runs.
    const { claim, run } = seededClaimedRun(db, 500);
    expect(() =>
      db
        .update(taskClaims)
        .set({ status: 'expired', outcomeReason: 'premature recovery' })
        .where(eq(taskClaims.id, claim.id))
        .run(),
    ).toThrow(/cannot expire a live task claim/);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 550);
    db.update(taskClaims)
      .set({ status: 'expired', outcomeReason: 'simulated recovery' })
      .where(eq(taskClaims.id, claim.id))
      .run();
    expect(() => setRunStatus(db, run.id, 'running')).toThrow();
    expect(() => appendRunEvent(db, run.id, 'result', { ok: true })).toThrow(/current task fence/);
  });

  it('permits run-linked writes while the seeded claim is live', () => {
    const db = testDb();
    const { run } = seededClaimedRun(db);
    expect(setRunStatus(db, run.id, 'running').status).toBe('running');
    expect(appendRunEvent(db, run.id, 'note', { ok: true }).duplicate).toBe(false);
  });

  it('requires the exact fence on task transitions and rejects a cross-task run', () => {
    const db = testDb();
    const { task, claim, run, providerId } = seededClaimedRun(db);
    expect(() =>
      db
        .update(tasks)
        .set({ status: 'verifying', mutationClaimId: null, mutationWorkerId: null })
        .where(eq(tasks.id, task.id))
        .run(),
    ).toThrow(/current unexpired task fence/);
    db.update(tasks)
      .set({
        status: 'verifying',
        mutationClaimId: claim.id,
        mutationWorkerId: claim.workerId,
      })
      .where(eq(tasks.id, task.id))
      .run();

    const other = addTask(db, { projectId: task.projectId, title: 'other' });
    transitionTask(db, other.id, 'ready');
    transitionTask(db, other.id, 'queued');
    expect(() =>
      db
        .insert(agentRuns)
        .values({
          ...run,
          id: newId('arun'),
          taskId: other.id,
          providerId,
        })
        .run(),
    ).toThrow(/current task fence/);
  });

  it('requires a live claim-bound run across every downstream write surface', () => {
    const db = testDb();
    const { task, claim, run, providerId, roadmapItemId } = seededClaimedRun(db, 500);

    expect(() =>
      db
        .insert(verificationRuns)
        .values({
          id: newId('vrun'),
          taskId: task.id,
          command: 'test',
          status: 'pending',
        })
        .run(),
    ).toThrow(/current task fence/);
    const verificationId = newId('vrun');
    db.insert(verificationRuns)
      .values({
        id: verificationId,
        taskId: task.id,
        agentRunId: run.id,
        command: 'test',
        status: 'pending',
      })
      .run();

    expect(() =>
      db
        .insert(evidence)
        .values({
          id: newId('evid'),
          taskId: task.id,
          kind: 'other',
          summary: 'missing worker provenance',
        })
        .run(),
    ).toThrow(/current task fence/);
    db.insert(evidence)
      .values({
        id: newId('evid'),
        taskId: task.id,
        agentRunId: run.id,
        kind: 'other',
        summary: 'fenced evidence',
      })
      .run();

    expect(() =>
      db
        .insert(reviewFindings)
        .values({
          id: newId('rfind'),
          taskId: task.id,
          severity: 'major',
          summary: 'missing worker provenance',
        })
        .run(),
    ).toThrow(/current task fence/);
    const findingId = newId('rfind');
    db.insert(reviewFindings)
      .values({
        id: findingId,
        taskId: task.id,
        agentRunId: run.id,
        severity: 'major',
        summary: 'fenced finding',
      })
      .run();
    expect(() =>
      db
        .update(reviewFindings)
        .set({ status: 'fixed' })
        .where(eq(reviewFindings.id, findingId))
        .run(),
    ).toThrow(/current task fence/);
    db.update(reviewFindings)
      .set({ status: 'fixed', resolutionRunId: run.id })
      .where(eq(reviewFindings.id, findingId))
      .run();

    expect(() =>
      db
        .insert(roadmapUpdates)
        .values({
          id: newId('rupd'),
          roadmapItemId,
          idempotencyKey: newId('rupd'),
          payloadHash: 'hash',
          changesJson: '[]',
          rationale: 'missing worker provenance',
        })
        .run(),
    ).toThrow(/current task fence/);
    db.insert(roadmapUpdates)
      .values({
        id: newId('rupd'),
        roadmapItemId,
        proposedByRunId: run.id,
        idempotencyKey: newId('rupd'),
        payloadHash: 'hash',
        changesJson: '[]',
        rationale: 'fenced proposal',
      })
      .run();

    db.insert(usageObservations)
      .values({
        id: newId('usage'),
        providerId,
        agentRunId: run.id,
        kind: 'tokens',
        dataJson: '{}',
      })
      .run();

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 550);
    db.update(taskClaims)
      .set({ status: 'expired', outcomeReason: 'simulated recovery' })
      .where(eq(taskClaims.id, claim.id))
      .run();
    expect(() =>
      db
        .insert(agentRunEvents)
        .values({
          id: newId('aevt'),
          runId: run.id,
          seq: 1,
          type: 'late',
          payloadHash: 'hash',
          payloadJson: '{}',
        })
        .run(),
    ).toThrow(/current task fence/);
    expect(() =>
      db
        .insert(usageObservations)
        .values({
          id: newId('usage'),
          providerId,
          agentRunId: run.id,
          kind: 'tokens',
          dataJson: '{}',
        })
        .run(),
    ).toThrow(/current task fence/);
    expect(() =>
      db
        .insert(verificationRuns)
        .values({
          id: newId('vrun'),
          taskId: task.id,
          agentRunId: run.id,
          command: 'late test',
          status: 'pending',
        })
        .run(),
    ).toThrow(/current task fence/);
    expect(() =>
      db
        .insert(evidence)
        .values({
          id: newId('evid'),
          taskId: task.id,
          agentRunId: run.id,
          kind: 'other',
          summary: 'late evidence',
        })
        .run(),
    ).toThrow(/current task fence/);
    expect(() =>
      db
        .insert(reviewFindings)
        .values({
          id: newId('rfind'),
          taskId: task.id,
          agentRunId: run.id,
          severity: 'major',
          summary: 'late finding',
        })
        .run(),
    ).toThrow(/current task fence/);
    expect(() =>
      db
        .insert(roadmapUpdates)
        .values({
          id: newId('rupd'),
          roadmapItemId,
          proposedByRunId: run.id,
          idempotencyKey: newId('rupd'),
          payloadHash: 'late',
          changesJson: '[]',
          rationale: 'late proposal',
        })
        .run(),
    ).toThrow(/current task fence/);
  });
});

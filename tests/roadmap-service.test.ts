import { describe, expect, it } from 'vitest';
import { roadmapItems } from '../src/db/schema.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { recordVerificationRun } from '../src/domain/run-service.js';
import { addEvidence, addTask } from '../src/domain/task-service.js';
import {
  idempotencyKeyMatchesPayload,
  proposalIdempotencyKey,
  proposalPayloadHash,
} from '../src/roadmap/canonical.js';
import { MockSheetsAdapter } from '../src/roadmap/mock-sheets.js';
import {
  applyRoadmapUpdate,
  proposeRoadmapUpdate,
  reconcileRoadmapApplies,
} from '../src/roadmap/proposal-service.js';
import type { RoadmapAdapter } from '../src/roadmap/types.js';
import { seedProject, testDb } from './helpers.js';

function setup() {
  const db = testDb();
  const project = seedProject(db);
  const itemId = newId('ritem');
  db.insert(roadmapItems)
    .values({ id: itemId, projectId: project.id, stableRef: 'RM-1', title: 'Auth' })
    .run();
  const task = addTask(db, { projectId: project.id, roadmapItemId: itemId, title: 'login' });
  const vrun = recordVerificationRun(db, {
    taskId: task.id,
    command: 'pnpm test',
    status: 'passed',
    exitCode: 0,
  });
  const proof = addEvidence(db, {
    taskId: task.id,
    kind: 'verification_run',
    ref: vrun.id,
    summary: 'green',
  });
  const adapter = new MockSheetsAdapter([
    { stableId: 'RM-1', values: { Title: 'Auth', Status: 'In Progress' } },
  ]);
  return { db, project, itemId, task, proof, adapter };
}

const CHANGES = [{ stableId: 'RM-1', columns: { Status: 'Done' } }];

describe('canonical payload identity', () => {
  it('hashes identical payloads identically regardless of key order', () => {
    const a = proposalPayloadHash({ changes: [{ stableId: 'x', columns: { A: '1', B: '2' } }] });
    const b = proposalPayloadHash({ changes: [{ columns: { B: '2', A: '1' }, stableId: 'x' }] });
    expect(a).toBe(b);
  });

  it('binds idempotency keys to the payload', () => {
    const key = proposalIdempotencyKey('rm1-done', { changes: CHANGES });
    expect(idempotencyKeyMatchesPayload(key, { changes: CHANGES })).toBe(true);
    expect(
      idempotencyKeyMatchesPayload(key, {
        changes: [{ stableId: 'RM-1', columns: { Status: 'Todo' } }],
      }),
    ).toBe(false);
  });
});

describe('proposal lifecycle', () => {
  it('records the dry run, payload hash and source revision at propose time', async () => {
    const { db, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'task verified',
      evidenceIds: [proof.id],
    });
    expect(update.status).toBe('proposed');
    expect(update.payloadHash).toBe(proposalPayloadHash({ changes: CHANGES }));
    expect(update.sourceRevision).toBe('rev-0');
    expect(update.dryRunDiff).toBeTruthy();
    expect(update.dryRunAt).toBeTruthy();
    expect(update.idempotencyKey).toContain('#');
  });

  it('refuses Done proposals whose evidence does not belong to the roadmap item', async () => {
    const { db, project, itemId, adapter } = setup();
    const unrelatedTask = addTask(db, { projectId: project.id, title: 'unrelated' });
    const unrelatedVrun = recordVerificationRun(db, {
      taskId: unrelatedTask.id,
      command: 'pnpm test',
      status: 'passed',
      exitCode: 0,
    });
    const unrelatedEvidence = addEvidence(db, {
      taskId: unrelatedTask.id,
      kind: 'verification_run',
      ref: unrelatedVrun.id,
      summary: 'green but unrelated',
    });
    await expect(
      proposeRoadmapUpdate(db, adapter, {
        roadmapItemId: itemId,
        baseKey: 'rm1-done',
        changes: CHANGES,
        rationale: 'trust me',
        evidenceIds: [unrelatedEvidence.id],
      }),
    ).rejects.toThrow(/does not belong to a task of roadmap item/);
    await expect(
      proposeRoadmapUpdate(db, adapter, {
        roadmapItemId: itemId,
        baseKey: 'rm1-done',
        changes: CHANGES,
        rationale: 'no evidence at all',
      }),
    ).rejects.toThrow(/requires at least one evidence/);
  });

  it('applies only with an approved roadmap_done decision, exactly once', async () => {
    const { db, project, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'task verified',
      evidenceIds: [proof.id],
    });

    await expect(applyRoadmapUpdate(db, adapter, update.id)).rejects.toThrow(/roadmap_done/);

    const decision = createDecisionRequest(db, {
      projectId: project.id,
      category: 'roadmap_done',
      question: 'mark RM-1 Done?',
    });
    await expect(
      applyRoadmapUpdate(db, adapter, update.id, { roadmapDoneDecisionId: decision.id }),
    ).rejects.toThrow(/roadmap_done/); // open, not approved

    resolveDecision(db, decision.id, 'approved', 'confirmed');
    const applied = await applyRoadmapUpdate(db, adapter, update.id, {
      roadmapDoneDecisionId: decision.id,
    });
    expect(applied.status).toBe('applied');
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('Done');

    const again = await applyRoadmapUpdate(db, adapter, update.id, {
      roadmapDoneDecisionId: decision.id,
    });
    expect(again.status).toBe('already_applied');
  });

  it('invalidates the proposal when the source changed since the dry run', async () => {
    const { db, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'task verified',
      evidenceIds: [proof.id],
    });
    adapter.setCell('RM-1', 'Status', 'Blocked'); // human edited the sheet
    const result = await applyRoadmapUpdate(db, adapter, update.id, {
      roadmapDoneDecisionId: 'irrelevant',
    });
    expect(result.status).toBe('superseded');
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('Blocked');
  });

  it('reconciles an already-applied external write instead of superseding it', async () => {
    const { db, project, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'task verified',
      evidenceIds: [proof.id],
    });
    const decision = createDecisionRequest(db, {
      projectId: project.id,
      category: 'roadmap_done',
      question: 'mark RM-1 Done?',
    });
    resolveDecision(db, decision.id, 'approved', 'confirmed');

    // The external write already happened under this idempotency key (a
    // previous process applied it and crashed before internal bookkeeping);
    // the source revision has therefore CHANGED since the dry run.
    await adapter.apply(
      {
        idempotencyKey: update.idempotencyKey,
        changes: CHANGES,
        rationale: update.rationale,
        evidenceRefs: [proof.id],
      },
      {},
    );
    expect(await adapter.revision()).not.toBe(update.sourceRevision);

    // Retry must reconcile via the idempotency key, not misclassify as superseded.
    const result = await applyRoadmapUpdate(db, adapter, update.id, {
      roadmapDoneDecisionId: decision.id,
    });
    expect(result.status).toBe('applied');
    expect(result.update.status).toBe('applied');
    expect(result.update.appliedAt).toBeTruthy();
  });

  it('recovers a crash between the external write and internal bookkeeping', async () => {
    const { db, project, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'task verified',
      evidenceIds: [proof.id],
    });
    const decision = createDecisionRequest(db, {
      projectId: project.id,
      category: 'roadmap_done',
      question: 'mark RM-1 Done?',
    });
    resolveDecision(db, decision.id, 'approved', 'confirmed');

    // Adapter whose process "crashes" right after the external write lands.
    const crashing: RoadmapAdapter = {
      readRow: (id) => adapter.readRow(id),
      readAll: () => adapter.readAll(),
      revision: () => adapter.revision(),
      dryRun: (p) => adapter.dryRun(p),
      wasApplied: (k) => adapter.wasApplied(k),
      apply: async (p, o) => {
        await adapter.apply(p, o);
        throw new Error('simulated crash after external write');
      },
    };
    await expect(
      applyRoadmapUpdate(db, crashing, update.id, { roadmapDoneDecisionId: decision.id }),
    ).rejects.toThrow(/simulated crash/);

    // Durable crash evidence: the update is stuck in 'applying' with an attempt id.
    const stuck = (await import('../src/db/schema.js')).roadmapUpdates;
    const { eq } = await import('drizzle-orm');
    const row = db.select().from(stuck).where(eq(stuck.id, update.id)).get()!;
    expect(row.status).toBe('applying');
    expect(row.applyAttemptId).toBeTruthy();

    // A concurrent apply attempt is refused while the claim is held.
    await expect(
      applyRoadmapUpdate(db, adapter, update.id, { roadmapDoneDecisionId: decision.id }),
    ).rejects.toThrow(/apply in progress/);

    // Recovery reconciles against the adapter's idempotency record.
    const resolved = await reconcileRoadmapApplies(db, adapter);
    expect(resolved).toEqual([{ updateId: update.id, outcome: 'applied' }]);
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('Done');

    // and a re-run finds nothing left to do
    expect(await reconcileRoadmapApplies(db, adapter)).toEqual([]);
  });

  it('requeues a claimed apply whose external write never happened', async () => {
    const { db, project, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'task verified',
      evidenceIds: [proof.id],
    });
    const decision = createDecisionRequest(db, {
      projectId: project.id,
      category: 'roadmap_done',
      question: 'mark RM-1 Done?',
    });
    resolveDecision(db, decision.id, 'approved', 'confirmed');

    // Crash BEFORE the external write reached the source.
    const crashingEarly: RoadmapAdapter = {
      readRow: (id) => adapter.readRow(id),
      readAll: () => adapter.readAll(),
      revision: () => adapter.revision(),
      dryRun: (p) => adapter.dryRun(p),
      wasApplied: (k) => adapter.wasApplied(k),
      apply: async () => {
        throw new Error('simulated crash before external write');
      },
    };
    await expect(
      applyRoadmapUpdate(db, crashingEarly, update.id, { roadmapDoneDecisionId: decision.id }),
    ).rejects.toThrow(/before external write/);

    // The write never landed, but the attempt's lease is still live: recovery
    // leaves it alone until the lease lapses (never requeues a possibly-live
    // attempt). Advance past the lease to reclaim it.
    expect(await reconcileRoadmapApplies(db, adapter)).toEqual([]);
    const afterLease = () => new Date(Date.now() + 60 * 60 * 1000);
    const resolved = await reconcileRoadmapApplies(db, adapter, { now: afterLease });
    expect(resolved).toEqual([{ updateId: update.id, outcome: 'requeued' }]);
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('In Progress');

    // the requeued proposal applies cleanly on retry
    const retried = await applyRoadmapUpdate(db, adapter, update.id, {
      roadmapDoneDecisionId: decision.id,
    });
    expect(retried.status).toBe('applied');
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('Done');
  });

  it('only one worker can claim an apply (duplicate apply is refused)', async () => {
    const { db, project, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'task verified',
      evidenceIds: [proof.id],
    });
    const decision = createDecisionRequest(db, {
      projectId: project.id,
      category: 'roadmap_done',
      question: 'mark RM-1 Done?',
    });
    resolveDecision(db, decision.id, 'approved', 'confirmed');

    // Worker B attempts to apply while worker A is mid-apply (inside the
    // adapter call, after A claimed 'applying').
    let concurrentError: unknown;
    const contended: RoadmapAdapter = {
      readRow: (id) => adapter.readRow(id),
      readAll: () => adapter.readAll(),
      revision: () => adapter.revision(),
      dryRun: (p) => adapter.dryRun(p),
      wasApplied: (k) => adapter.wasApplied(k),
      apply: async (p, o) => {
        try {
          await applyRoadmapUpdate(db, adapter, update.id, { roadmapDoneDecisionId: decision.id });
        } catch (error) {
          concurrentError = error;
        }
        return adapter.apply(p, o);
      },
    };
    const result = await applyRoadmapUpdate(db, contended, update.id, {
      roadmapDoneDecisionId: decision.id,
    });
    expect(result.status).toBe('applied');
    expect(String(concurrentError)).toMatch(/apply in progress/);
  });

  it('the stored proposal payload is immutable at the DB level', async () => {
    const { db, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'task verified',
      evidenceIds: [proof.id],
    });
    const { roadmapUpdates } = await import('../src/db/schema.js');
    const { eq } = await import('drizzle-orm');
    expect(() =>
      db
        .update(roadmapUpdates)
        .set({ changesJson: JSON.stringify([{ stableId: 'RM-1', columns: { Status: 'Todo' } }]) })
        .where(eq(roadmapUpdates.id, update.id))
        .run(),
    ).toThrow(/immutable/);
  });
});

import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { roadmapItems, roadmapUpdates } from '../src/db/schema.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { recordVerificationRun } from '../src/domain/run-service.js';
import { addEvidence, addTask } from '../src/domain/task-service.js';
import { MockSheetsAdapter } from '../src/roadmap/mock-sheets.js';
import {
  applyRoadmapUpdate,
  proposeRoadmapUpdate,
  reconcileRoadmapApplies,
} from '../src/roadmap/proposal-service.js';
import type { RoadmapAdapter } from '../src/roadmap/types.js';
import { seedProject, testDb } from './helpers.js';

/**
 * P1-6 reproducer: reconciliation must not treat a still-leased apply attempt
 * as abandoned. A concurrent reconciler that runs while the legitimate
 * external write is in-flight must query the adapter's idempotency record
 * first and, finding the write not yet recorded but the lease still live,
 * leave the attempt alone — never requeue it and permit a second external
 * write. Lease expiry alone never authorises another write: reconciliation
 * still reconciles via the idempotency key first.
 */

const CHANGES = [{ stableId: 'RM-1', columns: { Status: 'Done' } }];

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
  const decision = createDecisionRequest(db, {
    projectId: project.id,
    category: 'roadmap_done',
    question: 'mark RM-1 Done?',
  });
  resolveDecision(db, decision.id, 'approved', 'confirmed');
  return { db, project, itemId, proof, adapter, decision };
}

async function propose(
  db: ReturnType<typeof testDb>,
  adapter: MockSheetsAdapter,
  itemId: string,
  proofId: string,
) {
  return proposeRoadmapUpdate(db, adapter, {
    roadmapItemId: itemId,
    baseKey: 'rm1-done',
    changes: CHANGES,
    rationale: 'verified',
    evidenceIds: [proofId],
  });
}

describe('P1-6 apply-lease reconciliation', () => {
  it('does not requeue an in-flight apply whose lease is still live', async () => {
    const { db, itemId, proof, adapter, decision } = setup();
    const update = await propose(db, adapter, itemId, proof.id);

    let reconcileDuringWrite: unknown;
    const inFlight: RoadmapAdapter = {
      readRow: (id) => adapter.readRow(id),
      readAll: () => adapter.readAll(),
      revision: () => adapter.revision(),
      dryRun: (p) => adapter.dryRun(p),
      wasApplied: (k) => adapter.wasApplied(k),
      apply: async (p, o) => {
        // The external write is in progress and NOT yet recorded. A concurrent
        // reconciler runs now; it must leave the live-leased attempt alone.
        reconcileDuringWrite = await reconcileRoadmapApplies(db, adapter);
        return adapter.apply(p, o);
      },
    };

    const result = await applyRoadmapUpdate(db, inFlight, update.id, {
      roadmapDoneDecisionId: decision.id,
    });
    expect(result.status).toBe('applied');
    expect(reconcileDuringWrite).toEqual([]); // the live attempt was not requeued
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('Done');
  });

  it('reconciles an already-applied write to applied even after the lease expired', async () => {
    const { db, itemId, proof, adapter, decision } = setup();
    const update = await propose(db, adapter, itemId, proof.id);

    // Claim + external write happened, then the process crashed after the write.
    const crashing: RoadmapAdapter = {
      readRow: (id) => adapter.readRow(id),
      readAll: () => adapter.readAll(),
      revision: () => adapter.revision(),
      dryRun: (p) => adapter.dryRun(p),
      wasApplied: (k) => adapter.wasApplied(k),
      apply: async (p, o) => {
        await adapter.apply(p, o);
        throw new Error('crash after external write');
      },
    };
    await expect(
      applyRoadmapUpdate(db, crashing, update.id, { roadmapDoneDecisionId: decision.id }),
    ).rejects.toThrow(/crash after external write/);

    // Even with the lease long expired, recovery reconciles via idempotency
    // (write happened -> applied), never a second write.
    const future = () => new Date(Date.now() + 60 * 60 * 1000);
    const resolved = await reconcileRoadmapApplies(db, adapter, { now: future });
    expect(resolved).toEqual([{ updateId: update.id, outcome: 'applied' }]);
    const row = db.select().from(roadmapUpdates).where(eq(roadmapUpdates.id, update.id)).get()!;
    expect(row.status).toBe('applied');
  });

  it('requeues only once the apply lease has lapsed (never while live)', async () => {
    const { db, itemId, proof, adapter, decision } = setup();
    const update = await propose(db, adapter, itemId, proof.id);

    const crashingEarly: RoadmapAdapter = {
      readRow: (id) => adapter.readRow(id),
      readAll: () => adapter.readAll(),
      revision: () => adapter.revision(),
      dryRun: (p) => adapter.dryRun(p),
      wasApplied: (k) => adapter.wasApplied(k),
      apply: async () => {
        throw new Error('crash before external write');
      },
    };
    await expect(
      applyRoadmapUpdate(db, crashingEarly, update.id, { roadmapDoneDecisionId: decision.id }),
    ).rejects.toThrow(/before external write/);

    // Immediately (lease still live): reconciliation leaves it alone.
    expect(await reconcileRoadmapApplies(db, adapter)).toEqual([]);
    expect(
      db.select().from(roadmapUpdates).where(eq(roadmapUpdates.id, update.id)).get()!.status,
    ).toBe('applying');

    // Only after the lease lapses does recovery requeue it for a fresh attempt.
    const future = () => new Date(Date.now() + 60 * 60 * 1000);
    expect(await reconcileRoadmapApplies(db, adapter, { now: future })).toEqual([
      { updateId: update.id, outcome: 'requeued' },
    ]);
    expect(
      db.select().from(roadmapUpdates).where(eq(roadmapUpdates.id, update.id)).get()!.status,
    ).toBe('proposed');
  });
});

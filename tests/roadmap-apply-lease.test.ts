import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { roadmapItems, roadmapUpdates } from '../src/db/schema.js';
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

/** Guarded roadmap application and crash-consistent exact-attempt recovery. */

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
  return { db, project, itemId, proof, adapter };
}

/** Wrap an adapter so every write-side call is recorded. */
function spying(adapter: MockSheetsAdapter) {
  const calls: string[] = [];
  const wrapped: RoadmapAdapter = {
    readRow: (id) => adapter.readRow(id),
    readAll: () => adapter.readAll(),
    revision: () => {
      calls.push('revision');
      return adapter.revision();
    },
    dryRun: (p) => adapter.dryRun(p),
    wasApplied: (k) => {
      calls.push('wasApplied');
      return adapter.wasApplied(k);
    },
    apply: (p, o) => {
      calls.push('apply');
      return adapter.apply(p, o);
    },
  };
  return { wrapped, calls };
}

describe('activated roadmap apply lease', () => {
  it('refuses Done without its separate approval and does not write the adapter', async () => {
    const { db, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'verified',
      evidenceIds: [proof.id],
    });
    expect(update.status).toBe('proposed');

    const { wrapped, calls } = spying(adapter);
    await expect(applyRoadmapUpdate(db, wrapped, update.id)).rejects.toThrow(
      /requires an approved roadmap_done DecisionRequest/,
    );
    expect(calls).toEqual(['revision']);
    // the update record is untouched and the external source unchanged
    const row = db.select().from(roadmapUpdates).where(eq(roadmapUpdates.id, update.id)).get()!;
    expect(row.status).toBe('proposed');
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('In Progress');
  });

  it('requeues a stale exact attempt that the adapter did not apply', async () => {
    const { db, itemId, proof, adapter } = setup();
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'rm1-done',
      changes: CHANGES,
      rationale: 'verified',
      evidenceIds: [proof.id],
    });
    // simulate durable crash state left by a hypothetical older build
    db.update(roadmapUpdates)
      .set({
        status: 'applying',
        applyAttemptId: newId('rapl'),
        applyStartedAt: new Date().toISOString(),
        applyWorkerId: 'w-crashed',
        applyLeaseExpiresAt: new Date(Date.now() - 1000).toISOString(),
      })
      .where(eq(roadmapUpdates.id, update.id))
      .run();

    const { wrapped, calls } = spying(adapter);
    expect(await reconcileRoadmapApplies(db, wrapped)).toEqual([
      { updateId: update.id, outcome: 'requeued' },
    ]);
    expect(calls).toEqual(['wasApplied']);
    const row = db.select().from(roadmapUpdates).where(eq(roadmapUpdates.id, update.id)).get()!;
    expect(row.status).toBe('proposed');
  });
});

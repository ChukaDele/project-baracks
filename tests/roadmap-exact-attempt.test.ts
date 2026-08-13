import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { roadmapItems, roadmapUpdates } from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import { addTask } from '../src/domain/task-service.js';
import { MockSheetsAdapter } from '../src/roadmap/mock-sheets.js';
import {
  applyRoadmapUpdate,
  bindRoadmapRuntimeHost,
  proposeRoadmapUpdate,
  reconcileRoadmapApplies,
} from '../src/roadmap/proposal-service.js';
import type { RoadmapAdapter } from '../src/roadmap/types.js';
import { seedProject, testDb } from './helpers.js';

async function setup() {
  const db = testDb();
  const project = seedProject(db);
  const itemId = newId('ritem');
  db.insert(roadmapItems)
    .values({ id: itemId, projectId: project.id, stableRef: 'RM-1', title: 'Auth' })
    .run();
  addTask(db, { projectId: project.id, roadmapItemId: itemId, title: 'login' });
  const adapter = new MockSheetsAdapter([
    { stableId: 'RM-1', values: { Title: 'Auth', Status: 'In Progress' } },
  ]);
  const update = await proposeRoadmapUpdate(db, adapter, {
    roadmapItemId: itemId,
    baseKey: 'rm1-progress',
    changes: [{ stableId: 'RM-1', columns: { Status: 'Review' } }],
    rationale: 'ready for review',
  });
  return { db, adapter, update };
}

function seedApplying(db: ReturnType<typeof testDb>, updateId: string, attemptId: string) {
  db.update(roadmapUpdates)
    .set({
      status: 'applying',
      applyAttemptId: attemptId,
      applyStartedAt: new Date(Date.now() - 120_000).toISOString(),
      applyWorkerId: `worker-${attemptId}`,
      applyLeaseExpiresAt: new Date(Date.now() - 60_000).toISOString(),
    })
    .where(eq(roadmapUpdates.id, updateId))
    .run();
}

describe('M5 exact-attempt reconciliation', () => {
  it.each([false, true])(
    'a delayed reconciler cannot settle or requeue a newer attempt (wasApplied=%s)',
    async (wasApplied) => {
      const { db, adapter, update } = await setup();
      const attemptA = newId('rapl');
      seedApplying(db, update.id, attemptA);

      let release!: (value: boolean) => void;
      const observed = new Promise<boolean>((resolve) => {
        release = resolve;
      });
      const wrapped: RoadmapAdapter = {
        readRow: (id) => adapter.readRow(id),
        readAll: () => adapter.readAll(),
        revision: () => adapter.revision(),
        dryRun: (proposal) => adapter.dryRun(proposal),
        apply: (proposal, options) => adapter.apply(proposal, options),
        wasApplied: () => observed,
      };
      const reconciling = reconcileRoadmapApplies(db, wrapped);

      await vi.waitFor(() => {
        expect(release).toBeTypeOf('function');
      });
      db.update(roadmapUpdates)
        .set({
          status: 'proposed',
          applyAttemptId: null,
          applyWorkerId: null,
          applyLeaseExpiresAt: null,
        })
        .where(eq(roadmapUpdates.id, update.id))
        .run();
      const attemptB = newId('rapl');
      seedApplying(db, update.id, attemptB);
      release(wasApplied);

      expect(await reconciling).toEqual([]);
      const current = db
        .select()
        .from(roadmapUpdates)
        .where(eq(roadmapUpdates.id, update.id))
        .get()!;
      expect(current.status).toBe('applying');
      expect(current.applyAttemptId).toBe(attemptB);
    },
  );

  it('persists and enforces the single-host roadmap mutation identity', () => {
    const db = testDb();
    expect(bindRoadmapRuntimeHost(db, 'host-a')).toBe('host-a');
    expect(bindRoadmapRuntimeHost(db, 'host-a')).toBe('host-a');
    expect(() => bindRoadmapRuntimeHost(db, 'host-b')).toThrow(/bound to host host-a/);
  });

  it('cannot duplicate a source write after a false-negative reconciliation query', async () => {
    const { db, adapter, update } = await setup();
    const proposal = {
      idempotencyKey: update.idempotencyKey,
      changes: JSON.parse(update.changesJson) as {
        stableId: string;
        columns: Record<string, string>;
      }[],
      rationale: update.rationale,
      evidenceRefs: JSON.parse(update.evidenceIdsJson) as string[],
    };
    expect((await adapter.apply(proposal)).status).toBe('applied');
    seedApplying(db, update.id, newId('rapl'));

    let applyCalls = 0;
    const lagging: RoadmapAdapter = {
      readRow: (id) => adapter.readRow(id),
      readAll: () => adapter.readAll(),
      // Simulate a lagging revision read as well as a false-negative key read.
      revision: async () => update.sourceRevision!,
      dryRun: (value) => adapter.dryRun(value),
      wasApplied: async () => false,
      apply: async (value, options) => {
        applyCalls += 1;
        return adapter.apply(value, options);
      },
    };

    expect(await reconcileRoadmapApplies(db, lagging)).toEqual([
      { updateId: update.id, outcome: 'requeued' },
    ]);
    expect((await applyRoadmapUpdate(db, lagging, update.id)).status).toBe('applied');
    expect(applyCalls).toBe(1);
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('Review');
  });

  it('rejects one malformed legacy apply row and continues the reconciliation sweep', async () => {
    const { db, adapter, update } = await setup();
    db.update(roadmapUpdates)
      .set({
        status: 'applying',
        applyAttemptId: newId('rapl'),
        applyStartedAt: new Date(Date.now() - 120_000).toISOString(),
        applyWorkerId: null,
        applyLeaseExpiresAt: null,
      })
      .where(eq(roadmapUpdates.id, update.id))
      .run();

    const second = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: update.roadmapItemId,
      baseKey: 'rm1-second',
      changes: [{ stableId: 'RM-1', columns: { Status: 'Ready' } }],
      rationale: 'second update',
    });
    seedApplying(db, second.id, newId('rapl'));

    expect(await reconcileRoadmapApplies(db, adapter)).toEqual(
      expect.arrayContaining([
        { updateId: update.id, outcome: 'rejected' },
        { updateId: second.id, outcome: 'requeued' },
      ]),
    );
  });
});

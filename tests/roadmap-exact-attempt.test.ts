import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/security/capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/security/capabilities.js')>();
  return {
    ...actual,
    assertCapabilityAvailable(capability: Parameters<typeof actual.assertCapabilityAvailable>[0]) {
      if (capability === 'external-roadmap-application') return;
      actual.assertCapabilityAvailable(capability);
    },
  };
});

import { roadmapItems, roadmapUpdates } from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import { addTask } from '../src/domain/task-service.js';
import { MockSheetsAdapter } from '../src/roadmap/mock-sheets.js';
import {
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

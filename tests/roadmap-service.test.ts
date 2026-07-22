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
import { applyRoadmapUpdate, proposeRoadmapUpdate } from '../src/roadmap/proposal-service.js';
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

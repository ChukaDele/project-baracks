import { describe, expect, it } from 'vitest';
import { discoveryObservations, routingCheckpoints } from '../src/db/schema.js';
import {
  loadPersistedProviderInfos,
  persistProviderDiscovery,
  recordModelOutcome,
  shouldProbe,
} from '../src/providers/discovery-store.js';
import type { ProviderInfo } from '../src/providers/types.js';
import { recordRoutingCheckpoint } from '../src/routing/checkpoint.js';
import { route } from '../src/routing/router.js';
import { addTask } from '../src/domain/task-service.js';
import { model, seedProject, testDb } from './helpers.js';

function providerInfo(overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    name: 'claude-code',
    installed: true,
    authenticated: true,
    models: [
      model({ modelRef: 'opus', routingClass: 'opus' }),
      model({ modelRef: 'sonnet', routingClass: 'sonnet' }),
    ],
    ...overrides,
  };
}

describe('discovery persistence', () => {
  it('persists observations with source, time and confidence', () => {
    const db = testDb();
    persistProviderDiscovery(db, providerInfo(), { source: 'cli' });
    const observations = db.select().from(discoveryObservations).all();
    expect(observations).toHaveLength(2);
    for (const obs of observations) {
      expect(obs.source).toBe('cli');
      expect(obs.confidence).toBe('inferred');
      expect(obs.observedAt).toBeTruthy();
      expect(JSON.parse(obs.observedJson)).toHaveProperty('availability');
    }
  });

  it('routing consumes persisted state, not fresh assertions', () => {
    const db = testDb();
    persistProviderDiscovery(db, providerInfo(), { source: 'cli' });
    const infos = loadPersistedProviderInfos(db);
    expect(infos).toHaveLength(1);
    expect(infos[0]!.models.every((m) => m.source === 'persisted')).toBe(true);
    const decision = route({ purpose: 'implementation', complexity: 'bounded' }, infos);
    expect(decision.kind).toBe('route');
  });

  it('persists exhaustion with a next-probe time and blocks early re-probing', () => {
    const db = testDb();
    persistProviderDiscovery(db, providerInfo(), { source: 'cli' });
    const { nextProbeAt } = recordModelOutcome(db, {
      providerName: 'claude-code',
      modelRef: 'opus',
      outcome: 'exhausted',
    });
    expect(nextProbeAt).toBeTruthy();
    expect(shouldProbe({ nextProbeAt })).toBe(false);
    expect(shouldProbe({ nextProbeAt }, () => new Date(Date.now() + 2 * 60 * 60_000))).toBe(true);

    // an optimistic re-discover does NOT erase the observed exhaustion
    persistProviderDiscovery(db, providerInfo(), { source: 'cli' });
    const infos = loadPersistedProviderInfos(db);
    const opus = infos[0]!.models.find((m) => m.modelRef === 'opus')!;
    expect(opus.availability).toBe('exhausted');

    // recovery clears the backoff
    recordModelOutcome(db, { providerName: 'claude-code', modelRef: 'opus', outcome: 'available' });
    const after = loadPersistedProviderInfos(db)[0]!.models.find((m) => m.modelRef === 'opus')!;
    expect(after.availability).toBe('available');
  });

  it('an exhausted persisted model is not routed to', () => {
    const db = testDb();
    persistProviderDiscovery(
      db,
      providerInfo({ models: [model({ modelRef: 'opus', routingClass: 'opus' })] }),
      { source: 'cli' },
    );
    recordModelOutcome(db, { providerName: 'claude-code', modelRef: 'opus', outcome: 'exhausted' });
    const decision = route(
      { purpose: 'implementation', complexity: 'complex' },
      loadPersistedProviderInfos(db),
    );
    expect(decision.kind).toBe('checkpoint');
  });

  it('observations are append-only', () => {
    const db = testDb();
    persistProviderDiscovery(db, providerInfo(), { source: 'cli' });
    expect(() => db.delete(discoveryObservations).run()).toThrow(/append-only/);
  });
});

describe('routing checkpoints', () => {
  it('persists an explicit checkpoint record with the paid options', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'blocked work' });
    const decision = route({ purpose: 'implementation', complexity: 'architectural' }, [
      {
        name: 'claude-code',
        installed: true,
        authenticated: true,
        models: [model({ modelRef: 'fable', routingClass: 'fable', billingMode: 'usage_credits' })],
      },
    ]);
    expect(decision.kind).toBe('checkpoint');
    if (decision.kind !== 'checkpoint') return;
    const row = recordRoutingCheckpoint(db, {
      taskId: task.id,
      purpose: 'implementation',
      decision,
    });
    const stored = db.select().from(routingCheckpoints).all();
    expect(stored).toHaveLength(1);
    expect(stored[0]!.id).toBe(row.id);
    expect(JSON.parse(stored[0]!.paidOptionsJson)).toEqual([
      { provider: 'claude-code', modelRef: 'fable', billingMode: 'usage_credits' },
    ]);
    expect(() => db.delete(routingCheckpoints).run()).toThrow(/append-only/);
  });
});

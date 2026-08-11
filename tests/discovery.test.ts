import { describe, expect, it } from 'vitest';
import { agentModels, discoveryObservations, routingCheckpoints } from '../src/db/schema.js';
import {
  consumeModelRetry,
  loadPersistedProviderInfos,
  persistProviderDiscovery,
  recordBillingObservation,
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

  it('redacts human availability evidence before persistence', () => {
    const db = testDb();
    persistProviderDiscovery(db, providerInfo(), {
      source: 'human',
      note: 'verified with token=sk-this-is-a-secret-value',
    });
    const observations = db.select().from(discoveryObservations).all();
    expect(observations).toHaveLength(2);
    for (const observation of observations) {
      expect(observation.observedJson).not.toContain('sk-this-is-a-secret-value');
      expect(JSON.parse(observation.observedJson).note).toContain('[REDACTED]');
      expect(observation.source).toBe('human');
      expect(observation.confidence).toBe('configured');
    }
  });

  it('redacts billing attestation notes before persistence', () => {
    const db = testDb();
    persistProviderDiscovery(db, providerInfo(), { source: 'cli' });
    recordBillingObservation(db, {
      providerName: 'claude-code',
      modelRef: 'opus',
      billingMode: 'subscription_included',
      source: 'human',
      note: 'confirmed with token=sk-this-is-a-secret-value',
    });
    const observation = db.select().from(discoveryObservations).all().at(-1)!;
    expect(observation.observedJson).toContain('[REDACTED]');
    expect(observation.observedJson).not.toContain('sk-this-is-a-secret-value');
  });

  it('routing consumes persisted state, and billing stays unroutable until observed', () => {
    const db = testDb();
    // The discovery input CLAIMS subscription billing, but discovery is not
    // authority: the persisted state must be 'unknown' and unroutable.
    persistProviderDiscovery(db, providerInfo(), { source: 'cli' });
    const infos = loadPersistedProviderInfos(db);
    expect(infos).toHaveLength(1);
    expect(infos[0]!.models.every((m) => m.source === 'persisted')).toBe(true);
    expect(infos[0]!.models.every((m) => m.billingMode === 'unknown')).toBe(true);
    expect(route({ purpose: 'implementation', complexity: 'bounded' }, infos).kind).toBe(
      'checkpoint',
    );

    // An authoritative observation (human attestation) makes it routable.
    recordBillingObservation(db, {
      providerName: 'claude-code',
      modelRef: 'sonnet',
      billingMode: 'subscription_included',
      source: 'human',
      note: 'operator confirmed Max subscription covers this model',
    });
    const decision = route(
      { purpose: 'implementation', complexity: 'bounded' },
      loadPersistedProviderInfos(db),
    );
    expect(decision.kind).toBe('route');
  });

  it('re-discovery never overwrites an authoritatively observed billing mode', () => {
    const db = testDb();
    persistProviderDiscovery(db, providerInfo(), { source: 'cli' });
    recordBillingObservation(db, {
      providerName: 'claude-code',
      modelRef: 'opus',
      billingMode: 'subscription_included',
      source: 'run_outcome',
    });
    // a later optimistic re-discover claiming different billing changes nothing
    persistProviderDiscovery(db, providerInfo(), { source: 'cli' });
    const opus = loadPersistedProviderInfos(db)[0]!.models.find((m) => m.modelRef === 'opus')!;
    expect(opus.billingMode).toBe('subscription_included');
    const sonnet = loadPersistedProviderInfos(db)[0]!.models.find((m) => m.modelRef === 'sonnet')!;
    expect(sonnet.billingMode).toBe('unknown');
  });

  it('process-free doctor discovery cannot erase human-attested availability', () => {
    const db = testDb();
    persistProviderDiscovery(db, providerInfo({ executable: '/trusted/provider' }), {
      source: 'human',
      note: 'operator verified login and model visibility',
    });
    persistProviderDiscovery(
      db,
      providerInfo({
        executable: '/hostile/path/provider',
        installed: false,
        authenticated: false,
        models: [
          model({
            modelRef: 'opus',
            visible: false,
            authenticated: false,
            availability: 'unknown',
          }),
        ],
      }),
      { source: 'cli' },
    );
    const info = loadPersistedProviderInfos(db)[0]!;
    expect(info.executable).toBe('/trusted/provider');
    expect(info.models.find((candidate) => candidate.modelRef === 'opus')).toMatchObject({
      visible: true,
      authenticated: true,
      availability: 'available',
    });
  });

  it('process-free discovery cannot clear an authoritative model prohibition', () => {
    const db = testDb();
    persistProviderDiscovery(
      db,
      providerInfo({
        models: [
          model({
            modelRef: 'opus',
            routingClass: 'opus',
            prohibited: true,
            prohibitedReason: 'operator prohibition',
          }),
        ],
      }),
      { source: 'human' },
    );
    persistProviderDiscovery(
      db,
      providerInfo({
        models: [model({ modelRef: 'opus', routingClass: 'sonnet', prohibited: false })],
      }),
      { source: 'cli' },
    );
    expect(loadPersistedProviderInfos(db)[0]!.models[0]).toMatchObject({
      routingClass: 'opus',
      prohibited: true,
      prohibitedReason: 'operator prohibition',
    });
  });

  it('an observed authentication failure revokes stale availability', () => {
    const db = testDb();
    persistProviderDiscovery(db, providerInfo(), { source: 'human' });
    recordModelOutcome(db, {
      providerName: 'claude-code',
      modelRef: 'opus',
      outcome: 'unknown',
    });
    expect(
      loadPersistedProviderInfos(db)[0]!.models.find((candidate) => candidate.modelRef === 'opus')!
        .availability,
    ).toBe('unknown');
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

  it('keeps the observed state but makes one real retry eligible after backoff expiry', () => {
    const db = testDb();
    const observedAt = new Date('2026-01-01T00:00:00.000Z');
    persistProviderDiscovery(db, providerInfo(), { source: 'human', now: () => observedAt });
    recordModelOutcome(db, {
      providerName: 'claude-code',
      modelRef: 'opus',
      outcome: 'exhausted',
      backoffMs: 1_000,
      now: () => observedAt,
    });
    recordBillingObservation(db, {
      providerName: 'claude-code',
      modelRef: 'opus',
      billingMode: 'subscription_included',
      source: 'human',
    });
    const deadline = db.select().from(agentModels).get()!.nextProbeAt;
    persistProviderDiscovery(db, providerInfo({ installed: false, authenticated: false }), {
      source: 'cli',
      now: () => new Date('2026-01-01T00:01:00.000Z'),
    });
    const persisted = loadPersistedProviderInfos(
      db,
      () => new Date('2026-01-01T00:01:00.000Z'),
    )[0]!.models.find((candidate) => candidate.modelRef === 'opus')!;
    expect(persisted.availability).toBe('exhausted');
    expect(persisted.retryEligible).toBe(true);
    expect(db.select().from(agentModels).get()!.nextProbeAt).toBe(deadline);
    const decision = route(
      { purpose: 'implementation', complexity: 'complex' },
      loadPersistedProviderInfos(db, () => new Date('2026-01-01T00:01:00.000Z')),
    );
    expect(decision.kind).toBe('route');

    expect(
      consumeModelRetry(db, {
        providerName: 'claude-code',
        modelRef: 'opus',
        now: () => new Date('2026-01-01T00:01:00.000Z'),
      }),
    ).toBe(true);
    expect(
      consumeModelRetry(db, {
        providerName: 'claude-code',
        modelRef: 'opus',
        now: () => new Date('2026-01-01T00:01:00.000Z'),
      }),
    ).toBe(false);
    const consumed = loadPersistedProviderInfos(
      db,
      () => new Date('2026-01-01T00:01:00.000Z'),
    )[0]!.models.find((candidate) => candidate.modelRef === 'opus')!;
    expect(consumed).toMatchObject({ availability: 'unknown' });
    expect(consumed.retryEligible).toBeUndefined();
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

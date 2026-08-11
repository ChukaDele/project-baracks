import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  agentProviders,
  decisionRequests,
  roadmapItems,
  tasks,
  taskSuggestions,
} from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import { createRun } from '../src/domain/run-service.js';
import * as taskService from '../src/domain/task-service.js';
import {
  addSuggestion,
  addTask,
  getSuggestion,
  scopeFingerprint,
  SuggestionApprovalUnavailableError,
  transitionTask,
  type NewTaskInput,
} from '../src/domain/task-service.js';
import { CapabilityUnavailableError } from '../src/security/capabilities.js';
import { ensureObservedModel, seedProject, testDb } from './helpers.js';

/**
 * Adversarial regression coverage for the single-read input snapshot at the
 * canonical mutation boundaries. Untrusted input is mutable and potentially
 * accessor-backed: a stateful getter or Proxy can answer differently on
 * successive reads, so a boundary that reads a gated property once for its
 * guard and again for persistence can be shown two different worlds. Each
 * test builds its own database and fixtures — none depends on another test
 * or on execution order.
 */

/** A pending suggestion in a fresh db, for materialisation-bypass attempts. */
function pendingSuggestion() {
  const db = testDb();
  const project = seedProject(db);
  const { suggestion } = addSuggestion(db, { projectId: project.id, title: 'materialise me' });
  return { db, project, suggestion };
}

/**
 * Base task input whose `suggestionId` property is a STATEFUL GETTER: it
 * returns `values[0]` on the first read, `values[1]` on the second, and the
 * last element thereafter. Also counts how often the getter fires.
 */
function statefulSuggestionIdInput(
  base: NewTaskInput,
  values: (string | undefined)[],
): { input: NewTaskInput; reads: () => number } {
  let reads = 0;
  const input = { ...base };
  Object.defineProperty(input, 'suggestionId', {
    enumerable: true,
    configurable: true,
    get(): string | undefined {
      reads += 1;
      return values[Math.min(reads, values.length) - 1];
    },
  });
  return { input, reads: () => reads };
}

/** The suggestion is still pending and completely undecided. */
function expectSuggestionUntouched(db: ReturnType<typeof testDb>, suggestionId: string) {
  const after = getSuggestion(db, suggestionId);
  expect(after.status).toBe('pending');
  expect(after.approvedTaskId).toBeNull();
  expect(after.decidedAt).toBeNull();
  expect(after.decisionNote).toBeNull();
  // No suggestion-to-task relationship exists in either direction…
  expect(db.select().from(tasks).where(eq(tasks.suggestionId, suggestionId)).all()).toHaveLength(0);
  expect(
    db.select().from(taskSuggestions).where(eq(taskSuggestions.status, 'approved')).all(),
  ).toHaveLength(0);
  // …and no approval/decision record was written.
  expect(db.select().from(decisionRequests).all()).toHaveLength(0);
}

describe('addTask single-read snapshot (suggestion-materialisation bypass)', () => {
  it('a getter returning undefined then a pending id cannot link a task to the suggestion', () => {
    const { db, project, suggestion } = pendingSuggestion();
    // The historical attack: show the safety guard `undefined`, then hand the
    // persistence path a real pending suggestion id on the second read.
    const { input, reads } = statefulSuggestionIdInput(
      { projectId: project.id, title: 'smuggled' },
      [undefined, suggestion.id],
    );

    const task = addTask(db, input);

    // The getter fired exactly once: guard and persistence saw the same value.
    expect(reads()).toBe(1);
    // The single read observed no provenance, so the created task is an
    // ordinary unlinked draft — the second, hostile value never persisted.
    expect(task.suggestionId).toBeNull();
    expectSuggestionUntouched(db, suggestion.id);
  });

  it('a getter presenting the pending id to the single read is refused before any write', () => {
    const { db, project, suggestion } = pendingSuggestion();
    const { input, reads } = statefulSuggestionIdInput(
      { projectId: project.id, title: 'refused' },
      [suggestion.id, undefined],
    );

    expect(() => addTask(db, input)).toThrow(SuggestionApprovalUnavailableError);

    expect(reads()).toBe(1);
    // Rejected before the insert: NO task of any kind exists.
    expect(db.select().from(tasks).all()).toHaveLength(0);
    expectSuggestionUntouched(db, suggestion.id);
  });

  it('reads every property of the caller-owned input exactly once', () => {
    const db = testDb();
    const project = seedProject(db);
    const counts: Record<string, number> = {};
    const values: Record<string, unknown> = {
      projectId: project.id,
      title: 'counted',
      description: 'd',
      complexity: 'bounded',
      roadmapItemId: undefined,
      suggestionId: undefined,
      completionCriteriaJson: undefined,
    };
    const input = {};
    for (const key of Object.keys(values)) {
      Object.defineProperty(input, key, {
        enumerable: true,
        configurable: true,
        get(): unknown {
          counts[key] = (counts[key] ?? 0) + 1;
          return values[key];
        },
      });
    }

    const task = addTask(db, input as NewTaskInput);

    expect(task.title).toBe('counted');
    for (const key of Object.keys(values)) {
      expect(counts[key], `property '${key}' must be read exactly once`).toBe(1);
    }
  });

  it('a Proxy cannot alter any value between validation and persistence', () => {
    const { db, project, suggestion } = pendingSuggestion();
    const readsPerProperty = new Map<string | symbol, number>();
    const target: NewTaskInput = { projectId: project.id, title: 'first', description: 'benign' };
    const hostile = new Proxy(target, {
      get(t, prop, receiver): unknown {
        const n = (readsPerProperty.get(prop) ?? 0) + 1;
        readsPerProperty.set(prop, n);
        // First read of each property answers benignly; ANY reread — i.e. a
        // validation-then-persistence double read — answers with hostile
        // values, including a real pending suggestion id.
        if (n > 1) {
          if (prop === 'suggestionId') return suggestion.id;
          if (prop === 'title') return 'second';
          if (prop === 'description') return 'swapped';
        }
        return Reflect.get(t, prop, receiver) as unknown;
      },
    });

    const task = addTask(db, hostile);

    // No property was reread, so no hostile value ever surfaced: persistence
    // saw the one coherent benign world the snapshot captured.
    for (const [prop, n] of readsPerProperty) {
      expect(n, `property '${String(prop)}' must be read at most once`).toBeLessThanOrEqual(1);
    }
    expect(task.suggestionId).toBeNull();
    expect(task.title).toBe('first');
    expect(task.description).toBe('benign');
    expectSuggestionUntouched(db, suggestion.id);
  });

  it('exposes no exported lower-level API that can bypass the gate', () => {
    // The raw insertion primitive is module-private: the only exported task
    // writers are addTask (snapshot-gated) and approveSuggestion (disabled).
    expect((taskService as Record<string, unknown>)['insertTask']).toBeUndefined();
    const { db, project, suggestion } = pendingSuggestion();
    expect(() => taskService.approveSuggestion(db, suggestion.id, 'please')).toThrow(
      SuggestionApprovalUnavailableError,
    );
    expect(() =>
      addTask(db, { projectId: project.id, title: 't', suggestionId: suggestion.id }),
    ).toThrow(SuggestionApprovalUnavailableError);
    expect(db.select().from(tasks).all()).toHaveLength(0);
    expectSuggestionUntouched(db, suggestion.id);
  });

  it('retained contract: ordinary task creation still works', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'ordinary work' });
    expect(task.status).toBe('draft');
    expect(task.suggestionId).toBeNull();
    expect(db.select().from(tasks).all()).toHaveLength(1);
  });

  it('retained contract: roadmap-linked ordinary task creation still works', () => {
    const db = testDb();
    const project = seedProject(db);
    const roadmapItemId = newId('ritem');
    db.insert(roadmapItems)
      .values({ id: roadmapItemId, projectId: project.id, stableRef: 'RM-1', title: 'Auth' })
      .run();
    const task = addTask(db, { projectId: project.id, roadmapItemId, title: 'login work' });
    expect(task.status).toBe('draft');
    expect(task.roadmapItemId).toBe(roadmapItemId);
    expect(task.suggestionId).toBeNull();
  });
});

describe('addSuggestion single-read snapshot', () => {
  it('a stateful title getter cannot desynchronise the dedup fingerprint from the row', () => {
    const db = testDb();
    const project = seedProject(db);
    let reads = 0;
    const input = { projectId: project.id, description: '' };
    Object.defineProperty(input, 'title', {
      enumerable: true,
      configurable: true,
      get(): string {
        reads += 1;
        return reads === 1 ? 'fingerprinted title' : 'different persisted title';
      },
    });

    const result = addSuggestion(db, input as taskService.NewSuggestionInput);

    expect(result.outcome).toBe('created');
    expect(reads).toBe(1);
    // The stored fingerprint matches the stored title: dedup cannot be evaded
    // by showing the fingerprint one title and persistence another.
    expect(result.suggestion.title).toBe('fingerprinted title');
    expect(result.suggestion.scopeFingerprint).toBe(
      scopeFingerprint(result.suggestion.title, result.suggestion.description),
    );
  });
});

describe('applyTransition single-read of the fence option', () => {
  it('a stateful fence getter cannot slip a fenced transition past the capability gate', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'work' });
    let reads = 0;
    const opts: { fence?: taskService.ClaimFence } = {};
    Object.defineProperty(opts, 'fence', {
      enumerable: true,
      configurable: true,
      get(): taskService.ClaimFence | undefined {
        reads += 1;
        // Hide from the gate, appear for the live-claim check.
        return reads === 1 ? undefined : { claimId: 'tclm_x', workerId: 'w1' };
      },
    });

    // The single read saw no fence: this is a plain unfenced transition — the
    // hostile second value is never consulted, so nothing worker-attributed
    // happens and no stale-claim path is reachable.
    const after = transitionTask(db, task.id, 'ready', opts);
    expect(after.status).toBe('ready');
    expect(reads).toBe(1);

    // And a fence visible to the single read is refused outright.
    expect(() =>
      transitionTask(db, task.id, 'queued', { fence: { claimId: 'tclm_x', workerId: 'w1' } }),
    ).toThrow(CapabilityUnavailableError);
  });
});

describe('createRun single-read snapshot', () => {
  function runFixture() {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'work' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'claude-code' }).run();
    ensureObservedModel(db, providerId);
    return { db, task, providerId };
  }

  it('a stateful billingMode getter cannot persist a paid run past the gate', () => {
    const { db, task, providerId } = runFixture();
    let reads = 0;
    const input = {
      taskId: task.id,
      providerId,
      modelRef: 'sonnet',
      purpose: 'implementation' as const,
      routingReason: 'test',
    };
    Object.defineProperty(input, 'billingMode', {
      enumerable: true,
      configurable: true,
      get(): string {
        reads += 1;
        // Show the gate an included mode, persistence a paid one.
        return reads === 1 ? 'subscription_included' : 'api_billing';
      },
    });

    const run = createRun(db, input as Parameters<typeof createRun>[1]);

    // Single read: the value the gate approved is the value that persisted.
    expect(reads).toBe(1);
    expect(run.billingMode).toBe('subscription_included');

    // And a paid mode visible to the single read is refused with no row.
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        modelRef: 'sonnet',
        purpose: 'implementation',
        billingMode: 'api_billing',
        routingReason: 'paid',
      }),
    ).toThrow(CapabilityUnavailableError);
  });

  it('a stateful claimId getter cannot persist a claim-bound run past the gate', () => {
    const { db, task, providerId } = runFixture();
    let reads = 0;
    const input = {
      taskId: task.id,
      providerId,
      modelRef: 'sonnet',
      purpose: 'implementation' as const,
      billingMode: 'subscription_included' as const,
      routingReason: 'test',
    };
    Object.defineProperty(input, 'claimId', {
      enumerable: true,
      configurable: true,
      get(): string | undefined {
        reads += 1;
        return reads === 1 ? undefined : 'tclm_smuggled';
      },
    });

    const run = createRun(db, input);

    expect(reads).toBe(1);
    // The single read saw no claim: the persisted run is claim-free.
    expect(run.claimId).toBeNull();
  });
});

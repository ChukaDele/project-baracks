import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { tasks, taskSuggestions } from '../src/db/schema.js';
import {
  addSuggestion,
  addTask,
  approveSuggestion,
  getSuggestion,
  SuggestionApprovalUnavailableError,
} from '../src/domain/task-service.js';
import {
  CAPABILITY_DEFINITIONS,
  capabilityStatuses,
  DEFAULT_MODEL_REGISTRY,
  loadModelRegistry,
  registryModels,
} from '../src/providers/registry.js';
import { route } from '../src/routing/router.js';
import {
  assertCapabilityAvailable,
  isCapabilityAvailable,
  type Capability,
} from '../src/security/capabilities.js';
import { seedProject, testDb } from './helpers.js';

const ALL_FIVE: Capability[] = [
  'live-agent-execution',
  'paid-provider-execution',
  'automated-task-completion',
  'worker-owned-downstream-mutations',
  'external-roadmap-application',
];

describe('the v0.5.1 capability gate', () => {
  it('declares exactly the five reviewed capabilities active and frozen', () => {
    expect(Object.keys(CAPABILITY_DEFINITIONS).sort()).toEqual([...ALL_FIVE].sort());
    expect(Object.isFrozen(CAPABILITY_DEFINITIONS)).toBe(true);
    for (const capability of ALL_FIVE) {
      expect(Object.isFrozen(CAPABILITY_DEFINITIONS[capability])).toBe(true);
      expect(isCapabilityAvailable(capability)).toBe(true);
      expect(() => assertCapabilityAvailable(capability)).not.toThrow();
    }
  });

  it('reports all five as active with their reviewed milestone', () => {
    const statuses = capabilityStatuses();
    expect(statuses.map((status) => status.capability).sort()).toEqual([...ALL_FIVE].sort());
    expect(statuses.every((status) => status.available)).toBe(true);
    for (const status of statuses) expect(status.milestone).toMatch(/^M[1-5] — activated/);
  });

  it('cannot be changed by environment variables', () => {
    const names = [
      'MAJOR_ENABLE_LIVE_EXECUTION',
      'MAJOR_ALLOW_PAID',
      'MAJOR_CAPABILITIES',
      'MAJOR_UNSAFE',
    ];
    const previous = names.map((name) => [name, process.env[name]] as const);
    for (const name of names) process.env[name] = '0';
    try {
      for (const capability of ALL_FIVE) expect(isCapabilityAvailable(capability)).toBe(true);
    } finally {
      for (const [name, value] of previous) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    }
  });
});

describe('activation does not expand adjacent authority', () => {
  it('keeps suggestion approval unavailable at its canonical mutation boundary', () => {
    const db = testDb();
    const project = seedProject(db);
    const { suggestion } = addSuggestion(db, { projectId: project.id, title: 'promote me' });

    expect(() => approveSuggestion(db, suggestion.id, 'go')).toThrow(
      SuggestionApprovalUnavailableError,
    );
    expect(() =>
      addTask(db, {
        projectId: project.id,
        title: suggestion.title,
        suggestionId: suggestion.id,
      }),
    ).toThrow(SuggestionApprovalUnavailableError);

    expect(db.select().from(tasks).all()).toHaveLength(0);
    expect(db.select().from(tasks).where(eq(tasks.suggestionId, suggestion.id)).all()).toHaveLength(
      0,
    );
    expect(
      db.select().from(taskSuggestions).where(eq(taskSuggestions.status, 'approved')).all(),
    ).toHaveLength(0);
    expect(getSuggestion(db, suggestion.id)).toMatchObject({
      status: 'pending',
      approvedTaskId: null,
      decidedAt: null,
    });
  });

  it('does not let model-registry configuration declare capabilities or billing evidence', () => {
    const directory = mkdtempSync(join(tmpdir(), 'major-reg-'));
    const registryPath = join(directory, 'model-registry.json');
    writeFileSync(
      registryPath,
      JSON.stringify({
        version: 1,
        capabilities: { 'live-agent-execution': { available: false } },
        entries: [
          {
            provider: 'claude-code',
            knownModels: ['opus'],
            rules: [{ match: 'opus', routingClass: 'opus', billingMode: 'subscription_included' }],
          },
        ],
      }),
    );

    const models = registryModels(loadModelRegistry(registryPath), 'claude-code', {
      visible: true,
      authenticated: true,
    });
    expect(models[0]?.billingMode).toBe('unknown');
    expect(
      route({ purpose: 'implementation', complexity: 'bounded' }, [
        { name: 'claude-code', installed: true, authenticated: true, models },
      ]).kind,
    ).toBe('checkpoint');
    for (const capability of ALL_FIVE) expect(isCapabilityAvailable(capability)).toBe(true);
  });

  it('keeps the immutable default registry separate from activation constants', () => {
    expect(DEFAULT_MODEL_REGISTRY.version).toBe(1);
    expect('capabilities' in DEFAULT_MODEL_REGISTRY).toBe(false);
  });
});

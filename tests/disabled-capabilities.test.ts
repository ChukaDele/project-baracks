import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { agentProviders, tasks, taskSuggestions } from '../src/db/schema.js';
import { claimNextTask } from '../src/domain/claim-service.js';
import { newId } from '../src/domain/ids.js';
import { createRun } from '../src/domain/run-service.js';
import {
  addSuggestion,
  addTask,
  approveSuggestion,
  getSuggestion,
  SuggestionApprovalUnavailableError,
  transitionTask,
} from '../src/domain/task-service.js';
import { ClaudeCodeProvider } from '../src/providers/claude-code.js';
import { CodexProvider } from '../src/providers/codex.js';
import { cursorProvider } from '../src/providers/cursor.js';
import { antigravityProvider } from '../src/providers/antigravity.js';
import {
  DEFAULT_MODEL_REGISTRY,
  loadModelRegistry,
  registryModels,
  CAPABILITY_DEFINITIONS,
  capabilityStatuses,
} from '../src/providers/registry.js';
import { MockSheetsAdapter } from '../src/roadmap/mock-sheets.js';
import { applyRoadmapUpdate, reconcileRoadmapApplies } from '../src/roadmap/proposal-service.js';
import { route } from '../src/routing/router.js';
import {
  assertCapabilityAvailable,
  CapabilityUnavailableError,
  isCapabilityAvailable,
  type UnavailableCapability,
} from '../src/security/capabilities.js';
import { ExecutionGateway } from '../src/security/gateway.js';
import { executeMajorCommand } from '../src/security/major-gateway.js';
import { TrustedExecutableRegistry } from '../src/security/trusted-executables.js';
import { model, seedProject, testDb } from './helpers.js';

/**
 * Cross-surface proof that every unavailable capability is unreachable in
 * this build: from provider adapters and routing, from direct run creation,
 * from task transitions, from roadmap application, and regardless of any
 * configuration override. (CLI-process coverage lives in cli.test.ts.)
 */

const ALL_FIVE: UnavailableCapability[] = [
  'live-agent-execution',
  'paid-provider-execution',
  'automated-task-completion',
  'worker-owned-downstream-mutations',
  'external-roadmap-application',
];

describe('the capability gate itself', () => {
  it('declares exactly the five capabilities unavailable, frozen', () => {
    expect(Object.keys(CAPABILITY_DEFINITIONS).sort()).toEqual([...ALL_FIVE].sort());
    expect(Object.isFrozen(CAPABILITY_DEFINITIONS)).toBe(true);
    for (const cap of ALL_FIVE) {
      expect(isCapabilityAvailable(cap)).toBe(false);
      expect(() => assertCapabilityAvailable(cap)).toThrow(CapabilityUnavailableError);
    }
  });

  it('is surfaced by the capability/model registry as unavailable', () => {
    const statuses = capabilityStatuses().filter((status) => !status.available);
    expect(statuses.map((s) => s.capability).sort()).toEqual([...ALL_FIVE].sort());
    for (const status of statuses) {
      expect(status.available).toBe(false);
      expect(status.milestone).toMatch(/^M[1-5]/);
    }
  });
});

describe('provider execution surface', () => {
  function probeGateway() {
    return ExecutionGateway.probeOnly({
      commandPolicy: { allowedExecutables: ['claude', 'codex', 'cursor-agent', 'agy', 'which'] },
      trustedExecutables: new TrustedExecutableRegistry(),
      recordDecision: () => undefined,
    });
  }

  it('all four provider adapters refuse execute() via the gateway gate', () => {
    const claude = new ClaudeCodeProvider({
      gateway: probeGateway(),
      registry: DEFAULT_MODEL_REGISTRY,
    });
    const codex = new CodexProvider({ gateway: probeGateway(), registry: DEFAULT_MODEL_REGISTRY });
    const cursor = cursorProvider({ gateway: probeGateway(), registry: DEFAULT_MODEL_REGISTRY });
    const antigravity = antigravityProvider({
      gateway: probeGateway(),
      registry: DEFAULT_MODEL_REGISTRY,
    });
    for (const provider of [claude, codex, cursor, antigravity]) {
      expect(() => provider.execute({ prompt: 'do work', cwd: process.cwd() })).toThrow(
        CapabilityUnavailableError,
      );
    }
  });

  it('the successor supervisor gateway refuses before spawning and audits the refusal', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-successor-gate-'));
    const marker = join(home, 'spawned');
    const previous = process.env.MAJOR_HOME;
    process.env.MAJOR_HOME = home;
    try {
      expect(() =>
        executeMajorCommand({
          executable: process.execPath,
          args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'bad')`],
          cwd: home,
          allowedRoots: [home],
        }),
      ).toThrow(CapabilityUnavailableError);
      expect(existsSync(marker)).toBe(false);
      const decisions = readFileSync(join(home, 'execution-policy.jsonl'), 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line) as { allowed: boolean; reason: string });
      expect(decisions).toHaveLength(1);
      expect(decisions[0]).toMatchObject({ allowed: false });
      expect(decisions[0]?.reason).toMatch(/live-agent-execution/);
    } finally {
      if (previous === undefined) delete process.env.MAJOR_HOME;
      else process.env.MAJOR_HOME = previous;
    }
  });
});

describe('provider routing surface', () => {
  it('never yields a paid route, with or without an approved decision reference', () => {
    const paidOnly = [
      {
        name: 'claude-code',
        installed: true,
        authenticated: true,
        models: [
          model({
            modelRef: 'opus',
            routingClass: 'opus' as const,
            billingMode: 'api_billing' as const,
          }),
        ],
      },
    ];
    for (const approvedPaidUsage of [undefined, { decisionId: 'dreq_approved' }]) {
      const request: Parameters<typeof route>[0] = {
        purpose: 'implementation',
        complexity: 'complex',
      };
      if (approvedPaidUsage) request.approvedPaidUsage = approvedPaidUsage;
      const decision = route(request, paidOnly);
      expect(decision.kind).toBe('checkpoint');
    }
  });
});

describe('direct run creation surface', () => {
  function setup() {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'work' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'claude-code' }).run();
    return { db, task, providerId };
  }

  it('refuses paid billing modes and claim-bound runs outright', () => {
    const { db, task, providerId } = setup();
    for (const billingMode of ['usage_credits', 'api_billing'] as const) {
      expect(() =>
        createRun(db, {
          taskId: task.id,
          providerId,
          modelRef: 'opus',
          purpose: 'implementation',
          billingMode,
          routingReason: 'paid',
        }),
      ).toThrow(CapabilityUnavailableError);
    }
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        claimId: 'tclm_any',
        modelRef: 'sonnet',
        purpose: 'implementation',
        billingMode: 'subscription_included',
        routingReason: 'claimed',
      }),
    ).toThrow(CapabilityUnavailableError);
  });

  it('refuses worker dispatch (claiming) and automated completion', () => {
    const { db, task } = setup();
    expect(() => claimNextTask(db, { workerId: 'w1' })).toThrow(CapabilityUnavailableError);
    transitionTask(db, task.id, 'ready');
    expect(() =>
      transitionTask(db, task.id, 'queued', { fence: { claimId: 'x', workerId: 'w1' } }),
    ).toThrow(CapabilityUnavailableError);
    expect(() => transitionTask(db, task.id, 'completed')).toThrow(CapabilityUnavailableError);
  });
});

describe('suggestion approval surface', () => {
  it('refuses at the canonical mutation boundary, before any mutation', () => {
    const db = testDb();
    const project = seedProject(db);
    const { suggestion } = addSuggestion(db, { projectId: project.id, title: 'promote me' });

    expect(() => approveSuggestion(db, suggestion.id, 'go')).toThrow(
      SuggestionApprovalUnavailableError,
    );
    // No task materialised, suggestion untouched.
    expect(db.select().from(tasks).all()).toHaveLength(0);
    const after = getSuggestion(db, suggestion.id);
    expect(after.status).toBe('pending');
    expect(after.approvedTaskId).toBeNull();
    expect(after.decidedAt).toBeNull();
  });

  it('cannot be enabled by environment, configuration, database values or caller options', () => {
    const db = testDb();
    const project = seedProject(db);
    const { suggestion } = addSuggestion(db, { projectId: project.id, title: 'still no' });

    const names = ['MAJOR_ENABLE_APPROVAL', 'MAJOR_ALLOW_APPROVE', 'MAJOR_UNSAFE'];
    const previous = names.map((n) => [n, process.env[n]] as const);
    for (const n of names) process.env[n] = '1';
    try {
      // Hostile caller options are ignored: the gate consults nothing.
      for (const note of [undefined, 'force', '']) {
        expect(() => approveSuggestion(db, suggestion.id, note)).toThrow(
          SuggestionApprovalUnavailableError,
        );
      }
      expect(db.select().from(tasks).all()).toHaveLength(0);
      expect(getSuggestion(db, suggestion.id).status).toBe('pending');
    } finally {
      for (const [n, v] of previous) {
        if (v === undefined) delete process.env[n];
        else process.env[n] = v;
      }
    }
  });
});

describe('suggestion materialisation via addTask (lower-level production API)', () => {
  it('refuses a task carrying a pending suggestionId before any write, and mutates nothing', () => {
    const db = testDb();
    const project = seedProject(db);
    const { suggestion } = addSuggestion(db, { projectId: project.id, title: 'materialise me' });

    // The exported production task-creation API must not be an alternate
    // suggestion-materialisation route: passing suggestion provenance refuses
    // at the same gate as approveSuggestion.
    expect(() =>
      addTask(db, {
        projectId: project.id,
        title: suggestion.title,
        suggestionId: suggestion.id,
      }),
    ).toThrow(SuggestionApprovalUnavailableError);

    // No task inserted…
    expect(db.select().from(tasks).all()).toHaveLength(0);
    // …suggestion still pending and unchanged (no approval/relationship record)…
    const after = getSuggestion(db, suggestion.id);
    expect(after.status).toBe('pending');
    expect(after.approvedTaskId).toBeNull();
    expect(after.decidedAt).toBeNull();
    // …and no task references the suggestion.
    expect(db.select().from(tasks).where(eq(tasks.suggestionId, suggestion.id)).all()).toHaveLength(
      0,
    );
    expect(
      db.select().from(taskSuggestions).where(eq(taskSuggestions.status, 'approved')).all(),
    ).toHaveLength(0);
  });

  it('cannot be enabled by environment, configuration, database values or caller options', () => {
    const db = testDb();
    const project = seedProject(db);
    const { suggestion } = addSuggestion(db, { projectId: project.id, title: 'still gated' });

    const names = ['MAJOR_ENABLE_APPROVAL', 'MAJOR_ALLOW_APPROVE', 'MAJOR_UNSAFE'];
    const previous = names.map((n) => [n, process.env[n]] as const);
    for (const n of names) process.env[n] = '1';
    try {
      expect(() =>
        addTask(db, {
          projectId: project.id,
          title: suggestion.title,
          suggestionId: suggestion.id,
          complexity: 'complex',
        }),
      ).toThrow(SuggestionApprovalUnavailableError);
      expect(db.select().from(tasks).all()).toHaveLength(0);
      expect(getSuggestion(db, suggestion.id).status).toBe('pending');
    } finally {
      for (const [n, v] of previous) {
        if (v === undefined) delete process.env[n];
        else process.env[n] = v;
      }
    }
  });

  it('retained foundation contract: ordinary tasks without suggestion provenance still work', () => {
    const db = testDb();
    const project = seedProject(db);
    // A plain human-created task is unaffected.
    const task = addTask(db, { projectId: project.id, title: 'ordinary work' });
    expect(task.status).toBe('draft');
    expect(task.suggestionId).toBeNull();
    expect(db.select().from(tasks).all()).toHaveLength(1);
  });
});

describe('roadmap application surface', () => {
  it('refuses apply and reconcile without consulting the adapter', async () => {
    const db = testDb();
    const adapter = new MockSheetsAdapter([{ stableId: 'RM-1', values: { Status: 'Todo' } }]);
    await expect(applyRoadmapUpdate(db, adapter, 'rupd_any')).rejects.toThrow(
      CapabilityUnavailableError,
    );
    await expect(reconcileRoadmapApplies(db, adapter)).rejects.toThrow(CapabilityUnavailableError);
  });
});

describe('configuration overrides grant nothing', () => {
  it('a registry file cannot make billing spendable or declare capabilities', () => {
    const dir = mkdtempSync(join(tmpdir(), 'major-reg-'));
    const path = join(dir, 'model-registry.json');
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        // hostile extras: ignored by the schema, never consulted by the gate
        capabilities: { 'live-agent-execution': { available: true } },
        entries: [
          {
            provider: 'claude-code',
            knownModels: ['opus'],
            rules: [{ match: 'opus', routingClass: 'opus', billingMode: 'subscription_included' }],
          },
        ],
      }),
    );
    const registry = loadModelRegistry(path);
    const models = registryModels(registry, 'claude-code', {
      visible: true,
      authenticated: true,
    });
    // configuration is an expectation, never billing evidence: still unknown,
    // therefore unroutable
    expect(models[0]?.billingMode).toBe('unknown');
    expect(
      route({ purpose: 'implementation', complexity: 'bounded' }, [
        { name: 'claude-code', installed: true, authenticated: true, models },
      ]).kind,
    ).toBe('checkpoint');
    // and the capability gate is untouched by anything the file declared
    for (const cap of ALL_FIVE) expect(isCapabilityAvailable(cap)).toBe(false);
  });

  it('environment variables cannot open any gate', () => {
    const names = [
      'MAJOR_ENABLE_LIVE_EXECUTION',
      'MAJOR_ALLOW_PAID',
      'MAJOR_CAPABILITIES',
      'MAJOR_UNSAFE',
    ];
    const previous = names.map((n) => [n, process.env[n]] as const);
    for (const n of names) process.env[n] = '1';
    try {
      for (const cap of ALL_FIVE) {
        expect(() => assertCapabilityAvailable(cap)).toThrow(CapabilityUnavailableError);
      }
    } finally {
      for (const [n, v] of previous) {
        if (v === undefined) delete process.env[n];
        else process.env[n] = v;
      }
    }
  });
});

import { linkSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
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
import { executeMajorCommand } from '../src/security/major-gateway.js';
import {
  currentActivationState,
  issueStagedValidationLease,
} from '../src/security/staged-validation.js';
import { configureProjectPolicy } from '../src/supervisor/policy.js';
import { authorizeSessionWorkshop, resolveProjectForCwd } from '../src/supervisor/state.js';
import {
  allowGuestMutationForHost,
  mutationWorkspaceHashForHost,
} from '../src/supervisor/worker.js';
import { seedProject, testDb } from './helpers.js';

const ALL_FIVE: Capability[] = [
  'live-agent-execution',
  'paid-provider-execution',
  'automated-task-completion',
  'worker-owned-downstream-mutations',
  'external-roadmap-application',
];

describe('the v0.5.2 capability gate', () => {
  it('does not impose the Codex source-tree digest on Claude or Cursor mutation', () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'major-mutation-hash-')));
    try {
      const source = join(root, 'source.txt');
      writeFileSync(source, 'shared inode');
      linkSync(source, join(root, 'hard-link.txt'));
      expect(mutationWorkspaceHashForHost('claude', root, true)).toBeUndefined();
      expect(mutationWorkspaceHashForHost('cursor', root, true)).toBeUndefined();
      expect(() => mutationWorkspaceHashForHost('codex', root, true)).toThrow(/hard link/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('keeps all five build capabilities frozen and available', () => {
    expect(Object.keys(CAPABILITY_DEFINITIONS).sort()).toEqual([...ALL_FIVE].sort());
    expect(Object.isFrozen(CAPABILITY_DEFINITIONS)).toBe(true);
    for (const capability of ALL_FIVE) {
      expect(Object.isFrozen(CAPABILITY_DEFINITIONS[capability])).toBe(true);
    }
    // live-agent-execution now gates core isolated-runner safety only (verified:
    // containment, credential broker, guest isolation, release integrity). It
    // is deliberately independent of any single provider's field-test outcome
    // — that per-provider health lives in src/doctor/readiness.ts instead.
    for (const capability of ALL_FIVE) {
      expect(isCapabilityAvailable(capability)).toBe(true);
      expect(() => assertCapabilityAvailable(capability)).not.toThrow();
    }
  });

  it('reports live-agent-execution as core-runner activated, not provider-gated', () => {
    const statuses = capabilityStatuses();
    expect(statuses.map((status) => status.capability).sort()).toEqual([...ALL_FIVE].sort());
    const liveAgentExecution = statuses.find(
      (status) => status.capability === 'live-agent-execution',
    );
    expect(liveAgentExecution?.available).toBe(true);
    expect(liveAgentExecution?.reason).toMatch(/per-provider/);
    expect(statuses.every((status) => status.available)).toBe(true);
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

  it('recognizes owner-approved Workshop authority while live-agent-execution is active', () => {
    expect(isCapabilityAvailable('live-agent-execution')).toBe(true);
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'major-workshop-live-')));
    spawnSync('git', ['init', '--initial-branch=main', root], { encoding: 'utf8' });
    const prior = {
      home: process.env.MAJOR_HOME,
      state: process.env.MAJOR_STATE_PATH,
      policy: process.env.MAJOR_POLICY_PATH,
      stop: process.env.MAJOR_STOP_PATH,
    };
    process.env.MAJOR_HOME = join(root, '.major-test');
    process.env.MAJOR_STATE_PATH = join(root, 'state.json');
    process.env.MAJOR_POLICY_PATH = join(root, 'policy.json');
    process.env.MAJOR_STOP_PATH = join(root, 'STOP');
    try {
      const project = resolveProjectForCwd(root)!;
      configureProjectPolicy({
        project: project.project,
        repoPath: project.repoPath,
        projectClass: 'workshop',
        trust: 'build',
        ownerApprovedBuild: true,
      });
      expect(allowGuestMutationForHost('codex', root)).toBe(false);
      authorizeSessionWorkshop({
        host: 'codex',
        cwd: root,
        project: project.project,
        repoPath: project.repoPath,
        sessionId: 'thread-live-123',
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(allowGuestMutationForHost('codex', root)).toBe(true);
      expect(allowGuestMutationForHost('antigravity', root)).toBe(false);
      expect(() =>
        executeMajorCommand({
          executable: 'codex',
          args: ['exec'],
          cwd: root,
          allowedRoots: [root],
          providerRequest: {
            host: 'codex',
            prompt: 'read package.json',
            allowGuestMutation: false,
            approvalAuthority: { decisions: [] },
          },
        }),
      ).toThrow(/supervised Workshop provider execution requires a worker resource lease/);
    } finally {
      for (const [name, value] of Object.entries(prior)) {
        const key =
          name === 'home'
            ? 'MAJOR_HOME'
            : name === 'state'
              ? 'MAJOR_STATE_PATH'
              : name === 'policy'
                ? 'MAJOR_POLICY_PATH'
                : 'MAJOR_STOP_PATH';
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  it('retires the pre-activation staged-validation bridge now that core-runner safety is active', () => {
    // Staged validation was a bootstrap: prove the isolated runner safe BEFORE
    // live-agent-execution could be turned on. Now that it is on, issuing a
    // new staged lease must refuse immediately — real execution goes through
    // the normal supervised path instead. Historical leases from before
    // activation remain untouched (append-only; see tests/staged-validation.test.ts).
    expect(() =>
      issueStagedValidationLease(testDb(), {
        releaseRepository: '/release/project-baracks',
        releaseSourceCheckout: '/tmp/does-not-matter',
        releaseRoot: process.cwd(),
        releaseBranch: 'main',
        releaseSha: 'a'.repeat(40),
        releaseTreeHash: 'b'.repeat(64),
        releaseManifestHash: 'c'.repeat(64),
        provider: 'codex',
        projectIdentityHash: 'd'.repeat(64),
        projectRootHash: 'e'.repeat(64),
        caseId: 'provider-field',
        requestDigest: 'f'.repeat(64),
        expectedEvidenceHash: '0'.repeat(64),
        expectedExecutionStatus: 'succeeded',
        validationNonce: '11111111-1111-4111-8111-111111111111',
        workerId: 'w',
        processNonce: 'n',
        resourceLeaseId: 'r',
        leaseMs: 60_000,
      }),
    ).toThrow(/unavailable after supervised activation/);
    expect(currentActivationState(testDb())).toBe('supervised');
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
        // Deliberately claims the OPPOSITE of the real value below, so this
        // test fails loudly if config ever gains influence over the flag.
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

import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { runDoctor, type ExecutableResolver } from '../src/doctor/doctor.js';
import { MockProvider } from '../src/providers/mock.js';
import { detectContainment } from '../src/security/containment.js';
import { model } from './helpers.js';

// `runDoctor` now reports a Storage section derived from MAJOR_HOME. Point it at
// an empty directory: otherwise every doctor test walks the developer's real
// ~/.major (measured ~1.4s per call, which times these tests out under the
// parallel suite) and its result would vary by machine.
const storageHome = mkdtempSync(join(tmpdir(), 'major-doctor-home-'));
process.env.MAJOR_HOME = storageHome;
afterAll(() => rmSync(storageHome, { recursive: true, force: true }));

// Resolution-only: maps a tool NAME to a resolved path (presence signal). No
// process is ever run — the resolver only reports what is on PATH.
const fullToolchain: ExecutableResolver = (name) => {
  const paths: Record<string, string> = {
    pnpm: '/usr/local/bin/pnpm',
    git: '/usr/bin/git',
    gh: '/usr/local/bin/gh',
    tmux: '/usr/local/bin/tmux',
    caffeinate: '/usr/bin/caffeinate',
  };
  return paths[name];
};

function healthyProvider() {
  return new MockProvider({
    name: 'claude-code',
    installed: true,
    authenticated: true,
    version: '2.1.0',
    models: [model({ modelRef: 'sonnet' })],
  });
}

describe('major doctor', () => {
  const readyContainment = () => ({
    processTreeTermination: true,
    filesystemIsolation: true,
    networkIsolation: true,
    liveExecutionReady: true,
    detail: 'test containment enforced',
  });

  it('includes typed knowledge maintenance findings when records are supplied', async () => {
    const report = await runDoctor({
      providers: [],
      configuredProjects: [],
      resolve: fullToolchain,
      knowledgeRecords: [
        {
          id: 'fact',
          entityId: 'major',
          predicate: 'status',
          value: 'active',
          observedAt: '2026-01-01',
        },
      ],
      inspectKnowledge: (records) => [
        {
          kind: 'missing-provenance',
          ids: [records[0]!.id],
          repair: 'semantic-candidate',
          detail: 'evidence required',
        },
      ],
    });
    expect(report.knowledgeMaintenance).toEqual([
      expect.objectContaining({ repair: 'semantic-candidate', kind: 'missing-provenance' }),
    ]);
  });

  it('loads a bounded configured knowledge snapshot and leaves semantic findings non-mutating', async () => {
    const snapshot = join(storageHome, 'knowledge.json');
    const records = [
      {
        id: 'fact',
        entityId: 'major',
        predicate: 'status',
        value: 'active',
        observedAt: '2026-01-01',
      },
    ];
    writeFileSync(snapshot, JSON.stringify(records));
    const inspected: unknown[] = [];
    const report = await runDoctor({
      providers: [],
      configuredProjects: [],
      resolve: fullToolchain,
      env: { MAJOR_KNOWLEDGE_SNAPSHOT: snapshot },
      inspectKnowledge: (rows) => {
        inspected.push(...rows);
        return [
          {
            kind: 'missing-provenance',
            ids: ['fact'],
            repair: 'semantic-candidate',
            detail: 'evidence required',
          },
        ];
      },
    });
    expect(inspected).toEqual(records);
    expect(report.checks).toContainEqual(
      expect.objectContaining({ name: 'knowledge-source', status: 'ok' }),
    );
    expect(report.knowledgeMaintenance[0]).toMatchObject({ repair: 'semantic-candidate' });
    expect(JSON.parse(readFileSync(snapshot, 'utf8'))).toEqual(records);
  });

  it('reports malformed snapshots and throwing inspections without blocking doctor', async () => {
    const snapshot = join(storageHome, 'malformed-knowledge.json');
    writeFileSync(snapshot, JSON.stringify([{ id: 'only-an-id' }]));
    const malformed = await runDoctor({
      providers: [],
      configuredProjects: [],
      resolve: fullToolchain,
      env: { MAJOR_KNOWLEDGE_SNAPSHOT: snapshot },
    });
    expect(malformed.checks).toContainEqual(
      expect.objectContaining({ name: 'knowledge-source', status: 'warn' }),
    );

    const throwing = await runDoctor({
      providers: [],
      configuredProjects: [],
      resolve: fullToolchain,
      knowledgeRecords: [],
      inspectKnowledge: () => {
        throw new Error('bad inspector');
      },
    });
    expect(throwing.checks).toContainEqual(
      expect.objectContaining({ name: 'knowledge-inspection', status: 'warn' }),
    );
    expect(throwing.knowledgeMaintenance).toEqual([
      expect.objectContaining({ repair: 'semantic-candidate' }),
    ]);
  });

  it('keeps overnight execution unavailable without unattended policy and an explicit daemon', async () => {
    const report = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/creds.json' },
      fileExists: () => true,
    });
    // Foreground execution readiness does not grant background authority.
    expect(report.overnightExecution).toBe('unavailable');
    expect(report.overnightExecutionReasons.join()).toMatch(/unattended project policy/);
    expect(report.overnightExecutionReasons.join()).toMatch(/explicitly started daemon/);
    // The inspection/dry-run environment is separately reported as healthy.
    expect(report.inspectionEnvironmentOk).toBe(true);
    expect(report.inspectionEnvironmentIssues).toEqual([]);
    expect(report.missingPrerequisites).toEqual([]);
    expect(report.checks.find((c) => c.name === 'pnpm')?.status).toBe('ok');
    expect(report.providers[0]?.models[0]?.modelRef).toBe('sonnet');
    // A JSON report never contains a SAFE overnight verdict.
    expect(JSON.stringify(report)).not.toMatch(/"overnightExecution":"(safe|SAFE)"/);
  });

  it('reports all five build capabilities implemented (diagnostic; enforcement remains in code)', async () => {
    const report = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/creds.json' },
      fileExists: () => true,
    });
    expect(report.capabilities.map((c) => c.capability).sort()).toEqual([
      'automated-task-completion',
      'external-roadmap-application',
      'live-agent-execution',
      'paid-provider-execution',
      'worker-owned-downstream-mutations',
    ]);
    // live-agent-execution gates core isolated-runner safety only, not any
    // single provider's field-test outcome.
    expect(report.capabilities.every((c) => c.available)).toBe(true);
  });

  it('is foreground ready when core containment and at least one provider are both ready', async () => {
    const ready = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/creds.json' },
      fileExists: () => true,
      detectContainment: readyContainment,
    });
    expect(ready.core.ready).toBe(true);
    expect(ready.liveExecutionReady).toBe(true);
    expect(ready.liveExecution.healthyProviders).toEqual(['claude-code']);
    expect(ready.liveExecution.fallbackCount).toBe(0);
    expect(ready.multiProviderReady).toBe(false);

    const unavailable = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      detectContainment: () => ({
        processTreeTermination: false,
        filesystemIsolation: false,
        networkIsolation: false,
        liveExecutionReady: false,
        detail: 'no supported OS sandbox',
      }),
    });
    expect(unavailable.core.ready).toBe(false);
    expect(unavailable.liveExecutionReady).toBe(false);
    expect(unavailable.liveExecutionBlockers.join()).toMatch(
      /containment.*no supported OS sandbox/i,
    );
  });

  it('degrades to core-not-ready instead of crashing when the execution backend cannot be inspected', async () => {
    // A missing/malformed ~/.major/execution.json, or a stale limactl path,
    // throws before LimaBackend's own inspect() try/catch ever runs — the
    // fresh-machine and stale-config cases a friend hits before Lima is set
    // up. This must degrade gracefully, never crash major doctor/setup.
    const report = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      inspectExecutionBackend: () => {
        throw new Error('ENOENT: no such file or directory, open .major/execution.json');
      },
    });
    expect(report.core.ready).toBe(false);
    expect(report.core.issues.join()).toMatch(/execution backend unavailable/);
    expect(report.liveExecutionReady).toBe(false);
    // The rest of the report still comes back — providers, checks, etc.
    expect(report.providers[0]?.name).toBe('claude-code');
  });

  it('keeps one broken provider from blocking a healthy fallback provider', async () => {
    const broken = new MockProvider({
      name: 'cursor',
      installed: true,
      authenticated: false,
    });
    const report = await runDoctor({
      providers: [broken, healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      detectContainment: readyContainment,
    });
    expect(report.providerReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'cursor', state: 'AUTH_REQUIRED' }),
        expect.objectContaining({ provider: 'claude-code', state: 'READY' }),
      ]),
    );
    expect(report.liveExecutionReady).toBe(true);
    expect(report.liveExecution.healthyProviders).toEqual(['claude-code']);
  });

  it('keeps reporting healthy providers when one provider throws during discovery', async () => {
    const throwing = new MockProvider({
      name: 'antigravity',
      throwOnDiscover: new Error('probe-gateway allowlist is missing this executable'),
    });
    const report = await runDoctor({
      providers: [throwing, healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      detectContainment: readyContainment,
    });
    expect(report.checks.find((c) => c.name === 'provider:antigravity')).toMatchObject({
      status: 'missing',
      detail: expect.stringMatching(/discovery failed/),
    });
    expect(report.providerReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'antigravity', state: 'NOT_CONFIGURED' }),
        expect.objectContaining({ provider: 'claude-code', state: 'READY' }),
      ]),
    );
    expect(report.liveExecutionReady).toBe(true);
  });

  it('reports NOT_CONFIGURED for an uninstalled provider without touching others', async () => {
    const notConfigured = new MockProvider({ name: 'gemini', installed: false });
    const report = await runDoctor({
      providers: [notConfigured, healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      detectContainment: readyContainment,
    });
    expect(report.providerReadiness).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ provider: 'gemini', state: 'NOT_CONFIGURED' }),
        expect.objectContaining({ provider: 'claude-code', state: 'READY' }),
      ]),
    );
    expect(report.liveExecutionReady).toBe(true);
  });

  it('reports multiProviderReady only with more than one healthy provider', async () => {
    const codex = new MockProvider({
      name: 'codex',
      installed: true,
      authenticated: true,
      models: [model({ modelRef: 'gpt-5-codex', routingClass: 'codex' })],
    });
    const report = await runDoctor({
      providers: [healthyProvider(), codex],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      detectContainment: readyContainment,
    });
    expect(report.multiProviderReady).toBe(true);
    expect(report.multiProvider.healthyCount).toBe(2);
  });

  it('smoke-reports the real OS containment without rewriting its result', async () => {
    const real = detectContainment();
    const report = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
    });
    expect(report.checks.find((check) => check.name === 'descendant-containment')).toMatchObject({
      status: real.liveExecutionReady ? 'ok' : 'warn',
      detail: real.detail,
    });
  });

  it('flags missing prerequisites as an inspection-environment issue', async () => {
    const report = await runDoctor({
      providers: [new MockProvider({ name: 'codex', installed: false, authenticated: false })],
      configuredProjects: [],
      resolve: () => undefined,
      env: {},
    });
    expect(report.missingPrerequisites).toContain('pnpm');
    expect(report.missingPrerequisites).toContain('git');
    // Inspection/dry-run health reflects the missing prerequisites.
    expect(report.inspectionEnvironmentOk).toBe(false);
    expect(report.inspectionEnvironmentIssues.join()).toMatch(/missing prerequisites/);
    expect(report.inspectionEnvironmentIssues.join()).toMatch(/no projects configured/);
    // Overnight execution stays categorically unavailable, with the missing
    // environmental factors also listed.
    expect(report.overnightExecution).toBe('unavailable');
    expect(report.overnightExecutionReasons.join()).toMatch(/no verified\+authenticated/);
    expect(report.overnightExecutionReasons.join()).toMatch(/no projects configured/);
  });

  it('reports Google credentials without exposing secrets', async () => {
    const report = await runDoctor({
      providers: [],
      configuredProjects: [],
      resolve: fullToolchain,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/home/user/sa-creds.json' },
      fileExists: () => true,
    });
    const check = report.checks.find((c) => c.name === 'google-credentials');
    expect(check?.status).toBe('ok');
    expect(check?.detail).toMatch(/contents not read/);
    expect(JSON.stringify(report)).not.toContain('BEGIN PRIVATE KEY');
  });

  it('emits the compact Storage section fields', async () => {
    const report = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      collectStorage: () => ({
        diskUsedBytes: 80_000_000_000,
        diskPercentUsed: 66.7,
        diskFreeBytes: 40_000_000_000,
        majorPhysicalBytes: 3_300_000_000,
        workers: { active: 1, rollback: 1, credentialSource: 1, orphan: 2 },
        reclaimableBytes: 1_800_000_000,
        hygiene: 'ATTENTION',
      }),
    });
    expect(report.storage.hygiene).toBe('ATTENTION');
    expect(report.storage.workers).toEqual({
      active: 1,
      rollback: 1,
      credentialSource: 1,
      orphan: 2,
    });
    expect(report.storage.reclaimableBytes).toBe(1_800_000_000);
  });
});

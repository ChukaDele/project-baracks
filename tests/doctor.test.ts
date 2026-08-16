import { describe, expect, it } from 'vitest';
import { runDoctor, type ExecutableResolver } from '../src/doctor/doctor.js';
import { MockProvider } from '../src/providers/mock.js';
import { detectContainment } from '../src/security/containment.js';
import { model } from './helpers.js';

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
});

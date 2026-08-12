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

  it('reports the five activated capabilities (diagnostic; enforcement remains in code)', async () => {
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
    expect(report.capabilities.every((c) => c.available === true)).toBe(true);
  });

  it('reports foreground ready only when M1 and containment are both ready', async () => {
    const ready = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/creds.json' },
      fileExists: () => true,
      detectContainment: readyContainment,
    });
    expect(ready.liveExecutionReady).toBe(true);
    expect(ready.liveExecutionBlockers).toEqual([]);

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
    expect(unavailable.liveExecutionReady).toBe(false);
    expect(unavailable.liveExecutionBlockers.join()).toMatch(
      /containment.*no supported OS sandbox/i,
    );
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

import { describe, expect, it } from 'vitest';
import { runDoctor, type ExecutableResolver } from '../src/doctor/doctor.js';
import { MockProvider } from '../src/providers/mock.js';
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
  it('never reports overnight execution as safe, even in a healthy environment', async () => {
    const report = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/creds.json' },
      fileExists: () => true,
    });
    // Overnight/live execution is categorically unavailable regardless of a
    // healthy environment; live-agent-execution is a disabled capability.
    expect(report.overnightExecution).toBe('unavailable');
    expect(report.overnightExecutionReasons.join()).toMatch(/live agent execution is unavailable/);
    expect(report.overnightExecutionReasons.join()).toMatch(/M1/);
    // The inspection/dry-run environment is separately reported as healthy.
    expect(report.inspectionEnvironmentOk).toBe(true);
    expect(report.inspectionEnvironmentIssues).toEqual([]);
    expect(report.missingPrerequisites).toEqual([]);
    expect(report.checks.find((c) => c.name === 'pnpm')?.status).toBe('ok');
    expect(report.providers[0]?.models[0]?.modelRef).toBe('sonnet');
    // A JSON report never contains a SAFE overnight verdict.
    expect(JSON.stringify(report)).not.toMatch(/"overnightExecution":"(safe|SAFE)"/);
  });

  it('reports the five unavailable capabilities (diagnostic; enforcement is in code)', async () => {
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
    expect(report.capabilities.every((c) => c.available === false)).toBe(true);
  });

  it('reports live agent execution as not ready while the reviewed capability gate is closed', async () => {
    const report = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      resolve: fullToolchain,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/creds.json' },
      fileExists: () => true,
    });
    expect(report.liveExecutionReady).toBe(false);
    expect(report.liveExecutionBlockers.join()).toMatch(/capability.*M1/i);
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

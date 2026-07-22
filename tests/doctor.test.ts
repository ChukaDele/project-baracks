import { describe, expect, it } from 'vitest';
import { runDoctor, type CommandRunner } from '../src/doctor/doctor.js';
import { MockProvider } from '../src/providers/mock.js';
import { model } from './helpers.js';

const fullToolchain: CommandRunner = (executable) => {
  const outputs: Record<string, string> = {
    pnpm: '10.14.0',
    git: 'git version 2.50.1',
    gh: 'gh version 2.95.0',
    tmux: 'tmux 3.4',
    which: '/usr/bin/caffeinate',
  };
  return outputs[executable];
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
  it('reports a healthy environment as overnight-safe', async () => {
    const report = await runDoctor({
      providers: [healthyProvider()],
      configuredProjects: [{ name: 'demo', repoPath: '/tmp/demo' }],
      run: fullToolchain,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/tmp/creds.json' },
      fileExists: () => true,
    });
    expect(report.overnightSafe).toBe(true);
    expect(report.missingPrerequisites).toEqual([]);
    expect(report.checks.find((c) => c.name === 'pnpm')?.status).toBe('ok');
    expect(report.providers[0]?.models[0]?.modelRef).toBe('sonnet');
  });

  it('flags missing prerequisites and unsafe overnight execution', async () => {
    const report = await runDoctor({
      providers: [new MockProvider({ name: 'codex', installed: false, authenticated: false })],
      configuredProjects: [],
      run: () => undefined,
      env: {},
    });
    expect(report.missingPrerequisites).toContain('pnpm');
    expect(report.missingPrerequisites).toContain('git');
    expect(report.overnightSafe).toBe(false);
    expect(report.overnightSafeReasons.join()).toMatch(/no installed\+authenticated/);
    expect(report.overnightSafeReasons.join()).toMatch(/no projects configured/);
  });

  it('reports Google credentials without exposing secrets', async () => {
    const report = await runDoctor({
      providers: [],
      configuredProjects: [],
      run: fullToolchain,
      env: { GOOGLE_APPLICATION_CREDENTIALS: '/home/user/sa-creds.json' },
      fileExists: () => true,
    });
    const check = report.checks.find((c) => c.name === 'google-credentials');
    expect(check?.status).toBe('ok');
    expect(check?.detail).toMatch(/contents not read/);
    expect(JSON.stringify(report)).not.toContain('BEGIN PRIVATE KEY');
  });
});

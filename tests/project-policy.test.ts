import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  clearGlobalStop,
  configureProjectPolicy,
  defaultProjectPolicy,
  getProjectPolicy,
  globalStopRequested,
  recordIndependentGrade,
  recordShadowGrade,
  requestGlobalStop,
} from '../src/supervisor/policy.js';

let root = '';
let priorPolicyPath: string | undefined;
let priorStopPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-policy-'));
  priorPolicyPath = process.env.MAJOR_POLICY_PATH;
  priorStopPath = process.env.MAJOR_STOP_PATH;
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
  process.env.MAJOR_STOP_PATH = join(root, 'STOP');
});

afterEach(() => {
  if (priorPolicyPath === undefined) delete process.env.MAJOR_POLICY_PATH;
  else process.env.MAJOR_POLICY_PATH = priorPolicyPath;
  if (priorStopPath === undefined) delete process.env.MAJOR_STOP_PATH;
  else process.env.MAJOR_STOP_PATH = priorStopPath;
  rmSync(root, { recursive: true, force: true });
});

function earnAssist(project = 'jss-tool', repoPath = '/tmp/jss-tool') {
  configureProjectPolicy({
    project,
    repoPath,
    projectClass: 'workshop',
    trust: 'observe',
  });
  for (let i = 0; i < 3; i++) {
    recordShadowGrade({
      project,
      repoPath,
      planner: 'codex',
      provider: 'claude',
      result: 'pass',
      evidence: `shadow ${i + 1} matched the real task path`,
      goalId: 'goal-1',
    });
  }
  return configureProjectPolicy({
    project,
    repoPath,
    projectClass: 'workshop',
    trust: 'assist',
  });
}

describe('Major project trust policy', () => {
  it('clamps a legacy persisted worker claim to the current runtime ceiling', () => {
    const legacy = defaultProjectPolicy('legacy', '/tmp/legacy');
    writeFileSync(
      process.env.MAJOR_POLICY_PATH!,
      JSON.stringify({
        version: 1,
        projects: [{ ...legacy, trust: 'build', maxWorkers: 6, ownerApprovedBuild: true }],
      }),
    );
    expect(getProjectPolicy('legacy', '/tmp/legacy').maxWorkers).toBe(1);
  });

  it('defaults unknown projects to observe-only with zero delegated workers', () => {
    const policy = defaultProjectPolicy('surface-talent', '/tmp/surface-talent');
    expect(policy.projectClass).toBe('unknown');
    expect(policy.trust).toBe('observe');
    expect(policy.maxWorkers).toBe(0);
    expect(policy.allowBackground).toBe(false);
    expect(policy.allowCrossProjectMemory).toBe(false);
    expect(policy.allowPaidSpend).toBe(false);
    expect(policy.ownerApprovedBuild).toBe(false);
  });

  it('supports the evidence-earned assist path', () => {
    const policy = earnAssist();
    expect(policy.maxWorkers).toBe(1);
    expect(policy.maxRunMinutes).toBe(30);
    expect(policy.allowBackground).toBe(false);
    expect(policy.allowExternalWrites).toBe(false);
    expect(policy.allowPaidSpend).toBe(false);
    expect(getProjectPolicy('jss-tool', '/tmp/jss-tool').trust).toBe('assist');
  });

  it('allows the owner to fast-track a project directly to foreground build mode', () => {
    const policy = configureProjectPolicy({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
      allowExternalWrites: true,
    });
    expect(policy.trust).toBe('build');
    expect(policy.ownerApprovedBuild).toBe(true);
    expect(policy.maxWorkers).toBe(1);
    expect(policy.maxRunMinutes).toBe(120);
    expect(policy.allowBackground).toBe(false);
    expect(policy.allowExternalWrites).toBe(true);
    expect(policy.allowPaidSpend).toBe(false);
    expect(policy.allowCrossProjectMemory).toBe(true);
  });

  it('keeps client knowledge isolated even when owner-approved for build work', () => {
    const policy = configureProjectPolicy({
      project: 'surface-talent',
      repoPath: '/tmp/surface-talent',
      projectClass: 'client',
      trust: 'build',
      ownerApprovedBuild: true,
      allowExternalWrites: true,
    });
    expect(policy.trust).toBe('build');
    expect(policy.maxWorkers).toBe(1);
    expect(policy.allowExternalWrites).toBe(true);
    expect(policy.allowCrossProjectMemory).toBe(false);
    expect(policy.allowPaidSpend).toBe(false);
  });

  it('still requires a fresh independent build-mode grade before unattended promotion', () => {
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });

    expect(() =>
      configureProjectPolicy({
        project: 'jss-tool',
        repoPath: '/tmp/jss-tool',
        projectClass: 'workshop',
        trust: 'unattended',
      }),
    ).toThrow(/fresh independent execution grade/);

    recordIndependentGrade({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      provider: 'codex',
      result: 'pass',
      evidence: 'Independent review of a representative build-mode run passed.',
      goalId: 'goal-1',
    });

    const unattended = configureProjectPolicy({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      projectClass: 'workshop',
      trust: 'unattended',
    });
    expect(unattended.maxWorkers).toBe(1);
    expect(unattended.allowBackground).toBe(true);
  });

  it('retains the evidence-based promotion path when owner approval is not used', () => {
    earnAssist();

    expect(() =>
      configureProjectPolicy({
        project: 'jss-tool',
        repoPath: '/tmp/jss-tool',
        projectClass: 'workshop',
        trust: 'build',
      }),
    ).toThrow(/independent execution grade/);

    recordIndependentGrade({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      provider: 'claude',
      result: 'pass',
      evidence: 'Independent review of the representative assist run passed.',
      goalId: 'goal-1',
    });

    const built = configureProjectPolicy({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      projectClass: 'workshop',
      trust: 'build',
    });
    expect(built.maxWorkers).toBe(1);
    expect(built.allowBackground).toBe(false);
  });

  it('provides a global kill switch that can be cleared explicitly', () => {
    expect(globalStopRequested()).toBe(false);
    requestGlobalStop('test');
    expect(globalStopRequested()).toBe(true);
    clearGlobalStop();
    expect(globalStopRequested()).toBe(false);
  });
});

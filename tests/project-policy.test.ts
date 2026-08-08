import { mkdtempSync, rmSync } from 'node:fs';
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

describe('Major project trust policy', () => {
  it('defaults unknown projects to observe-only with zero delegated workers', () => {
    const policy = defaultProjectPolicy('surface-talent', '/tmp/surface-talent');
    expect(policy.projectClass).toBe('unknown');
    expect(policy.trust).toBe('observe');
    expect(policy.maxWorkers).toBe(0);
    expect(policy.allowBackground).toBe(false);
    expect(policy.allowCrossProjectMemory).toBe(false);
  });

  it('supports a foreground assist pilot with a three-worker ceiling', () => {
    const policy = configureProjectPolicy({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      projectClass: 'workshop',
      trust: 'assist',
    });
    expect(policy.maxWorkers).toBe(3);
    expect(policy.allowBackground).toBe(false);
    expect(getProjectPolicy('jss-tool', '/tmp/jss-tool').trust).toBe('assist');
  });

  it('keeps client projects isolated from cross-project memory by default', () => {
    const policy = configureProjectPolicy({
      project: 'surface-talent',
      repoPath: '/tmp/surface-talent',
      projectClass: 'client',
      trust: 'assist',
    });
    expect(policy.allowCrossProjectMemory).toBe(false);
    expect(policy.allowExternalWrites).toBe(false);
  });

  it('requires a passing independent grade before build/unattended promotion', () => {
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      projectClass: 'workshop',
      trust: 'assist',
    });

    expect(() =>
      configureProjectPolicy({
        project: 'jss-tool',
        repoPath: '/tmp/jss-tool',
        projectClass: 'workshop',
        trust: 'build',
      }),
    ).toThrow(/passing independent grade/);

    recordIndependentGrade({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      provider: 'claude',
      result: 'pass',
      evidence: 'Independent read-only review of exact head and real JSS output passed.',
      goalId: 'goal-1',
    });

    const promoted = configureProjectPolicy({
      project: 'jss-tool',
      repoPath: '/tmp/jss-tool',
      projectClass: 'workshop',
      trust: 'build',
    });
    expect(promoted.maxWorkers).toBe(6);
    expect(promoted.allowBackground).toBe(false);
  });

  it('provides a global kill switch that can be cleared explicitly', () => {
    expect(globalStopRequested()).toBe(false);
    requestGlobalStop('test');
    expect(globalStopRequested()).toBe(true);
    clearGlobalStop();
    expect(globalStopRequested()).toBe(false);
  });
});

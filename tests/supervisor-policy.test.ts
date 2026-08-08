import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  configureProjectPolicy,
  getProjectPolicy,
  recordIndependentGrade,
  recordShadowGrade,
} from '../src/supervisor/policy.js';

let root = '';
let priorPolicyPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-policy-'));
  priorPolicyPath = process.env.MAJOR_POLICY_PATH;
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
});

afterEach(() => {
  if (priorPolicyPath === undefined) delete process.env.MAJOR_POLICY_PATH;
  else process.env.MAJOR_POLICY_PATH = priorPolicyPath;
  rmSync(root, { recursive: true, force: true });
});

describe('Major trust ramp', () => {
  it('defaults to observe with no execution/spend/external-write authority', () => {
    const policy = getProjectPolicy('jss-tool', root);
    expect(policy.trust).toBe('observe');
    expect(policy.maxWorkers).toBe(0);
    expect(policy.allowBackground).toBe(false);
    expect(policy.allowExternalWrites).toBe(false);
    expect(policy.allowPaidSpend).toBe(false);
    expect(policy.allowCrossProjectMemory).toBe(false);
  });

  it('requires three consecutive independent shadow passes before assist', () => {
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath: root,
      projectClass: 'workshop',
      trust: 'observe',
    });

    expect(() =>
      configureProjectPolicy({
        project: 'jss-tool',
        repoPath: root,
        projectClass: 'workshop',
        trust: 'assist',
      }),
    ).toThrow(/three consecutive/);

    recordShadowGrade({
      project: 'jss-tool',
      repoPath: root,
      planner: 'codex',
      provider: 'claude',
      result: 'pass',
      evidence: 'shadow 1',
    });
    recordShadowGrade({
      project: 'jss-tool',
      repoPath: root,
      planner: 'codex',
      provider: 'claude',
      result: 'pass',
      evidence: 'shadow 2',
    });
    recordShadowGrade({
      project: 'jss-tool',
      repoPath: root,
      planner: 'codex',
      provider: 'claude',
      result: 'fail',
      evidence: 'shadow 3 found a bad dispatch',
    });
    expect(getProjectPolicy('jss-tool', root).shadowPasses).toBe(0);

    for (let i = 0; i < 3; i++) {
      recordShadowGrade({
        project: 'jss-tool',
        repoPath: root,
        planner: 'codex',
        provider: 'claude',
        result: 'pass',
        evidence: `clean shadow ${i + 1}`,
      });
    }

    const assisted = configureProjectPolicy({
      project: 'jss-tool',
      repoPath: root,
      projectClass: 'workshop',
      trust: 'assist',
    });
    expect(assisted.maxWorkers).toBe(3);
    expect(assisted.maxRunMinutes).toBe(30);
    expect(assisted.allowBackground).toBe(false);
    expect(assisted.allowPaidSpend).toBe(false);
  });

  it('refuses self-grading and requires independent execution evidence for build', () => {
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath: root,
      projectClass: 'workshop',
      trust: 'observe',
    });
    expect(() =>
      recordShadowGrade({
        project: 'jss-tool',
        repoPath: root,
        planner: 'claude',
        provider: 'claude',
        result: 'pass',
        evidence: 'self grade',
      }),
    ).toThrow(/independent/);

    for (let i = 0; i < 3; i++) {
      recordShadowGrade({
        project: 'jss-tool',
        repoPath: root,
        planner: 'codex',
        provider: 'claude',
        result: 'pass',
        evidence: `shadow ${i + 1}`,
      });
    }
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath: root,
      projectClass: 'workshop',
      trust: 'assist',
    });
    expect(() =>
      configureProjectPolicy({
        project: 'jss-tool',
        repoPath: root,
        projectClass: 'workshop',
        trust: 'build',
      }),
    ).toThrow(/independent execution grade/);

    recordIndependentGrade({
      project: 'jss-tool',
      repoPath: root,
      provider: 'claude',
      result: 'pass',
      evidence: 'representative assist run passed real-output review',
    });
    expect(
      configureProjectPolicy({
        project: 'jss-tool',
        repoPath: root,
        projectClass: 'workshop',
        trust: 'build',
      }).trust,
    ).toBe('build');
  });
});

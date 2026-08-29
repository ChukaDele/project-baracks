import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { testDb, canonicalGradeProvenance } from './helpers.js';
import {
  configureProjectPolicy,
  getProjectPolicy,
  recordIndependentGrade,
  recordShadowGrade,
} from '../src/supervisor/policy.js';

let root = '';
let priorPolicyPath: string | undefined;
let db: ReturnType<typeof testDb>;

function shadowProvenance(id: string) {
  return canonicalGradeProvenance(db, { id, project: 'jss-tool' });
}

function executionProvenance(id: string) {
  return canonicalGradeProvenance(db, { id, project: 'jss-tool' });
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-policy-'));
  db = testDb();
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
      ...shadowProvenance('first'),
      result: 'pass',
      evidence: 'shadow 1',
    });
    recordShadowGrade({
      project: 'jss-tool',
      repoPath: root,
      planner: 'codex',
      provider: 'claude',
      ...shadowProvenance('second'),
      result: 'pass',
      evidence: 'shadow 2',
    });
    recordShadowGrade({
      project: 'jss-tool',
      repoPath: root,
      planner: 'codex',
      provider: 'claude',
      ...shadowProvenance('failed'),
      result: 'fail',
      evidence: 'shadow 3 found a bad dispatch',
    });
    expect(getProjectPolicy('jss-tool', root).shadowPasses).toBe(0);

    for (let i = 0; i < 3; i++) {
      recordShadowGrade({
        project: 'jss-tool',
        repoPath: root,
        planner: 'claude',
        provider: 'claude',
        ...shadowProvenance(`clean-${i}`),
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
    expect(assisted.maxWorkers).toBe(1);
    expect(assisted.maxRunMinutes).toBe(30);
    expect(assisted.allowBackground).toBe(false);
    expect(assisted.allowPaidSpend).toBe(false);
  });

  it('refuses self-execution grading and accepts same-provider independent execution', () => {
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath: root,
      projectClass: 'workshop',
      trust: 'observe',
    });
    expect(() =>
      recordShadowGrade({
        db,
        project: 'jss-tool',
        repoPath: root,
        planner: 'claude',
        provider: 'claude',
        providerAccountLabel: 'review',
        reviewExecutionId: 'same-execution',
        plannerExecutionId: 'same-execution',
        result: 'pass',
        evidence: 'self grade',
      }),
    ).toThrow(/independent/);
    expect(() =>
      recordShadowGrade({
        db,
        project: 'jss-tool',
        repoPath: root,
        planner: 'claude',
        provider: 'claude',
        providerAccountLabel: ' ',
        reviewExecutionId: 'review-accountless',
        plannerExecutionId: 'plan-accountless',
        result: 'pass',
        evidence: 'missing account provenance',
      }),
    ).toThrow(/account provenance/);
    expect(() =>
      recordShadowGrade({
        db,
        project: 'jss-tool',
        repoPath: root,
        planner: 'codex',
        provider: 'claude',
        providerAccountLabel: 'review',
        reviewExecutionId: 'invented-review-run',
        plannerExecutionId: 'invented-worker-run',
        result: 'pass',
        evidence: 'caller-supplied identifiers are not authority',
      }),
    ).toThrow(/canonical succeeded reviewed and review runs/);

    for (let i = 0; i < 3; i++) {
      recordShadowGrade({
        project: 'jss-tool',
        repoPath: root,
        planner: 'codex',
        provider: 'claude',
        ...shadowProvenance(`build-${i}`),
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
      reviewedProvider: 'claude',
      ...executionProvenance('assist'),
      result: 'pass',
      evidence: 'representative assist run passed real-output review',
      goalId: 'goal-assist',
    });
    expect(getProjectPolicy('jss-tool', root).lastGrade).toMatchObject({
      provider: 'claude',
      reviewedProvider: 'claude',
      providerAccountLabel: 'review',
    });
    expect(getProjectPolicy('jss-tool', root).lastGrade?.reviewExecutionId).toMatch(/^arun_/);
    expect(getProjectPolicy('jss-tool', root).lastGrade?.reviewedExecutionId).toMatch(/^arun_/);
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

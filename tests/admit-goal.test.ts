import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { admitGoal, getGoal, updateGoal } from '../src/supervisor/state.js';
import { assessSupervisorAdmissionRisk } from '../src/supervisor/worker-report.js';

let root = '';
let priorStatePath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-admit-goal-'));
  priorStatePath = process.env.MAJOR_STATE_PATH;
  process.env.MAJOR_STATE_PATH = join(root, 'state.json');
});

afterEach(() => {
  if (priorStatePath === undefined) delete process.env.MAJOR_STATE_PATH;
  else process.env.MAJOR_STATE_PATH = priorStatePath;
  rmSync(root, { recursive: true, force: true });
});

function fakeRepo(name = 'jss-tool'): string {
  const repo = join(root, name);
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(
    join(repo, '.git', 'config'),
    `[remote "origin"]\n\turl = https://github.com/chukadele/${name}.git\n`,
  );
  return repo;
}

describe('admitGoal', () => {
  const policy = {
    projectClass: 'workshop' as const,
    trust: 'build' as const,
    allowExternalWrites: false,
    allowPaidSpend: false,
  };

  it('creates a fresh goal when none exists for the project', () => {
    const repoPath = fakeRepo();
    const { goal, created } = admitGoal({
      project: 'jss-tool',
      repoPath,
      outcome: 'Ship the MVP',
      refine: false,
    });
    expect(created).toBe(true);
    expect(goal.goal).toBe('Ship the MVP');
    expect(goal.status).toBe('active');
  });

  it('resumes without overwriting the outcome when refine is not set', () => {
    const repoPath = fakeRepo();
    const first = admitGoal({
      project: 'jss-tool',
      repoPath,
      outcome: 'Ship the MVP',
      refine: false,
    });
    const second = admitGoal({
      project: 'jss-tool',
      repoPath,
      outcome: 'edit the ranking component',
      refine: false,
    });
    expect(second.created).toBe(false);
    expect(second.goal.id).toBe(first.goal.id);
    expect(second.goal.goal).toBe('Ship the MVP');
  });

  it('overwrites the outcome only when refine is explicitly set', () => {
    const repoPath = fakeRepo();
    admitGoal({ project: 'jss-tool', repoPath, outcome: 'Ship the MVP', refine: false });
    const refined = admitGoal({
      project: 'jss-tool',
      repoPath,
      outcome: 'Redesign the onboarding flow instead',
      admissionRiskAssessment: assessSupervisorAdmissionRisk({
        outcome: 'Redesign the onboarding flow instead',
        policy,
      }),
      refine: true,
    });
    expect(refined.goal.goal).toBe('Redesign the onboarding flow instead');
    expect(refined.goal.admissionRiskAssessment?.classification).toBe('substantive');
    expect(refined.goal.promotionContract?.review).toBe('focused');
  });

  it('never resets status, ownerGate, pendingCompletion, or retryImmediately on reuse', () => {
    const repoPath = fakeRepo();
    const { goal } = admitGoal({
      project: 'jss-tool',
      repoPath,
      outcome: 'Ship the MVP',
      refine: false,
    });
    updateGoal(goal.id, {
      status: 'blocked',
      ownerGate: 'MFA required',
      retryImmediately: true,
      pendingCompletion: { summary: 'claimed done', coordinator: 'codex', claimedAt: 'x' },
    });
    const resumed = admitGoal({
      project: 'jss-tool',
      repoPath,
      outcome: 'Ship the MVP',
      refine: false,
    });
    expect(resumed.created).toBe(false);
    const after = getGoal(goal.id)!;
    // An ambient admission call is not a deliberate goal redefinition: it
    // must not silently unblock a legitimately blocked goal, discard an
    // owner gate, or clobber an in-flight capacity-rotation flag.
    expect(after.status).toBe('blocked');
    expect(after.ownerGate).toBe('MFA required');
    expect(after.retryImmediately).toBe(true);
    expect(after.pendingCompletion).toMatchObject({ summary: 'claimed done' });
  });
});

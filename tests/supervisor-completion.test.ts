import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyIndependentCompletionGrade,
  readSupervisorState,
  writeSupervisorState,
  type SupervisorGoal,
} from '../src/supervisor/state.js';
import { codexMutationClaimRefusal } from '../src/supervisor/runtime.js';
import type { WorkerReport } from '../src/supervisor/worker-report.js';

let root: string;
let priorStatePath: string | undefined;

function pendingGoal(): SupervisorGoal {
  return {
    id: 'goal-1',
    project: 'major',
    repoPath: root,
    goal: 'Prove the release candidate end to end',
    autonomous: false,
    status: 'active',
    preferredCoordinator: 'codex',
    cycle: 1,
    consecutiveFailures: 0,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:01:00.000Z',
    lastCoordinator: 'codex',
    lastSummary: 'Worker completion claim awaiting independent validation: all checks pass',
    pendingCompletion: {
      summary: 'all checks pass',
      coordinator: 'codex',
      claimedAt: '2026-08-11T00:01:00.000Z',
    },
  };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-completion-'));
  priorStatePath = process.env.MAJOR_STATE_PATH;
  process.env.MAJOR_STATE_PATH = join(root, 'supervisor-state.json');
  writeSupervisorState({ version: 1, goals: [pendingGoal()], sessions: [] });
});

afterEach(() => {
  if (priorStatePath === undefined) delete process.env.MAJOR_STATE_PATH;
  else process.env.MAJOR_STATE_PATH = priorStatePath;
  rmSync(root, { recursive: true, force: true });
});

describe('independent goal completion', () => {
  it('rejects Codex BUILT and completion claims when Lima observed no returned delta', () => {
    const done: WorkerReport = { status: 'done', summary: 'acceptance task passed' };
    const built: WorkerReport = { status: 'active', summary: 'BUILT provider route' };
    expect(codexMutationClaimRefusal({ host: 'codex', workspaceMutated: false }, done)).toMatch(
      /observed no project delta/,
    );
    expect(codexMutationClaimRefusal({ host: 'codex', workspaceMutated: false }, built)).toMatch(
      /observed no project delta/,
    );
  });

  it('does not invent mutation evidence or reject non-Codex and non-claim reports', () => {
    const done: WorkerReport = { status: 'done', summary: 'acceptance task passed' };
    const active: WorkerReport = { status: 'active', summary: 'inspection complete' };
    expect(codexMutationClaimRefusal({ host: 'codex' }, done)).toBeUndefined();
    expect(
      codexMutationClaimRefusal({ host: 'claude', workspaceMutated: false }, done),
    ).toBeUndefined();
    expect(
      codexMutationClaimRefusal({ host: 'codex', workspaceMutated: false }, active),
    ).toBeUndefined();
    expect(
      codexMutationClaimRefusal({ host: 'codex', workspaceMutated: true }, done),
    ).toBeUndefined();
  });

  it('marks a pending completion done only after a different provider passes it', () => {
    const result = applyIndependentCompletionGrade({
      goalId: 'goal-1',
      provider: 'claude',
      result: 'pass',
      evidence: 'exact-head tests and representative behavior passed',
    });
    expect(result.status).toBe('done');
    expect(result.pendingCompletion).toBeUndefined();
    expect(result.lastSummary).toContain('Independent validation passed');
    expect(readSupervisorState().goals[0]!.status).toBe('done');
  });

  it('reopens work when independent validation rejects the claim', () => {
    const result = applyIndependentCompletionGrade({
      goalId: 'goal-1',
      provider: 'claude',
      result: 'fail',
      evidence: 'runtime behavior does not match the completion claim',
    });
    expect(result.status).toBe('active');
    expect(result.pendingCompletion).toBeUndefined();
    expect(result.nextRunAt).toBeTruthy();
  });

  it('refuses self-grading and goals without a pending completion claim', () => {
    expect(() =>
      applyIndependentCompletionGrade({
        goalId: 'goal-1',
        provider: 'codex',
        result: 'pass',
        evidence: 'self grade',
      }),
    ).toThrow(/made the completion claim/);

    const state = readSupervisorState();
    state.goals[0]!.pendingCompletion = undefined;
    writeSupervisorState(state);
    expect(() =>
      applyIndependentCompletionGrade({
        goalId: 'goal-1',
        provider: 'claude',
        result: 'pass',
        evidence: 'no claim',
      }),
    ).toThrow(/no pending completion claim/);
  });
});

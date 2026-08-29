import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  applyIndependentCompletionGrade,
  readSupervisorState,
  updateGoal,
  writeSupervisorState,
  type SupervisorGoal,
} from '../src/supervisor/state.js';
import {
  codexMutationClaimRefusal,
  mutationClaimRefusalGoalPatch,
} from '../src/supervisor/runtime.js';
import type { WorkerReport } from '../src/supervisor/worker-report.js';
import { openDb } from '../src/db/client.js';
import { runPerformanceObservations } from '../src/db/schema.js';
import { reviewFindings } from '../src/db/schema.js';
import {
  recordPerformanceObservation,
  recordIndependentReviewExecution,
  RUN_INSIGHT_SCHEMA,
} from '../src/insights/performance-history.js';
import { readSupervisorSourceIdentity } from '../src/supervisor/source-identity.js';
import { addProject } from '../src/config/project-service.js';
import { projectConfigSchema } from '../src/config/project-config.js';
import { addTask, getTask, transitionTask } from '../src/domain/task-service.js';
import { newId } from '../src/domain/ids.js';
import { recordQualifyingVerification } from './helpers.js';

let root: string;
let controlRoot: string;
let priorStatePath: string | undefined;
let reviewDb: ReturnType<typeof openDb>;

function pendingGoal(): SupervisorGoal {
  const sourceIdentity = readSupervisorSourceIdentity(root);
  if (!sourceIdentity) throw new Error('test repository source identity unavailable');
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
    activePid: 123,
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:01:00.000Z',
    lastCoordinator: 'codex',
    lastSummary: 'Worker completion claim awaiting independent validation: all checks pass',
    pendingCompletion: {
      summary: 'all checks pass',
      coordinator: 'codex',
      claimedAt: '2026-08-11T00:01:00.000Z',
      sourceHead: sourceIdentity.sourceHead,
      sourceTreeDigest: sourceIdentity.sourceTreeDigest,
      candidate: { ...sourceIdentity, resolution: 'no_task' },
      promotionEvidence: {
        focusedTests: 'focused tests passed',
        cheapestCompileTypeOrBuild: 'typecheck passed',
        criticalPathBehavior: 'critical path passed',
        materialRiskChecks: [],
        broaderValidation: {
          triggers: [],
          repositoryPolicyRequires: false,
          performed: false,
        },
        review: { level: 'focused', passed: true },
        blockerFindings: 0,
      },
    },
  };
}

function reviewReceiptId(
  provider: 'claude' | 'codex',
  verdict: 'pass' | 'fail',
  evidence: string,
  sourceHead = readSupervisorSourceIdentity(root)?.sourceHead ?? 'a'.repeat(40),
  goalId = 'goal-1',
) {
  const dispatchId = `dispatch-${provider}-${verdict}-${sourceHead}-${goalId}`;
  const current = readSupervisorState().goals[0];
  if (current?.pendingCompletion) {
    updateGoal(current.id, {
      pendingCompletion: {
        ...current.pendingCompletion,
        reviewDispatch: {
          id: dispatchId,
          provider,
          startedAt: '2026-08-11T00:02:00.000Z',
        },
      },
    });
  }
  return recordIndependentReviewExecution(reviewDb.db, {
    project: 'major',
    goalId,
    runId: 'run-review',
    dispatchId,
    provider,
    sourceHead,
    pendingClaimedAt: '2026-08-11T00:01:00.000Z',
    reviewStartedAt: '2026-08-11T00:02:00.000Z',
    executionStatus: 'succeeded',
    review: {
      purpose: 'independent_completion_review',
      goalId,
      sourceHead,
      verdict,
      evidence,
    },
  });
}

function bindPendingToCanonicalTask() {
  const sourceIdentity = readSupervisorSourceIdentity(root)!;
  const project = addProject(
    reviewDb.db,
    projectConfigSchema.parse({ name: 'major', repoPath: root }),
  );
  const task = addTask(reviewDb.db, { projectId: project.id, title: 'frozen candidate' });
  transitionTask(reviewDb.db, task.id, 'ready');
  for (const status of ['queued', 'running', 'verifying', 'reviewing', 'ready_to_merge'] as const) {
    transitionTask(reviewDb.db, task.id, status);
  }
  const verification = recordQualifyingVerification(reviewDb.db, task.id);
  const frozenCriteriaJson = getTask(reviewDb.db, task.id).completionCriteriaSnapshotJson!;
  const current = readSupervisorState().goals[0]!;
  updateGoal(current.id, {
    pendingCompletion: {
      ...current.pendingCompletion!,
      taskId: task.id,
      candidate: {
        ...sourceIdentity,
        resolution: 'task',
        task: { taskId: task.id, projectId: project.id, frozenCriteriaJson },
      },
    },
  });
  return { task, verification };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-completion-'));
  controlRoot = mkdtempSync(join(tmpdir(), 'major-completion-control-'));
  const gitOptions = { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } };
  writeFileSync(join(root, 'candidate.txt'), 'frozen\n');
  execFileSync('/usr/bin/git', ['init'], gitOptions);
  execFileSync('/usr/bin/git', ['add', 'candidate.txt'], gitOptions);
  execFileSync(
    '/usr/bin/git',
    ['-c', 'user.name=Major Test', '-c', 'user.email=major@example.test', 'commit', '-m', 'base'],
    gitOptions,
  );
  priorStatePath = process.env.MAJOR_STATE_PATH;
  process.env.MAJOR_STATE_PATH = join(controlRoot, 'supervisor-state.json');
  reviewDb = openDb(':memory:');
  writeSupervisorState({ version: 1, goals: [pendingGoal()], sessions: [] });
});

afterEach(() => {
  if (priorStatePath === undefined) delete process.env.MAJOR_STATE_PATH;
  else process.env.MAJOR_STATE_PATH = priorStatePath;
  reviewDb.sqlite.close();
  rmSync(root, { recursive: true, force: true });
  rmSync(controlRoot, { recursive: true, force: true });
});

describe('independent goal completion', () => {
  it('refuses an arbitrary generic history receipt as completion authority', () => {
    recordPerformanceObservation(reviewDb.db, {
      project: 'major',
      source: 'major',
      receipt: {
        schema: RUN_INSIGHT_SCHEMA,
        recordedAt: new Date().toISOString(),
        goalId: 'goal-1',
        outcome: 'completed',
        worker: { coordinator: 'claude', provider: 'claude', model: 'review-model' },
      },
    });
    const historyId = reviewDb.db
      .select({ id: runPerformanceObservations.id })
      .from(runPerformanceObservations)
      .get()!.id;
    expect(() =>
      applyIndependentCompletionGrade({
        goalId: 'goal-1',
        receiptId: historyId,
        db: reviewDb.db,
      }),
    ).toThrow(/durable review receipt/);
  });

  it('rejects only the canonical Codex BUILT claim when Lima observed no returned delta', () => {
    const done: WorkerReport = { status: 'done', summary: 'acceptance task passed' };
    const built: WorkerReport = { status: 'active', summary: 'BUILT provider route' };
    expect(
      codexMutationClaimRefusal({ host: 'codex', workspaceMutated: false }, done),
    ).toBeUndefined();
    expect(codexMutationClaimRefusal({ host: 'codex', workspaceMutated: false }, built)).toMatch(
      /observed no project delta/,
    );
    for (const summary of ['not BUILT provider route', 'PRE-BUILT provider route', 'built route']) {
      expect(
        codexMutationClaimRefusal(
          { host: 'codex', workspaceMutated: false },
          { status: 'active', summary },
        ),
      ).toBeUndefined();
    }
  });

  it('keeps a refused BUILT claim active and clears pending completion', () => {
    const patch = mutationClaimRefusalGoalPatch(pendingGoal(), 'Rejected Codex mutation claim', {
      sessionRef: 'session-2',
    });
    expect(patch).toMatchObject({
      status: 'active',
      pendingCompletion: undefined,
      retryImmediately: false,
      consecutiveFailures: 1,
      lastSessionRef: 'session-2',
    });
    expect(Object.hasOwn(patch, 'pendingCompletion')).toBe(true);
    expect(Object.hasOwn(patch, 'activePid')).toBe(true);
    const persisted = updateGoal('goal-1', patch);
    expect(persisted.pendingCompletion).toBeUndefined();
    expect(persisted.activePid).toBeUndefined();
  });

  it('uses bounded generic failure escalation and preserves an existing session ref', () => {
    const goal = pendingGoal();
    goal.consecutiveFailures = 5;
    goal.lastSessionRef = 'session-1';
    updateGoal('goal-1', { consecutiveFailures: 5, lastSessionRef: 'session-1' });
    const patch = mutationClaimRefusalGoalPatch(goal, 'Rejected Codex mutation claim', {});
    expect(patch).toMatchObject({ status: 'failed', consecutiveFailures: 6 });
    expect(Object.hasOwn(patch, 'lastSessionRef')).toBe(false);
    expect(updateGoal('goal-1', patch).lastSessionRef).toBe('session-1');
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
    expect(readSupervisorState().goals[0]!.pendingCompletion?.promotionEvidence).toMatchObject({
      focusedTests: 'focused tests passed',
      blockerFindings: 0,
    });
    const result = applyIndependentCompletionGrade({
      goalId: 'goal-1',
      receiptId: reviewReceiptId(
        'claude',
        'pass',
        'exact-head tests and representative behavior passed',
      ),
      db: reviewDb.db,
    });
    expect(result.status).toBe('done');
    expect(result.pendingCompletion).toBeUndefined();
    expect(result.lastSummary).toContain('Independent validation passed');
    expect(readSupervisorState().goals[0]!.status).toBe('done');
  });

  it('atomically reopens instead of applying a passing grade after source mutation', () => {
    const receiptId = reviewReceiptId('claude', 'pass', 'reviewed the frozen candidate');
    writeFileSync(join(root, 'candidate.txt'), 'mutated after review\n');
    expect(() =>
      applyIndependentCompletionGrade({
        goalId: 'goal-1',
        receiptId,
        db: reviewDb.db,
      }),
    ).toThrow(/candidate source identity changed/i);
    const reopened = readSupervisorState().goals[0]!;
    expect(reopened.status).toBe('active');
    expect(reopened.pendingCompletion).toBeUndefined();
    expect(reopened.lastSummary).toMatch(/source-tree identity changed/i);
  });

  it('atomically reopens when repository HEAD changes before grade application', () => {
    const receiptId = reviewReceiptId('claude', 'pass', 'reviewed the prior exact head');
    writeFileSync(join(root, 'candidate.txt'), 'new committed candidate\n');
    const gitOptions = { cwd: root, env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' } };
    execFileSync('/usr/bin/git', ['add', 'candidate.txt'], gitOptions);
    execFileSync(
      '/usr/bin/git',
      ['-c', 'user.name=Major Test', '-c', 'user.email=major@example.test', 'commit', '-m', 'next'],
      gitOptions,
    );
    expect(() =>
      applyIndependentCompletionGrade({
        goalId: 'goal-1',
        receiptId,
        db: reviewDb.db,
      }),
    ).toThrow(/candidate source identity changed/i);
    const reopened = readSupervisorState().goals[0]!;
    expect(reopened.status).toBe('active');
    expect(reopened.pendingCompletion).toBeUndefined();
  });

  it('re-runs canonical task promotion proof and reopens when a BLOCKER appears', () => {
    const { task, verification } = bindPendingToCanonicalTask();
    const receiptId = reviewReceiptId('claude', 'pass', 'task candidate reviewed');
    reviewDb.db
      .insert(reviewFindings)
      .values({
        id: newId('rfind'),
        taskId: task.id,
        agentRunId: verification.run.id,
        severity: 'critical',
        summary: 'late authority blocker',
      })
      .run();
    expect(() =>
      applyIndependentCompletionGrade({ goalId: 'goal-1', receiptId, db: reviewDb.db }),
    ).toThrow(/open BLOCKER review finding/i);
    const reopened = readSupervisorState().goals[0]!;
    expect(reopened.status).toBe('active');
    expect(reopened.pendingCompletion).toBeUndefined();
  });

  it('accepts a passing grade only while the frozen canonical task remains promotable', () => {
    bindPendingToCanonicalTask();
    const result = applyIndependentCompletionGrade({
      goalId: 'goal-1',
      receiptId: reviewReceiptId('claude', 'pass', 'task remains promotable'),
      db: reviewDb.db,
    });
    expect(result.status).toBe('done');
    expect(result.pendingCompletion).toBeUndefined();
  });

  it('reopens work when independent validation rejects the claim', () => {
    const result = applyIndependentCompletionGrade({
      goalId: 'goal-1',
      receiptId: reviewReceiptId(
        'claude',
        'fail',
        'runtime behavior does not match the completion claim',
      ),
      db: reviewDb.db,
    });
    expect(result.status).toBe('active');
    expect(result.pendingCompletion).toBeUndefined();
    expect(result.nextRunAt).toBeTruthy();
  });

  it('rejects durable review evidence for a different exact head', () => {
    expect(() =>
      applyIndependentCompletionGrade({
        goalId: 'goal-1',
        receiptId: reviewReceiptId('claude', 'pass', 'wrong head', 'b'.repeat(40)),
        db: reviewDb.db,
      }),
    ).toThrow(/different exact head/);
  });

  it('rejects a provider-owned review receipt for a different goal', () => {
    const receiptId = reviewReceiptId('claude', 'pass', 'wrong goal', 'a'.repeat(40), 'goal-2');
    expect(() =>
      applyIndependentCompletionGrade({
        goalId: 'goal-1',
        receiptId,
        db: reviewDb.db,
      }),
    ).toThrow(/different project or goal/);
  });

  it('refuses self-grading and goals without a pending completion claim', () => {
    expect(() =>
      applyIndependentCompletionGrade({
        goalId: 'goal-1',
        receiptId: reviewReceiptId('codex', 'pass', 'self grade'),
        db: reviewDb.db,
      }),
    ).toThrow(/made the completion claim/);

    const state = readSupervisorState();
    state.goals[0]!.pendingCompletion = undefined;
    writeSupervisorState(state);
    expect(() =>
      applyIndependentCompletionGrade({
        goalId: 'goal-1',
        receiptId: reviewReceiptId('claude', 'pass', 'no claim'),
        db: reviewDb.db,
      }),
    ).toThrow(/no pending completion claim/);
  });
});

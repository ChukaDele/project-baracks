import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { agentModels, agentRuns, evidence, verificationRuns, worktrees } from '../src/db/schema.js';
import { evaluateCompletionProof } from '../src/domain/completion.js';
import { addTask, getTask, transitionTask } from '../src/domain/task-service.js';
import {
  parallelRefusal,
  pathsOverlap,
  promoteNextLandedTask,
  runParallelBatch,
  selectParallelBatch,
  type ParallelTask,
  type RunCommand,
} from '../src/supervisor/parallel-dispatch.js';
import {
  configureProjectPolicy,
  defaultProjectPolicy,
  getProjectPolicy,
} from '../src/supervisor/policy.js';
import type { WorkerOutcome } from '../src/supervisor/worker.js';
import { ensureProvider, seedProject, testDb } from './helpers.js';

let root = '';
let repo = '';
let priorPolicyPath: string | undefined;
let db: ReturnType<typeof testDb>;
let projectId = '';

const run: RunCommand = async (executable, args, cwd) => {
  const result = spawnSync(executable, [...args], { cwd, encoding: 'utf8' });
  return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
};

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function outcome(status: WorkerOutcome['status'] = 'succeeded'): WorkerOutcome {
  return {
    host: 'claude',
    status,
    exitCode: status === 'succeeded' ? 0 : 1,
    stdout: '',
    stderr: '',
    durationMs: 1,
    rateLimited: false,
    exhausted: false,
    sessionRef: 'worker-session',
  };
}

function queuedTask(title: string, paths?: string[], completionCriteriaJson?: string) {
  const task = addTask(db, {
    projectId,
    title,
    ...(paths ? { paths } : {}),
    ...(completionCriteriaJson ? { completionCriteriaJson } : {}),
  });
  transitionTask(db, task.id, 'ready');
  transitionTask(db, task.id, 'queued');
  return task;
}

/** A fake worker that writes `file` (relative to its worktree) after `delayMs`
 * and tracks peak concurrency. */
function writingWorker(files: Record<string, [file: string, content: string, delayMs?: number]>) {
  let active = 0;
  const stats = { peak: 0, calls: 0 };
  const worker = async (task: ParallelTask, cwd: string) => {
    stats.calls += 1;
    active += 1;
    stats.peak = Math.max(stats.peak, active);
    const [file, content, delayMs = 50] = files[task.title]!;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    mkdirSync(dirname(join(cwd, file)), { recursive: true });
    writeFileSync(join(cwd, file), content);
    active -= 1;
    return outcome();
  };
  return { worker, stats };
}

function batchInput(overrides: Partial<Parameters<typeof runParallelBatch>[0]> = {}) {
  return {
    db,
    repoPath: repo,
    projectId,
    tasks: selectParallelBatch(db, projectId, 4),
    verificationCommands: ['git status'],
    runProvenance: (() => {
      const providerId = ensureProvider(db);
      const model = db
        .select()
        .from(agentModels)
        .where(eq(agentModels.providerId, providerId))
        .get()!;
      return {
        providerId,
        modelId: model.id,
        modelRef: model.modelRef,
        billingMode: 'subscription_included' as const,
        routingReason: 'test route',
      };
    })(),
    leaseMs: 60_000,
    run,
    worktreeRoot: join(root, 'worktrees'),
    runTaskWorker: async () => outcome(),
    runIntegrator: async () => outcome('failed'),
    ...overrides,
  };
}

/** A and B have disjoint declared paths, but B strays into A's shared.txt. */
function strayingPair() {
  queuedTask('A', ['shared.txt']);
  const b = queuedTask('B', ['b/**']);
  const { worker } = writingWorker({
    A: ['shared.txt', 'from A\n'],
    B: ['shared.txt', 'from B\n', 150],
  });
  return { b, worker };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-parallel-'));
  repo = join(root, 'repo');
  spawnSync('git', ['init', '-q', '-b', 'main', repo]);
  git(repo, 'config', 'user.email', 'test@example.com');
  git(repo, 'config', 'user.name', 'Test');
  writeFileSync(join(repo, 'shared.txt'), 'base\n');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-qm', 'init');
  db = testDb();
  projectId = seedProject(db).id;
  priorPolicyPath = process.env.MAJOR_POLICY_PATH;
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
});

afterEach(() => {
  if (priorPolicyPath === undefined) delete process.env.MAJOR_POLICY_PATH;
  else process.env.MAJOR_POLICY_PATH = priorPolicyPath;
  rmSync(root, { recursive: true, force: true });
});

describe('parallel dispatch', { timeout: 30_000 }, () => {
  it('runs two disjoint tasks at once and merges both', async () => {
    const a = queuedTask('A', ['a/**']);
    const b = queuedTask('B', ['b/**']);
    const { worker, stats } = writingWorker({ A: ['a/a.txt', 'a\n'], B: ['b/b.txt', 'b\n'] });
    let integratorCalls = 0;
    const results = await runParallelBatch(
      batchInput({
        runTaskWorker: worker,
        runIntegrator: async () => {
          integratorCalls += 1;
          return outcome();
        },
      }),
    );
    expect(results.map((result) => result.outcome)).toEqual(['merged', 'merged']);
    expect(stats.peak).toBe(2);
    expect(integratorCalls).toBe(0);
    expect(readFileSync(join(repo, 'a/a.txt'), 'utf8')).toBe('a\n');
    expect(readFileSync(join(repo, 'b/b.txt'), 'utf8')).toBe('b\n');
    expect(git(repo, 'log', '-1', '--format=%an')).toBe('Major');
    expect(getTask(db, a.id).status).toBe('verifying');
    expect(getTask(db, b.id).status).toBe('verifying');
    const trees = db.select().from(worktrees).all();
    expect(trees.map((tree) => tree.status)).toEqual(['merged', 'merged']);
    expect(trees.some((tree) => existsSync(tree.path))).toBe(false);
  });

  it('serializes overlapping tasks across cycles and never batches undeclared ones', async () => {
    const first = queuedTask('first', ['src/**']);
    const second = queuedTask('second', ['src/feature/x.ts']);
    queuedTask('undeclared');
    expect(selectParallelBatch(db, projectId, 4).map((task) => task.id)).toEqual([first.id]);
    const { worker } = writingWorker({ first: ['src/one.txt', '1\n'] });
    await runParallelBatch(batchInput({ runTaskWorker: worker }));
    expect(getTask(db, first.id).status).toBe('verifying');
    expect(getTask(db, second.id).status).toBe('queued');
    expect(selectParallelBatch(db, projectId, 4).map((task) => task.id)).toEqual([second.id]);
  });

  it('invokes the integrator exactly once on a rebase conflict and merges its fix', async () => {
    const { b, worker } = strayingPair();
    const prompts: string[] = [];
    const results = await runParallelBatch(
      batchInput({
        runTaskWorker: worker,
        runIntegrator: async (prompt, cwd) => {
          prompts.push(prompt);
          git(cwd, 'reset', '-q', '--hard', git(repo, 'rev-parse', 'HEAD'));
          mkdirSync(join(cwd, 'b'));
          writeFileSync(join(cwd, 'b/b.txt'), 'from B\n');
          git(cwd, 'add', '-A');
          git(cwd, 'commit', '-qm', 'integrate');
          return outcome();
        },
      }),
    );
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain('rebase conflict');
    expect(results.find((result) => result.taskId === b.id)).toMatchObject({
      outcome: 'merged',
      integratorRuns: 1,
    });
    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('from A\n');
    expect(readFileSync(join(repo, 'b/b.txt'), 'utf8')).toBe('from B\n');
  });

  it('blocks the task for the owner when the integrator cannot fix it, without forcing', async () => {
    const { b, worker } = strayingPair();
    let integratorCalls = 0;
    const results = await runParallelBatch(
      batchInput({
        runTaskWorker: worker,
        runIntegrator: async () => {
          integratorCalls += 1;
          return outcome('failed');
        },
      }),
    );
    expect(integratorCalls).toBe(1);
    expect(results.find((result) => result.taskId === b.id)?.outcome).toBe('blocked');
    expect(getTask(db, b.id).status).toBe('needs_decision');
    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('from A\n');
    const kept = db.select().from(worktrees).where(eq(worktrees.taskId, b.id)).get();
    expect(kept?.status).toBe('active');
    expect(existsSync(kept!.path)).toBe(true);
  });

  it('refuses to land changes outside the declared paths', async () => {
    const a = queuedTask('A', ['a/**']);
    const { worker } = writingWorker({ A: ['README.md', 'stray\n'] });
    const results = await runParallelBatch(
      batchInput({ runTaskWorker: worker, runIntegrator: async () => outcome() }),
    );
    expect(results[0]).toMatchObject({ outcome: 'blocked', integratorRuns: 1 });
    expect(results[0]?.detail).toContain('outside declared paths');
    expect(getTask(db, a.id).status).toBe('needs_decision');
    expect(existsSync(join(repo, 'README.md'))).toBe(false);
  });

  it('sends a failing verification to the integrator and blocks if it still fails', async () => {
    const a = queuedTask('A', ['a/**']);
    const { worker } = writingWorker({ A: ['a/a.txt', 'a\n'] });
    let integratorCalls = 0;
    const results = await runParallelBatch(
      batchInput({
        verificationCommands: ['git definitely-not-a-command'],
        runTaskWorker: worker,
        runIntegrator: async () => {
          integratorCalls += 1;
          return outcome();
        },
      }),
    );
    expect(integratorCalls).toBe(1);
    expect(results[0]).toMatchObject({ outcome: 'blocked', integratorRuns: 1 });
    expect(getTask(db, a.id).status).toBe('needs_decision');
    expect(existsSync(join(repo, 'a/a.txt'))).toBe(false);
  });

  it('does not land a worktree that left its task branch', async () => {
    const a = queuedTask('A', ['a/**']);
    const results = await runParallelBatch(
      batchInput({
        runTaskWorker: async (_task, cwd) => {
          mkdirSync(join(cwd, 'a'));
          writeFileSync(join(cwd, 'a/a.txt'), 'a\n');
          git(cwd, 'checkout', '-q', '--detach');
          git(cwd, 'add', '-A');
          git(cwd, 'commit', '-qm', 'detached work');
          return outcome();
        },
      }),
    );
    expect(results[0]?.outcome).toBe('blocked');
    expect(results[0]?.detail).toContain('not on its task branch');
    expect(getTask(db, a.id).status).toBe('needs_decision');
  });

  it('never aborts a rebase the integrator left in progress', async () => {
    const { b, worker } = strayingPair();
    let worktreePath = '';
    const results = await runParallelBatch(
      batchInput({
        runTaskWorker: worker,
        runIntegrator: async (_prompt, cwd) => {
          worktreePath = cwd;
          spawnSync('git', ['rebase', git(repo, 'rev-parse', 'HEAD')], { cwd });
          return outcome();
        },
      }),
    );
    expect(results.find((result) => result.taskId === b.id)?.detail).toContain(
      'rebase is left in progress',
    );
    expect(getTask(db, b.id).status).toBe('needs_decision');
    const gitDir = git(worktreePath, 'rev-parse', '--absolute-git-dir');
    expect(existsSync(join(gitDir, 'rebase-merge'))).toBe(true);
  });

  it('keeps a claim alive past its lease while waiting, via heartbeat', async () => {
    const a = queuedTask('A', ['a/**']);
    // The worker outlives the lease twice over; the heartbeat margin (15x) keeps
    // a loaded event loop from letting the lease lapse between beats.
    const { worker } = writingWorker({ A: ['a/a.txt', 'a\n', 3000] });
    const results = await runParallelBatch(
      batchInput({ leaseMs: 1500, heartbeatMs: 100, runTaskWorker: worker }),
    );
    expect(results[0]?.outcome).toBe('merged');
    expect(getTask(db, a.id).status).toBe('verifying');
  });

  it('a throw in one task parks it without abandoning its sibling', async () => {
    const a = queuedTask('A', ['a/**']);
    const b = queuedTask('B', ['b/**']);
    const { worker } = writingWorker({ B: ['b/b.txt', 'b\n', 100] });
    const results = await runParallelBatch(
      batchInput({
        runTaskWorker: async (task, cwd) => {
          if (task.id === a.id) throw new Error('resource ledger exploded');
          return worker(task, cwd);
        },
      }),
    );
    expect(results.find((result) => result.taskId === a.id)?.outcome).toBe('blocked');
    expect(getTask(db, a.id).status).toBe('needs_decision');
    expect(results.find((result) => result.taskId === b.id)?.outcome).toBe('merged');
    expect(existsSync(join(repo, 'b/b.txt'))).toBe(true);
  });

  it('requeues a task whose worker failed and discards its scratch worktree', async () => {
    const a = queuedTask('A', ['a/**']);
    const results = await runParallelBatch(
      batchInput({ runTaskWorker: async () => outcome('timed_out') }),
    );
    expect(results[0]?.outcome).toBe('requeued');
    expect(getTask(db, a.id).status).toBe('queued');
    expect(db.select().from(worktrees).get()?.status).toBe('removed');
  });

  it('refuses a succeeded result without a durable session identity', async () => {
    const a = queuedTask('A', ['a/**']);
    const results = await runParallelBatch(
      batchInput({
        runTaskWorker: async () => {
          const { sessionRef: _, ...unidentified } = outcome();
          return unidentified;
        },
      }),
    );
    expect(results[0]).toMatchObject({ outcome: 'blocked', detail: /session identity/ });
    expect(getTask(db, a.id).status).toBe('needs_decision');
    expect(db.select().from(agentRuns).all()).toEqual([]);
  });

  it('records a canonical implementation run at the landed head with its checks as proof', async () => {
    const a = queuedTask('A', ['a/**']);
    const { worker } = writingWorker({ A: ['a/a.txt', 'a\n'] });
    await runParallelBatch(batchInput({ runTaskWorker: worker }));
    const landedHead = git(repo, 'rev-parse', 'HEAD');
    expect(db.select().from(agentRuns).where(eq(agentRuns.taskId, a.id)).all()).toEqual([
      expect.objectContaining({
        purpose: 'implementation',
        status: 'succeeded',
        sourceHead: landedHead,
        sessionRef: 'worker-session',
      }),
    ]);
    const run = db.select().from(agentRuns).where(eq(agentRuns.taskId, a.id)).get()!;
    expect(db.select().from(verificationRuns).all()).toEqual([
      expect.objectContaining({ command: 'git status', status: 'passed', agentRunId: run.id }),
    ]);
    expect(db.select().from(evidence).all()).toEqual([
      expect.objectContaining({ kind: 'verification_run', agentRunId: run.id }),
    ]);
    expect(evaluateCompletionProof(db, a.id)).toMatchObject({ ok: true });
  });
});

describe('promoteNextLandedTask', { timeout: 30_000 }, () => {
  it('moves one landed task at a time into the ready_to_merge gate, oldest first', async () => {
    const a = queuedTask('A', ['a/**']);
    const b = queuedTask('B', ['b/**']);
    const { worker } = writingWorker({ A: ['a/a.txt', 'a\n'], B: ['b/b.txt', 'b\n'] });
    await runParallelBatch(batchInput({ runTaskWorker: worker }));

    expect(promoteNextLandedTask(db, projectId)).toBe(a.id);
    expect(getTask(db, a.id).status).toBe('ready_to_merge');
    expect(getTask(db, b.id).status).toBe('verifying');
    // Exactly one ready_to_merge task: B waits until A leaves the gate.
    expect(promoteNextLandedTask(db, projectId)).toBeUndefined();
    expect(getTask(db, b.id).status).toBe('verifying');

    transitionTask(db, a.id, 'completed');
    expect(promoteNextLandedTask(db, projectId)).toBe(b.id);
    expect(getTask(db, b.id).status).toBe('ready_to_merge');
    expect(promoteNextLandedTask(db, projectId)).toBeUndefined();
  });

  it('parks a landed task whose recorded proof cannot pass instead of holding the gate', async () => {
    const a = queuedTask('A', ['a/**'], JSON.stringify({ requireArtifact: true }));
    const b = queuedTask('B', ['b/**']);
    const { worker } = writingWorker({ A: ['a/a.txt', 'a\n'], B: ['b/b.txt', 'b\n'] });
    await runParallelBatch(batchInput({ runTaskWorker: worker }));

    expect(promoteNextLandedTask(db, projectId)).toBeUndefined();
    expect(getTask(db, a.id).status).toBe('needs_decision');
    expect(promoteNextLandedTask(db, projectId)).toBe(b.id);
  });

  it('never batches a task with progressive criteria frozen to a candidate head', () => {
    queuedTask(
      'frozen',
      ['f/**'],
      JSON.stringify({ progressiveValidation: { candidateHead: 'a'.repeat(40) } }),
    );
    const open = queuedTask('open', ['o/**']);
    expect(selectParallelBatch(db, projectId, 4).map((task) => task.id)).toEqual([open.id]);
  });
});

describe('parallelRefusal', () => {
  it('requires verification commands and a branch checkout', async () => {
    expect(await parallelRefusal(repo, [], run)).toContain('verificationCommands');
    expect(await parallelRefusal(repo, ['git status'], run)).toBeUndefined();
    git(repo, 'checkout', '-q', '--detach');
    expect(await parallelRefusal(repo, ['git status'], run)).toContain('detached');
  });
});

describe('parallel dispatch policy flag', () => {
  it('is off by default and for policies persisted before the flag existed', () => {
    expect(defaultProjectPolicy('demo', repo).parallelWorkers).toBe(false);
    writeFileSync(
      process.env.MAJOR_POLICY_PATH!,
      JSON.stringify({
        version: 1,
        projects: [{ ...defaultProjectPolicy('demo', repo), parallelWorkers: undefined }],
      }),
    );
    expect(getProjectPolicy('demo', repo).parallelWorkers).toBe(false);
  });

  it('is enabled only explicitly and survives later reconfiguration', () => {
    configureProjectPolicy({
      project: 'demo',
      repoPath: repo,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
      parallelWorkers: true,
    });
    configureProjectPolicy({
      project: 'demo',
      repoPath: repo,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    expect(getProjectPolicy('demo', repo).parallelWorkers).toBe(true);
  });
});

describe('pathsOverlap', () => {
  it('treats shared literal prefixes as overlapping and distinct directories as disjoint', () => {
    expect(pathsOverlap(['src/a/**'], ['src/b/**'])).toBe(false);
    expect(pathsOverlap(['src/**'], ['src/a/x.ts'])).toBe(true);
    expect(pathsOverlap(['./docs/*.md'], ['docs/readme.md'])).toBe(true);
    expect(pathsOverlap(['**/*.ts'], ['docs/readme.md'])).toBe(true);
  });
});

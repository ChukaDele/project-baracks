import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { worktrees } from '../src/db/schema.js';
import { addTask, getTask, transitionTask } from '../src/domain/task-service.js';
import {
  pathsOverlap,
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
import { seedProject, testDb } from './helpers.js';

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
  };
}

function queuedTask(title: string, paths?: string[]) {
  const task = addTask(db, { projectId, title, ...(paths ? { paths } : {}) });
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
    leaseMs: 60_000,
    run,
    worktreeRoot: join(root, 'worktrees'),
    runTaskWorker: async () => outcome(),
    runIntegrator: async () => outcome('failed'),
    ...overrides,
  };
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

describe('parallel dispatch', () => {
  it('runs two disjoint tasks at once and merges both', async () => {
    const a = queuedTask('A', ['a/**']);
    const b = queuedTask('B', ['b/**']);
    const { worker, stats } = writingWorker({ A: ['a.txt', 'a\n'], B: ['b.txt', 'b\n'] });
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
    expect(readFileSync(join(repo, 'a.txt'), 'utf8')).toBe('a\n');
    expect(readFileSync(join(repo, 'b.txt'), 'utf8')).toBe('b\n');
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
    const { worker } = writingWorker({ first: ['one.txt', '1\n'], second: ['two.txt', '2\n'] });
    await runParallelBatch(batchInput({ runTaskWorker: worker }));
    expect(getTask(db, second.id).status).toBe('queued');
    expect(selectParallelBatch(db, projectId, 4).map((task) => task.id)).toEqual([second.id]);
  });

  it('invokes the integrator exactly once on a rebase conflict and merges its fix', async () => {
    queuedTask('A', ['a/**']);
    const b = queuedTask('B', ['b/**']);
    // Both workers stray into the same file: B's rebase onto A must conflict.
    const { worker } = writingWorker({
      A: ['shared.txt', 'from A\n'],
      B: ['shared.txt', 'from B\n', 150],
    });
    const prompts: string[] = [];
    const results = await runParallelBatch(
      batchInput({
        runTaskWorker: worker,
        runIntegrator: async (prompt, cwd) => {
          prompts.push(prompt);
          git(cwd, 'reset', '-q', '--hard', git(repo, 'rev-parse', 'HEAD'));
          writeFileSync(join(cwd, 'shared.txt'), 'from A\nfrom B\n');
          git(cwd, 'commit', '-qam', 'integrate');
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
    expect(readFileSync(join(repo, 'shared.txt'), 'utf8')).toBe('from A\nfrom B\n');
  });

  it('blocks the task for the owner when the integrator cannot fix it, without forcing', async () => {
    queuedTask('A', ['a/**']);
    const b = queuedTask('B', ['b/**']);
    const { worker } = writingWorker({
      A: ['shared.txt', 'from A\n'],
      B: ['shared.txt', 'from B\n', 150],
    });
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

  it('sends a failing verification to the integrator and blocks if it still fails', async () => {
    const a = queuedTask('A', ['a/**']);
    const { worker } = writingWorker({ A: ['a.txt', 'a\n'] });
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
    expect(existsSync(join(repo, 'a.txt'))).toBe(false);
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

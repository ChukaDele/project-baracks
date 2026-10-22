import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tasks, worktrees } from '../db/schema.js';
import {
  claimNextTask,
  completeClaim,
  recoverExpiredClaims,
  releaseClaim,
} from '../domain/claim-service.js';
import { newId } from '../domain/ids.js';
import { transitionTask, type ClaimFence } from '../domain/task-service.js';
import { runGatewayCommand, type WorkerOutcome } from './worker.js';
import { parseWorkerReport } from './worker-report.js';
import { majorHome } from './state.js';

/**
 * Opt-in parallel task dispatch (policy.parallelWorkers). Queued tasks with
 * pairwise-disjoint declared paths each run in their own git worktree and
 * branch. A serial merge queue rebases each green branch onto the
 * integration head (the goal checkout's HEAD), runs the project's
 * verification commands, and fast-forwards. A rebase conflict or failed
 * check gets exactly one integrator worker; if that fails too, the task is
 * parked in needs_decision for the owner. Nothing is ever forced onto the
 * integration branch.
 */

export interface CommandResult {
  ok: boolean;
  output: string;
}

export type RunCommand = (
  executable: string,
  args: readonly string[],
  cwd: string,
  extraAllowedRoots?: readonly string[],
) => Promise<CommandResult>;

/** Production runner: every git and verification command goes through the
 * canonical execution gateway, exactly like `major delegate --worktree`. */
export const gatewayCommand: RunCommand = async (executable, args, cwd, extraAllowedRoots = []) => {
  const result = await runGatewayCommand({
    executable,
    args,
    cwd,
    timeoutMs: 30 * 60 * 1000,
    extraAllowedRoots,
  });
  return { ok: result.status === 'succeeded', output: `${result.stdout}${result.stderr}`.trim() };
};

export function defaultWorktreeRoot(repoPath: string): string {
  return join(majorHome(), 'worktrees', basename(repoPath));
}

/** Shared by `major delegate --worktree` and parallel dispatch. */
export async function createTaskWorktree(
  run: RunCommand,
  repoPath: string,
  label: string,
  options: { base?: string; root?: string } = {},
): Promise<{ path: string; branch: string }> {
  const safe = label.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
  const root = options.root ?? defaultWorktreeRoot(repoPath);
  mkdirSync(root, { recursive: true });
  const stamp = Date.now();
  const path = join(root, `${stamp}-${safe}`);
  const branch = `major/${stamp}-${safe}`;
  const git = await run(
    'git',
    ['worktree', 'add', '-b', branch, path, ...(options.base ? [options.base] : [])],
    repoPath,
    [root],
  );
  if (!git.ok) throw new Error(`worktree setup failed: ${git.output || 'unknown git error'}`);
  return { path, branch };
}

export function parseTaskPaths(json: string | null): string[] | undefined {
  if (!json) return undefined;
  try {
    const value: unknown = JSON.parse(json);
    return Array.isArray(value) &&
      value.length > 0 &&
      value.every((path) => typeof path === 'string' && path.trim())
      ? (value as string[])
      : undefined;
  } catch {
    return undefined;
  }
}

function staticPrefix(glob: string): string {
  const normalized = glob.trim().replace(/^\.\//, '');
  const wildcard = normalized.search(/[*?[{]/);
  return wildcard === -1 ? normalized : normalized.slice(0, wildcard);
}

// ponytail: compares the literal prefix before the first wildcard, so
// `src/*.ts` and `src/x/**` count as overlapping. A false overlap only
// serializes; swap in a real glob-intersection check if that costs too much.
export function pathsOverlap(a: readonly string[], b: readonly string[]): boolean {
  return a.some((left) =>
    b.some((right) => {
      const p = staticPrefix(left);
      const q = staticPrefix(right);
      return p.startsWith(q) || q.startsWith(p);
    }),
  );
}

export interface ParallelTask {
  id: string;
  title: string;
  description: string;
  paths: string[];
}

/** Oldest-first greedy batch of queued tasks whose declared paths are
 * pairwise disjoint. Tasks without declared paths never join a batch; a task
 * overlapping one already picked waits for a later cycle, after the earlier
 * one has landed. */
export function selectParallelBatch(db: Db, projectId: string, limit: number): ParallelTask[] {
  recoverExpiredClaims(db);
  const batch: ParallelTask[] = [];
  const queued = db
    .select()
    .from(tasks)
    .where(and(eq(tasks.projectId, projectId), eq(tasks.status, 'queued')))
    .orderBy(asc(tasks.createdAt))
    .all();
  for (const row of queued) {
    if (batch.length >= limit) break;
    const paths = parseTaskPaths(row.paths);
    if (!paths || batch.some((picked) => pathsOverlap(picked.paths, paths))) continue;
    batch.push({ id: row.id, title: row.title, description: row.description, paths });
  }
  return batch;
}

export interface ParallelTaskResult {
  taskId: string;
  outcome: 'merged' | 'requeued' | 'blocked' | 'skipped';
  detail: string;
  integratorRuns: number;
}

export interface ParallelBatchInput {
  db: Db;
  repoPath: string;
  projectId: string;
  tasks: readonly ParallelTask[];
  verificationCommands: readonly string[];
  /** Claim lease; must cover the worker, merge and one integrator run. */
  leaseMs: number;
  runTaskWorker: (task: ParallelTask, cwd: string) => Promise<WorkerOutcome>;
  runIntegrator: (prompt: string, cwd: string) => Promise<WorkerOutcome>;
  run?: RunCommand;
  worktreeRoot?: string;
}

const DIFF_LIMIT = 20_000;

function clip(text: string): string {
  return text.length > DIFF_LIMIT ? `${text.slice(0, DIFF_LIMIT)}\n[truncated]` : text;
}

export async function runParallelBatch(input: ParallelBatchInput): Promise<ParallelTaskResult[]> {
  const run = input.run ?? gatewayCommand;
  const root = input.worktreeRoot ?? defaultWorktreeRoot(input.repoPath);
  const workerId = `major-parallel:${process.pid}:${randomUUID()}`;
  const git = async (cwd: string, ...args: string[]) => run('git', args, cwd, [root]);
  const head = async () => {
    const result = await git(input.repoPath, 'rev-parse', 'HEAD');
    if (!result.ok) throw new Error(`cannot read integration head: ${result.output}`);
    return result.output.trim();
  };
  const setWorktreeStatus = (id: string, status: 'merged' | 'removed') =>
    input.db.update(worktrees).set({ status }).where(eq(worktrees.id, id)).run();

  type Landing = { ok: true } | { ok: false; reason: string; output: string; head: string };
  const tryLand = async (
    task: ParallelTask,
    tree: { path: string; branch: string },
  ): Promise<Landing> => {
    const dirty = await git(tree.path, 'status', '--porcelain');
    if (dirty.ok && dirty.output) {
      await git(tree.path, 'add', '-A');
      const commit = await git(tree.path, 'commit', '-m', `major: ${task.title} (${task.id})`);
      if (!commit.ok)
        return { ok: false, reason: 'commit failed', output: commit.output, head: '' };
    }
    const target = await head();
    const rebase = await git(tree.path, 'rebase', target);
    if (!rebase.ok) {
      await git(tree.path, 'rebase', '--abort');
      return { ok: false, reason: 'rebase conflict', output: rebase.output, head: target };
    }
    for (const command of input.verificationCommands) {
      // ponytail: whitespace split, no shell quoting; configure commands without quoted args.
      const [executable, ...args] = command.trim().split(/\s+/);
      const check = await run(executable!, args, tree.path, [root]);
      if (!check.ok) {
        return {
          ok: false,
          reason: `verification failed: ${command}`,
          output: check.output,
          head: target,
        };
      }
    }
    const ff = await git(input.repoPath, 'merge', '--ff-only', tree.branch);
    if (!ff.ok)
      return { ok: false, reason: 'fast-forward refused', output: ff.output, head: target };
    return { ok: true };
  };

  const integratorPrompt = async (
    task: ParallelTask,
    tree: { path: string; branch: string },
    base: string,
    failure: Extract<Landing, { ok: false }>,
  ) => {
    const target = failure.head || (await head());
    const taskDiff = await git(tree.path, 'diff', `${base}..${tree.branch}`);
    const headDiff = await git(tree.path, 'diff', `${base}..${target}`);
    return [
      'MAJOR MERGE-QUEUE INTEGRATOR (single attempt).',
      `Task ${task.id}: ${task.title}`,
      `Branch ${tree.branch} in this worktree could not land on integration head ${target}.`,
      `Reason: ${failure.reason}`,
      `Task diff (${base}..${tree.branch}):\n${clip(taskDiff.output)}`,
      `Integration changes since the task branched (${base}..${target}):\n${clip(headDiff.output)}`,
      `Failing output:\n${clip(failure.output)}`,
      `Rebase this branch onto ${target}, resolve conflicts keeping the intent of both sides, ` +
        `make these checks pass: ${input.verificationCommands.join('; ') || '(none configured)'}, ` +
        'and commit the result. Do not push, do not force anything, and stay inside this worktree.',
    ].join('\n\n');
  };

  let mergeQueue: Promise<unknown> = Promise.resolve();

  const land = async (
    task: ParallelTask,
    tree: { id: string; path: string; branch: string },
    base: string,
    outcome: WorkerOutcome,
    fence: ClaimFence,
  ): Promise<ParallelTaskResult> => {
    if (outcome.status !== 'succeeded') {
      releaseClaim(input.db, { ...fence, requeue: true, reason: `worker ${outcome.status}` });
      // Discard only this failed attempt's scratch tree; the task is requeued
      // and retried from the integration head. Never touches the integration branch.
      const removed = await git(input.repoPath, 'worktree', 'remove', '--force', tree.path);
      if (removed.ok) {
        await git(input.repoPath, 'branch', '-D', tree.branch);
        setWorktreeStatus(tree.id, 'removed');
      }
      return {
        taskId: task.id,
        outcome: 'requeued',
        detail: `worker ${outcome.status}`,
        integratorRuns: 0,
      };
    }
    const report = parseWorkerReport(outcome.stdout);
    if (report?.status === 'blocked') {
      transitionTask(input.db, task.id, 'needs_decision', { fence });
      completeClaim(input.db, fence.claimId, fence.workerId, `worker blocked: ${report.summary}`);
      return {
        taskId: task.id,
        outcome: 'blocked',
        detail: `worker blocked: ${report.ownerGate ?? report.summary}; branch ${tree.branch} kept`,
        integratorRuns: 0,
      };
    }
    let integratorRuns = 0;
    let landing = await tryLand(task, tree);
    if (!landing.ok) {
      integratorRuns = 1;
      const integrator = await input.runIntegrator(
        await integratorPrompt(task, tree, base, landing),
        tree.path,
      );
      if (integrator.status === 'succeeded') landing = await tryLand(task, tree);
      else landing = { ...landing, reason: `${landing.reason}; integrator ${integrator.status}` };
    }
    if (!landing.ok) {
      transitionTask(input.db, task.id, 'needs_decision', { fence });
      completeClaim(input.db, fence.claimId, fence.workerId, `merge blocked: ${landing.reason}`);
      // The worktree stays active so the owner can inspect the branch.
      return {
        taskId: task.id,
        outcome: 'blocked',
        detail: `${landing.reason}; branch ${tree.branch} kept at ${tree.path}`,
        integratorRuns,
      };
    }
    // Landed and verified on the integration head; the goal's normal
    // independent review owns completion from here.
    transitionTask(input.db, task.id, 'verifying', { fence });
    completeClaim(input.db, fence.claimId, fence.workerId, 'merged');
    setWorktreeStatus(tree.id, 'merged');
    const removed = await git(input.repoPath, 'worktree', 'remove', tree.path);
    if (removed.ok) await git(input.repoPath, 'branch', '-d', tree.branch);
    return {
      taskId: task.id,
      outcome: 'merged',
      detail: integratorRuns ? 'merged after integrator' : 'merged',
      integratorRuns,
    };
  };

  return Promise.all(
    input.tasks.map(async (task): Promise<ParallelTaskResult> => {
      const claimed = claimNextTask(input.db, {
        workerId,
        taskId: task.id,
        projectId: input.projectId,
        leaseMs: input.leaseMs,
      });
      if (!claimed) {
        return {
          taskId: task.id,
          outcome: 'skipped',
          detail: 'no longer queued',
          integratorRuns: 0,
        };
      }
      const fence = { claimId: claimed.claim.id, workerId };
      let tree: { id: string; path: string; branch: string };
      let base: string;
      try {
        base = await head();
        tree = {
          id: newId('wtree'),
          ...(await createTaskWorktree(run, input.repoPath, task.id, { base, root })),
        };
      } catch (error) {
        releaseClaim(input.db, { ...fence, requeue: true, reason: 'worktree setup failed' });
        return {
          taskId: task.id,
          outcome: 'requeued',
          detail: error instanceof Error ? error.message : String(error),
          integratorRuns: 0,
        };
      }
      input.db
        .insert(worktrees)
        .values({ ...tree, projectId: input.projectId, taskId: task.id, status: 'active' })
        .run();
      const outcome = await input.runTaskWorker(task, tree.path);
      // One landing at a time: each rebase sees every earlier landing.
      const landed = mergeQueue.then(() => land(task, tree, base, outcome, fence));
      mergeQueue = landed.catch(() => undefined);
      try {
        return await landed;
      } catch (error) {
        // Never reject the batch: siblings must finish before the caller
        // releases the integration checkout's writer fence.
        return {
          taskId: task.id,
          outcome: 'blocked',
          detail: `landing error: ${error instanceof Error ? error.message : String(error)}; branch ${tree.branch} kept`,
          integratorRuns: 0,
        };
      }
    }),
  );
}

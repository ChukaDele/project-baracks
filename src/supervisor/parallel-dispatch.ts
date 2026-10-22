import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { basename, isAbsolute, join, matchesGlob } from 'node:path';
import { and, asc, eq, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { tasks, worktrees, type BillingMode } from '../db/schema.js';
import {
  claimNextTask,
  completeClaim,
  heartbeatClaim,
  recoverExpiredClaims,
  releaseClaim,
} from '../domain/claim-service.js';
import { newId } from '../domain/ids.js';
import { createRun, recordVerificationRun, setRunStatus } from '../domain/run-service.js';
import {
  addEvidence,
  applyTransition,
  transitionTask,
  type ClaimFence,
} from '../domain/task-service.js';
import { runGatewayCommand, type WorkerOutcome } from './worker.js';
import { parseWorkerReport } from './worker-report.js';
import {
  releaseResource,
  requestResource,
  waitForResource,
  type ResourceLease,
} from './resources.js';
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
 * canonical execution gateway, exactly like `major delegate --worktree`.
 * Non-git commands (project verification) hold a fenced worker lease, as the
 * contained backend requires for anything that runs project code. */
export const gatewayCommand: RunCommand = async (executable, args, cwd, extraAllowedRoots = []) => {
  const timeoutMs = 30 * 60 * 1000;
  let lease: ResourceLease | undefined;
  try {
    if (executable !== 'git') {
      const request = requestResource({
        kind: 'worker',
        owner: `major:verify:${process.pid}:${randomUUID()}`,
        project: basename(cwd),
        pid: process.pid,
        ttlMs: timeoutMs + 5 * 60 * 1000,
      });
      if (request.status === 'rejected') return { ok: false, output: request.reason };
      lease = request.status === 'active' ? request.lease : await waitForResource(request.request);
    }
    const result = await runGatewayCommand({
      executable,
      args,
      cwd,
      timeoutMs,
      extraAllowedRoots,
      ...(lease
        ? {
            resourceLeaseId: lease.id,
            resourceLeaseFencingToken: lease.fencingToken,
            resourceLeaseTtlMs: lease.ttlMs,
          }
        : {}),
    });
    return { ok: result.status === 'succeeded', output: `${result.stdout}${result.stderr}`.trim() };
  } catch (error) {
    return { ok: false, output: error instanceof Error ? error.message : String(error) };
  } finally {
    if (lease) releaseResource(lease.id, lease.fencingToken);
  }
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

/** The routed worker's persisted provider/model, recorded on each landed
 * task's canonical implementation run. */
export interface ParallelRunProvenance {
  providerId: string;
  modelId: string;
  modelRef: string;
  billingMode: BillingMode;
  routingReason: string;
}

export interface ParallelBatchInput {
  db: Db;
  repoPath: string;
  projectId: string;
  tasks: readonly ParallelTask[];
  verificationCommands: readonly string[];
  runProvenance: ParallelRunProvenance;
  /** Claim lease length; a heartbeat renews it while the task is in flight. */
  leaseMs: number;
  heartbeatMs?: number;
  runTaskWorker: (task: ParallelTask, cwd: string) => Promise<WorkerOutcome>;
  runIntegrator: (prompt: string, cwd: string) => Promise<WorkerOutcome>;
  run?: RunCommand;
  worktreeRoot?: string;
}

/** Why the parallel path must not run for this checkout, if anything. */
export async function parallelRefusal(
  repoPath: string,
  verificationCommands: readonly string[],
  run: RunCommand = gatewayCommand,
): Promise<string | undefined> {
  if (verificationCommands.length === 0) {
    return 'parallel workers need project verificationCommands to gate each landing';
  }
  const branch = await run('git', ['symbolic-ref', '-q', 'HEAD'], repoPath);
  if (!branch.ok) return 'parallel workers need the goal checkout on a branch, not a detached HEAD';
  return undefined;
}

const DIFF_LIMIT = 20_000;
// The gateway gives git an isolated HOME, so Major's own merge-queue commits
// carry an explicit identity instead of whatever git would guess.
const MAJOR_GIT_IDENTITY = ['-c', 'user.name=Major', '-c', 'user.email=major@localhost'];

function clip(text: string): string {
  return text.length > DIFF_LIMIT ? `${text.slice(0, DIFF_LIMIT)}\n[truncated]` : text;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
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
  /** Renew the claim; throws StaleClaimError when it was lost. */
  const renew = (fence: ClaimFence) =>
    heartbeatClaim(input.db, fence.claimId, fence.workerId, input.leaseMs);

  type Failure = { ok: false; reason: string; output: string; head: string };
  type Check = { command: string; output: string };
  type Landing = { ok: true; checks: Check[] } | Failure;
  const fail = (reason: string, output = '', target = ''): Failure => ({
    ok: false,
    reason,
    output,
    head: target,
  });

  const rebaseInProgress = async (cwd: string) => {
    for (const name of ['rebase-merge', 'rebase-apply']) {
      const path = await git(cwd, 'rev-parse', '--git-path', name);
      if (path.ok && existsSync(isAbsolute(path.output) ? path.output : join(cwd, path.output))) {
        return true;
      }
    }
    return false;
  };

  const tryLand = async (
    task: ParallelTask,
    tree: { path: string; branch: string },
    fence: ClaimFence,
  ): Promise<Landing> => {
    // Never abort a rebase Major did not start: it may hold resolved work.
    if (await rebaseInProgress(tree.path)) return fail('a rebase is left in progress');
    const current = await git(tree.path, 'symbolic-ref', '--short', '-q', 'HEAD');
    if (current.output !== tree.branch) {
      return fail(`worktree is not on its task branch ${tree.branch}`, current.output);
    }
    const dirty = await git(tree.path, 'status', '--porcelain');
    if (dirty.ok && dirty.output) {
      await git(tree.path, 'add', '-A');
      const commit = await git(
        tree.path,
        ...MAJOR_GIT_IDENTITY,
        'commit',
        '-m',
        `major: ${task.title} (${task.id})`,
      );
      if (!commit.ok) return fail('commit failed', commit.output);
    }
    const target = await head();
    const rebase = await git(tree.path, ...MAJOR_GIT_IDENTITY, 'rebase', target);
    if (!rebase.ok) {
      await git(tree.path, 'rebase', '--abort');
      return fail('rebase conflict', rebase.output, target);
    }
    const changed = await git(tree.path, 'diff', '--name-only', `${target}..HEAD`);
    const undeclared = changed.output
      .split('\n')
      .filter(Boolean)
      .filter(
        (file) => !task.paths.some((glob) => matchesGlob(file, glob.trim().replace(/^\.\//, ''))),
      );
    if (!changed.ok || undeclared.length > 0) {
      return fail(
        `changes outside declared paths (${task.paths.join(', ')})`,
        changed.ok ? undeclared.join('\n') : changed.output,
        target,
      );
    }
    const checks: Check[] = [];
    for (const command of input.verificationCommands) {
      // ponytail: whitespace split, no shell quoting; configure commands without quoted args.
      const [executable, ...args] = command.trim().split(/\s+/);
      const check = await run(executable!, args, tree.path, [root]);
      if (!check.ok) return fail(`verification failed: ${command}`, check.output, target);
      checks.push({ command, output: check.output });
    }
    renew(fence); // a lost claim must not land
    const ff = await git(input.repoPath, 'merge', '--ff-only', tree.branch);
    if (!ff.ok) return fail('fast-forward refused', ff.output, target);
    return { ok: true, checks };
  };

  const integratorPrompt = async (
    task: ParallelTask,
    tree: { path: string; branch: string },
    base: string,
    failure: Failure,
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
      `Rebase branch ${tree.branch} onto ${target}, resolve conflicts keeping the intent of both sides, ` +
        `change only files matching ${task.paths.join(', ')}, ` +
        `make these checks pass: ${input.verificationCommands.join('; ')}, ` +
        `and commit the result on ${tree.branch} with no rebase left in progress. ` +
        'Do not push, do not force anything, and stay inside this worktree.',
    ].join('\n\n');
  };

  /** Park a task for the owner; the worktree stays for inspection. */
  const park = (task: ParallelTask, fence: ClaimFence, reason: string) => {
    try {
      transitionTask(input.db, task.id, 'needs_decision', { fence });
      completeClaim(input.db, fence.claimId, fence.workerId, reason);
    } catch {
      // Claim already lost: expired-claim recovery requeues the task.
    }
  };

  const land = async (
    task: ParallelTask,
    tree: { id: string; path: string; branch: string },
    base: string,
    outcome: WorkerOutcome,
    fence: ClaimFence,
  ): Promise<ParallelTaskResult> => {
    renew(fence);
    const sessionRef = outcome.sessionRef?.trim();
    // Like the single-worker cycle, a result without a durable session identity
    // is refused: the landed task's canonical run must carry one.
    const refused =
      outcome.status !== 'succeeded'
        ? `worker ${outcome.status}`
        : sessionRef
          ? undefined
          : 'worker returned no durable session identity';
    if (refused) {
      releaseClaim(input.db, { ...fence, requeue: true, reason: refused });
      // Discard only this failed attempt's own scratch tree and branch; the
      // task is retried from the integration head. Never touches the goal checkout.
      const removed = await git(input.repoPath, 'worktree', 'remove', '--force', tree.path);
      if (removed.ok) {
        await git(input.repoPath, 'branch', '-D', tree.branch);
        setWorktreeStatus(tree.id, 'removed');
      }
      return { taskId: task.id, outcome: 'requeued', detail: refused, integratorRuns: 0 };
    }
    const report = parseWorkerReport(outcome.stdout);
    if (report?.status === 'blocked') {
      park(task, fence, `worker blocked: ${report.summary}`);
      return {
        taskId: task.id,
        outcome: 'blocked',
        detail: `worker blocked: ${report.ownerGate ?? report.summary}; branch ${tree.branch} kept`,
        integratorRuns: 0,
      };
    }
    let integratorRuns = 0;
    let landing = await tryLand(task, tree, fence);
    if (!landing.ok) {
      integratorRuns = 1;
      const integrator = await input.runIntegrator(
        await integratorPrompt(task, tree, base, landing),
        tree.path,
      );
      renew(fence);
      if (integrator.status === 'succeeded') landing = await tryLand(task, tree, fence);
      else landing = { ...landing, reason: `${landing.reason}; integrator ${integrator.status}` };
    }
    if (!landing.ok) {
      park(task, fence, `merge blocked: ${landing.reason}`);
      return {
        taskId: task.id,
        outcome: 'blocked',
        detail: `${landing.reason}; branch ${tree.branch} kept at ${tree.path}`,
        integratorRuns,
      };
    }
    // Landed and verified on the goal checkout. Record the canonical
    // implementation run at the landed head with the merge queue's passed
    // checks as its verification evidence; promoteNextLandedTask later routes
    // the task into the independent completion review.
    const landedHead = await head();
    const agentRun = createRun(input.db, {
      taskId: task.id,
      ...input.runProvenance,
      claimId: fence.claimId,
      claimWorkerId: fence.workerId,
      worktreeId: tree.id,
      purpose: 'implementation',
      sourceHead: landedHead,
    });
    setRunStatus(input.db, agentRun.id, 'running');
    setRunStatus(input.db, agentRun.id, 'succeeded', {
      sessionRef: sessionRef!,
      usage: outcome.usage,
    });
    for (const check of landing.checks) {
      const verification = recordVerificationRun(input.db, {
        taskId: task.id,
        command: check.command,
        status: 'passed',
        exitCode: 0,
        outputSummary: clip(check.output),
        agentRunId: agentRun.id,
      });
      addEvidence(input.db, {
        taskId: task.id,
        agentRunId: agentRun.id,
        kind: 'verification_run',
        ref: verification.id,
        summary: `merge queue verification passed at ${landedHead}: ${check.command}`,
      });
    }
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

  let mergeQueue: Promise<unknown> = Promise.resolve();

  // Each per-task promise always resolves, so the batch never returns while a
  // sibling worker or landing is still running in the goal checkout.
  return Promise.all(
    input.tasks.map(async (task): Promise<ParallelTaskResult> => {
      let fence: ClaimFence;
      try {
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
        fence = { claimId: claimed.claim.id, workerId };
      } catch (error) {
        return { taskId: task.id, outcome: 'skipped', detail: message(error), integratorRuns: 0 };
      }
      const heartbeat = setInterval(() => {
        try {
          renew(fence);
        } catch {
          // Lost claims are caught again by renew() before any landing.
        }
      }, input.heartbeatMs ?? 60_000);
      heartbeat.unref();
      let tree: { id: string; path: string; branch: string } | undefined;
      try {
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
            detail: message(error),
            integratorRuns: 0,
          };
        }
        const created = tree;
        input.db
          .insert(worktrees)
          .values({ ...created, projectId: input.projectId, taskId: task.id, status: 'active' })
          .run();
        const outcome = await input.runTaskWorker(task, created.path);
        // One landing at a time: each rebase sees every earlier landing.
        const landed = mergeQueue.then(() => land(task, created, base, outcome, fence));
        mergeQueue = landed.catch(() => undefined);
        return await landed;
      } catch (error) {
        park(task, fence, `parallel dispatch error: ${message(error)}`);
        return {
          taskId: task.id,
          outcome: 'blocked',
          detail: `error: ${message(error)}${tree ? `; branch ${tree.branch} kept` : ''}`,
          integratorRuns: 0,
        };
      } finally {
        clearInterval(heartbeat);
      }
    }),
  );
}

/** Move the oldest merge-queue-landed (verifying) task into the existing
 * completion gate: verifying -> reviewing -> ready_to_merge. Only one task is
 * in the gate at a time, because resolveCanonicalTaskBinding accepts exactly
 * one ready_to_merge task. The goal's independent completion review is the
 * review this gate waits on; its pass grade is what completes the task. */
export function promoteNextLandedTask(db: Db, projectId: string): string | undefined {
  return db.transaction(
    (tx) => {
      const inGate = tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(
          and(
            eq(tasks.projectId, projectId),
            inArray(tasks.status, ['reviewing', 'ready_to_merge']),
          ),
        )
        .get();
      if (inGate) return undefined;
      const next = tx
        .select({ id: tasks.id })
        .from(tasks)
        .where(and(eq(tasks.projectId, projectId), eq(tasks.status, 'verifying')))
        .orderBy(asc(tasks.createdAt))
        .get();
      if (!next) return undefined;
      applyTransition(tx, next.id, 'reviewing');
      applyTransition(tx, next.id, 'ready_to_merge');
      return next.id;
    },
    { behavior: 'immediate' },
  );
}

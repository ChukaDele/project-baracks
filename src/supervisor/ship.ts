import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { executeSupervisorHostCommand } from '../security/major-gateway.js';
import type { RunCommand } from './parallel-dispatch.js';
import type { ProjectPolicy } from './policy.js';
import { releaseResource, requestResource, waitForResource } from './resources.js';
import { majorHome } from './state.js';

/**
 * Supervisor-side validation and shipping for a goal's committed candidate.
 *
 * The worker runs inside Seatbelt with no dependencies, no package-manager
 * launcher and no GitHub credential, by design. After it commits, the
 * supervisor (on the host, outside the worker sandbox) checks out that exact
 * head in a throwaway detached worktree, installs dependencies, and runs the
 * owner-configured verificationCommands. When the independent review then
 * passes, the supervisor pushes the branch and opens the PR itself, and
 * returns the owner's checkout to the branch it started on. No credential
 * ever enters the worker.
 */

/** Only these GitHub owners ever receive a supervisor push. */
const ALLOWED_PUSH_OWNERS = new Set(['chukadele']);
const OUTPUT_TAIL = 8_000;

export interface HostValidation {
  sourceHead: string;
  ok: boolean;
  summary: string;
  checks: { command: string; ok: boolean; output: string }[];
  at: string;
}

/** Host validation runs worker-written code outside the sandbox, and shipping
 * is an external write, so both follow the owner's explicit build approval. */
export function supervisorShipEnabled(
  policy: Pick<ProjectPolicy, 'ownerApprovedBuild' | 'allowExternalWrites'>,
  verificationCommands: readonly string[],
): boolean {
  return (
    verificationCommands.length > 0 && (policy.ownerApprovedBuild || policy.allowExternalWrites)
  );
}

function tail(text: string): string {
  return text.length > OUTPUT_TAIL ? text.slice(-OUTPUT_TAIL) : text;
}

/** Production runner: the gateway's audited supervisor host entry point. */
export const hostCommand: RunCommand = (executable, args, cwd) =>
  executeSupervisorHostCommand(executable, args, cwd);

export async function currentBranch(
  run: RunCommand,
  repoPath: string,
): Promise<string | undefined> {
  const result = await run('git', ['symbolic-ref', '--short', '-q', 'HEAD'], repoPath);
  return result.ok && result.output ? result.output : undefined;
}

function installCommand(root: string): string[] | undefined {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return ['pnpm', 'install', '--frozen-lockfile'];
  if (existsSync(join(root, 'package-lock.json'))) return ['npm', 'ci'];
  return undefined;
}

/** Validate the committed HEAD of repoPath in a detached throwaway worktree,
 * so build outputs never change the canonical tree the review is bound to. */
export async function validateCommittedHead(input: {
  repoPath: string;
  sourceHead: string;
  verificationCommands: readonly string[];
  /** The project's allowedExecutables bound what the host runs. */
  allowedExecutables: readonly string[];
  run?: RunCommand;
}): Promise<HostValidation> {
  const run = input.run ?? hostCommand;
  const at = new Date().toISOString();
  const result = (ok: boolean, summary: string, checks: HostValidation['checks'] = []) => ({
    sourceHead: input.sourceHead,
    ok,
    summary,
    checks,
    at,
  });
  const install = installCommand(input.repoPath);
  const commands = [...(install ? [install.join(' ')] : []), ...input.verificationCommands];
  const refused = commands.find(
    (command) => !input.allowedExecutables.includes(command.trim().split(/\s+/)[0]!),
  );
  if (refused) return result(false, `executable not in project allowedExecutables: ${refused}`);
  const status = await run(
    'git',
    ['status', '--porcelain', '--untracked-files=normal'],
    input.repoPath,
  );
  if (!status.ok) return result(false, `git status failed: ${status.output}`);
  if (status.output) {
    return result(
      false,
      'uncommitted changes: commit the change on a feature branch; Major validates and ships only the committed head',
    );
  }
  const root = join(majorHome(), 'worktrees', 'validate');
  mkdirSync(root, { recursive: true });
  const tree = join(root, `${Date.now()}-${input.sourceHead.slice(0, 12)}`);
  const add = await run(
    'git',
    ['worktree', 'add', '--detach', tree, input.sourceHead],
    input.repoPath,
  );
  if (!add.ok) return result(false, `validation worktree setup failed: ${add.output}`);
  const checks: HostValidation['checks'] = [];
  try {
    for (const command of commands) {
      // ponytail: whitespace split, no shell quoting (same as the merge queue).
      const [executable, ...args] = command.trim().split(/\s+/);
      const check = await run(executable!, args, tree);
      checks.push({ command, ok: check.ok, output: tail(check.output) });
      if (!check.ok) return result(false, `host validation failed: ${command}`, checks);
    }
    return result(true, `host validation passed: ${commands.join('; ')}`, checks);
  } finally {
    await run('git', ['worktree', 'remove', '--force', tree], input.repoPath);
  }
}

/** Host validation installs and builds, so it holds one Major build lease. */
export async function validateUnderBuildLease(
  project: string,
  input: Parameters<typeof validateCommittedHead>[0],
): Promise<HostValidation> {
  const request = requestResource({
    kind: 'build',
    owner: `major:host-validation:${process.pid}`,
    project,
    pid: process.pid,
    ttlMs: 35 * 60 * 1000,
  });
  if (request.status === 'rejected') {
    return {
      sourceHead: input.sourceHead,
      ok: false,
      summary: `host validation could not get a build lease: ${request.reason}`,
      checks: [],
      at: new Date().toISOString(),
    };
  }
  const lease =
    request.status === 'active' ? request.lease : await waitForResource(request.request);
  try {
    return await validateCommittedHead(input);
  } finally {
    releaseResource(lease.id, lease.fencingToken);
  }
}

export type ShipResult = { ok: true; url: string; branch: string } | { ok: false; reason: string };

function githubRepo(remoteUrl: string): { owner: string; repo: string } | undefined {
  const match = /github\.com[:/]([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/i.exec(remoteUrl.trim());
  return match ? { owner: match[1]!, repo: match[2]! } : undefined;
}

/** Push the checkout's current feature branch and open (or reuse) its PR. */
export async function shipBranch(input: {
  repoPath: string;
  base: string;
  protectedBranches: readonly string[];
  title: string;
  body: string;
  run?: RunCommand;
}): Promise<ShipResult> {
  const run = input.run ?? hostCommand;
  const git = (...args: string[]) => run('git', args, input.repoPath);
  const branch = await currentBranch(run, input.repoPath);
  if (!branch) return { ok: false, reason: 'checkout is not on a branch' };
  if (branch === input.base || input.protectedBranches.includes(branch)) {
    return { ok: false, reason: `refusing to push protected or base branch ${branch}` };
  }
  const status = await git('status', '--porcelain', '--untracked-files=normal');
  if (!status.ok || status.output) return { ok: false, reason: 'checkout has uncommitted changes' };
  const ahead = await git('rev-list', '--count', `${input.base}..HEAD`);
  if (!ahead.ok || Number(ahead.output) < 1) {
    return { ok: false, reason: `branch ${branch} has no commits ahead of ${input.base}` };
  }
  const remote = await git('remote', 'get-url', 'origin');
  const target = remote.ok ? githubRepo(remote.output) : undefined;
  if (!target || !ALLOWED_PUSH_OWNERS.has(target.owner.toLowerCase())) {
    return {
      ok: false,
      reason: `origin ${remote.output || '(none)'} is not an allowed push remote`,
    };
  }
  const slug = `${target.owner}/${target.repo}`;
  const push = await git('push', '-u', 'origin', branch);
  if (!push.ok) return { ok: false, reason: `git push failed: ${push.output}` };
  const existing = await run(
    'gh',
    [
      'pr',
      'list',
      '--repo',
      slug,
      '--head',
      branch,
      '--state',
      'open',
      '--json',
      'url',
      '--jq',
      '.[0].url // ""',
    ],
    input.repoPath,
  );
  if (existing.ok && existing.output.startsWith('https://')) {
    return { ok: true, url: existing.output, branch };
  }
  const created = await run(
    'gh',
    [
      'pr',
      'create',
      '--repo',
      slug,
      '--base',
      input.base,
      '--head',
      branch,
      '--title',
      input.title,
      '--body',
      input.body,
    ],
    input.repoPath,
  );
  const url = /https:\/\/github\.com\/\S+\/pull\/\d+/.exec(created.output)?.[0];
  if (!created.ok || !url) return { ok: false, reason: `gh pr create failed: ${created.output}` };
  return { ok: true, url, branch };
}

/** Return the owner's checkout to the branch the goal started on. */
export async function restoreCheckout(
  repoPath: string,
  branch: string,
  run: RunCommand = hostCommand,
): Promise<string> {
  const current = await currentBranch(run, repoPath);
  if (current === branch) return `checkout already on ${branch}`;
  const status = await run('git', ['status', '--porcelain', '--untracked-files=normal'], repoPath);
  if (!status.ok || status.output)
    return `checkout left on ${current ?? 'HEAD'}: uncommitted changes`;
  const checkout = await run('git', ['checkout', branch], repoPath);
  return checkout.ok
    ? `checkout returned to ${branch}`
    : `checkout left on ${current ?? 'HEAD'}: ${checkout.output}`;
}

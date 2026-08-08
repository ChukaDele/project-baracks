import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import {
  attachSession,
  getGoal,
  resolveProject,
  resolveProjectForCwd,
  startGoal,
  updateGoal,
  WORKER_HOSTS,
  type GoalStatus,
  type WorkerHost,
} from './state.js';
import { runDaemon, runGoalCycle, supervisorSnapshot } from './runtime.js';
import { runWorker } from './worker.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function requireFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`missing required ${name}`);
  return value;
}

function validHost(value: string): WorkerHost {
  if (!WORKER_HOSTS.includes(value as WorkerHost)) {
    throw new Error(`unsupported provider: ${value}`);
  }
  return value as WorkerHost;
}

function kickGoal(goalId: string): void {
  const entry = process.argv[1];
  if (!entry) return;
  const child = spawn(process.execPath, [entry, 'supervisor', 'cycle', '--goal-id', goalId], {
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString('utf8');
}

export async function runSupervisorCli(args: string[]): Promise<boolean> {
  const command = args[0];
  if (!command) return false;

  if (command === 'run' && args[1] && !args.includes('--task')) {
    const projectArg = args[1];
    const goalText = requireFlag(args, '--goal');
    const project = resolveProject(projectArg);
    const preferredRaw = flag(args, '--coordinator');
    const goal = startGoal({
      project: project.project,
      repoPath: project.repoPath,
      goal: goalText,
      autonomous: hasFlag(args, '--autonomous'),
      ...(preferredRaw ? { preferredCoordinator: validHost(preferredRaw) } : {}),
    });
    console.log(`Major goal active: ${goal.id}`);
    console.log(`project: ${goal.project}`);
    console.log(`repo: ${goal.repoPath}`);
    console.log(`goal: ${goal.goal}`);
    console.log(`autonomous: ${goal.autonomous ? 'yes' : 'no'}`);
    if (goal.autonomous) kickGoal(goal.id);
    return true;
  }

  if (command === 'status') {
    console.log(supervisorSnapshot(args[1]));
    return true;
  }

  if (command === 'goal' && args[1] === 'report') {
    const id = requireFlag(args, '--id');
    const statusRaw = requireFlag(args, '--status');
    const allowed: GoalStatus[] = ['active', 'blocked', 'done', 'failed', 'paused', 'running'];
    if (!allowed.includes(statusRaw as GoalStatus)) {
      throw new Error(`invalid goal status: ${statusRaw}`);
    }
    const summary = requireFlag(args, '--summary');
    const ownerGate = flag(args, '--owner-gate');
    const patch: Parameters<typeof updateGoal>[1] = {
      status: statusRaw as GoalStatus,
      lastSummary: summary,
      lastFinishedAt: new Date().toISOString(),
      activePid: undefined,
      ownerGate,
    };
    updateGoal(id, patch);
    console.log(`goal ${id}: ${statusRaw}`);
    return true;
  }

  if (command === 'session' && (args[1] === 'attach' || args[1] === 'hook')) {
    const host = flag(args, '--host') ?? 'unknown';
    let cwd = flag(args, '--cwd') ?? process.cwd();
    let sessionId = flag(args, '--session-id');
    if (args[1] === 'hook') {
      const input = await readStdin();
      if (input) {
        try {
          const parsed = JSON.parse(input) as { cwd?: string; session_id?: string };
          cwd = parsed.cwd ?? cwd;
          sessionId = parsed.session_id ?? sessionId;
        } catch {
          // Keep defaults; hook context is advisory.
        }
      }
    }
    const project = resolveProjectForCwd(cwd);
    attachSession({
      host,
      cwd,
      ...(project ? { project: project.project, repoPath: project.repoPath } : {}),
      ...(sessionId ? { sessionId } : {}),
    });
    const active = project
      ? supervisorSnapshot(project.project)
      : 'No git project detected in this session.';
    console.log(
      `MAJOR DEFAULT SUPERVISOR: ACTIVE\nhost: ${host}\ncwd: ${resolve(cwd)}\n${active}\n\nBefore substantive work: preserve the user outcome as the durable goal. For broad/multi-step work, create or continue a Major goal and let Major own orchestration; do not start a separate untracked implementation. For small bounded work, execute directly under Major rules. Continue until end-to-end evidence or a genuine owner gate.`,
    );
    return true;
  }

  if (command === 'delegate') {
    const provider = validHost(requireFlag(args, '--provider'));
    const cwd = resolve(requireFlag(args, '--cwd'));
    const prompt = requireFlag(args, '--prompt');
    const worktree = flag(args, '--worktree');
    let runCwd = cwd;
    if (worktree) {
      const safe =
        worktree.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
      const projectName = basename(cwd);
      const root = join(homedir(), '.major', 'worktrees', projectName);
      mkdirSync(root, { recursive: true });
      const stamp = Date.now();
      runCwd = join(root, `${stamp}-${safe}`);
      const branch = `major/${stamp}-${safe}`;
      const git = spawnSync('git', ['worktree', 'add', '-b', branch, runCwd], {
        cwd,
        encoding: 'utf8',
      });
      if (git.status !== 0) {
        throw new Error(`worktree setup failed: ${git.stderr || git.stdout || 'unknown git error'}`);
      }
      console.error(`Major worktree: ${runCwd} (${branch})`);
    }
    const outcome = await runWorker({ host: provider, cwd: runCwd, prompt });
    process.stdout.write(outcome.stdout);
    if (outcome.stderr) process.stderr.write(outcome.stderr);
    if (outcome.status !== 'succeeded') process.exitCode = 1;
    return true;
  }

  if (command === 'supervisor' && args[1] === 'cycle') {
    await runGoalCycle(requireFlag(args, '--goal-id'));
    return true;
  }

  if (command === 'supervisor' && args[1] === 'daemon') {
    await runDaemon();
    return true;
  }

  if (command === 'goal' && args[1] === 'show') {
    const goal = getGoal(requireFlag(args, '--id'));
    console.log(goal ? JSON.stringify(goal, null, 2) : 'goal not found');
    return true;
  }

  return false;
}

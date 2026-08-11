import { randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { redactText } from '../security/redact.js';

export const GOAL_STATUSES = ['active', 'running', 'blocked', 'done', 'failed', 'paused'] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];
export const WORKER_HOSTS = ['claude', 'codex', 'cursor', 'antigravity'] as const;
export type WorkerHost = (typeof WORKER_HOSTS)[number];

export interface SupervisorGoal {
  id: string;
  project: string;
  repoPath: string;
  goal: string;
  autonomous: boolean;
  status: GoalStatus;
  preferredCoordinator: WorkerHost;
  cycle: number;
  consecutiveFailures: number;
  createdAt: string;
  updatedAt: string;
  lastStartedAt?: string | undefined;
  lastFinishedAt?: string | undefined;
  lastSummary?: string | undefined;
  ownerGate?: string | undefined;
  activePid?: number | undefined;
  nextRunAt?: string | undefined;
  lastCoordinator?: WorkerHost | undefined;
  pendingCompletion?:
    | {
        summary: string;
        coordinator: WorkerHost;
        claimedAt: string;
      }
    | undefined;
}

export interface SessionAttachment {
  id: string;
  host: string;
  cwd: string;
  project?: string | undefined;
  repoPath?: string | undefined;
  sessionId?: string | undefined;
  attachedAt: string;
}

export interface SupervisorState {
  version: 1;
  goals: SupervisorGoal[];
  sessions: SessionAttachment[];
}

export function majorHome(): string {
  return process.env.MAJOR_HOME ? resolve(process.env.MAJOR_HOME) : join(homedir(), '.major');
}

export function statePath(): string {
  return process.env.MAJOR_STATE_PATH
    ? resolve(process.env.MAJOR_STATE_PATH)
    : join(majorHome(), 'supervisor-state.json');
}

function emptyState(): SupervisorState {
  return { version: 1, goals: [], sessions: [] };
}

const stateLockSleep = new Int32Array(new SharedArrayBuffer(4));

function mutateSupervisorState<T>(operation: (state: SupervisorState) => T): T {
  const path = `${statePath()}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + 5_000;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(path, 'wx', 0o600);
      writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > 30_000) unlinkSync(path);
      } catch (staleError) {
        if ((staleError as NodeJS.ErrnoException).code !== 'ENOENT') throw staleError;
      }
      if (Date.now() >= deadline) throw new Error(`Major supervisor lock timed out: ${path}`);
      Atomics.wait(stateLockSleep, 0, 0, 10);
    }
  }
  try {
    const state = readSupervisorState();
    const result = operation(state);
    writeSupervisorState(state);
    return result;
  } finally {
    closeSync(fd);
    try {
      unlinkSync(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
}

export function readSupervisorState(): SupervisorState {
  const path = statePath();
  if (!existsSync(path)) return emptyState();
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as SupervisorState;
    if (parsed.version !== 1 || !Array.isArray(parsed.goals) || !Array.isArray(parsed.sessions)) {
      throw new Error('invalid supervisor state schema');
    }
    return parsed;
  } catch (error) {
    throw new Error(
      `cannot read Major supervisor state at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export function writeSupervisorState(state: SupervisorState): void {
  const path = statePath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

export function startGoal(input: {
  project: string;
  repoPath: string;
  goal: string;
  autonomous: boolean;
  preferredCoordinator?: WorkerHost;
}): SupervisorGoal {
  return mutateSupervisorState((state) => {
    const now = new Date().toISOString();
    for (const existing of state.goals) {
      if (
        existing.project === input.project &&
        ['active', 'running', 'blocked'].includes(existing.status)
      ) {
        existing.goal = input.goal;
        existing.repoPath = resolve(input.repoPath);
        existing.autonomous = input.autonomous;
        existing.status = 'active';
        existing.updatedAt = now;
        existing.ownerGate = undefined;
        existing.pendingCompletion = undefined;
        existing.nextRunAt = now;
        return existing;
      }
    }
    const goal: SupervisorGoal = {
      id: randomUUID(),
      project: input.project,
      repoPath: resolve(input.repoPath),
      goal: input.goal,
      autonomous: input.autonomous,
      status: 'active',
      preferredCoordinator: input.preferredCoordinator ?? 'claude',
      cycle: 0,
      consecutiveFailures: 0,
      createdAt: now,
      updatedAt: now,
      nextRunAt: now,
    };
    state.goals.push(goal);
    return goal;
  });
}

export function updateGoal(id: string, patch: Partial<Omit<SupervisorGoal, 'id'>>): SupervisorGoal {
  return mutateSupervisorState((state) => {
    const goal = state.goals.find((candidate) => candidate.id === id);
    if (!goal) throw new Error(`goal not found: ${id}`);
    Object.assign(goal, patch, { updatedAt: new Date().toISOString() });
    return goal;
  });
}

/** Apply an independent grade to the currently pending worker completion
 * claim. A worker claim alone can never mark a goal done. */
export function applyIndependentCompletionGrade(input: {
  goalId: string;
  provider: WorkerHost;
  result: 'pass' | 'fail';
  evidence: string;
}): SupervisorGoal {
  return mutateSupervisorState((state) => {
    const goal = state.goals.find((candidate) => candidate.id === input.goalId);
    if (!goal) throw new Error(`goal not found: ${input.goalId}`);
    const pending = goal.pendingCompletion;
    if (!pending) throw new Error(`goal ${input.goalId} has no pending completion claim`);
    if (pending.coordinator === input.provider) {
      throw new Error(
        `independent completion grade refused: ${input.provider} made the completion claim`,
      );
    }
    const evidence = input.evidence.trim();
    if (!evidence) throw new Error('independent completion evidence must not be empty');
    goal.pendingCompletion = undefined;
    goal.activePid = undefined;
    goal.lastFinishedAt = new Date().toISOString();
    goal.ownerGate = undefined;
    goal.consecutiveFailures = 0;
    if (input.result === 'pass') {
      goal.status = 'done';
      goal.nextRunAt = undefined;
      goal.lastSummary = redactText(
        `Independent validation passed: ${pending.summary}. Evidence: ${evidence}`,
      );
    } else {
      goal.status = 'active';
      goal.nextRunAt = new Date().toISOString();
      goal.lastSummary = redactText(`Independent validation rejected completion: ${evidence}`);
    }
    goal.updatedAt = new Date().toISOString();
    return goal;
  });
}

export function getGoal(id: string): SupervisorGoal | undefined {
  return readSupervisorState().goals.find((goal) => goal.id === id);
}

export function activeGoals(project?: string): SupervisorGoal[] {
  return readSupervisorState().goals.filter(
    (goal) =>
      ['active', 'running', 'blocked'].includes(goal.status) &&
      (project === undefined || goal.project === project),
  );
}

export function attachSession(input: {
  host: string;
  cwd: string;
  project?: string;
  repoPath?: string;
  sessionId?: string;
}): SessionAttachment {
  return mutateSupervisorState((state) => {
    const attachment: SessionAttachment = {
      id: randomUUID(),
      host: input.host,
      cwd: resolve(input.cwd),
      attachedAt: new Date().toISOString(),
      ...(input.project ? { project: input.project } : {}),
      ...(input.repoPath ? { repoPath: resolve(input.repoPath) } : {}),
      ...(input.sessionId ? { sessionId: input.sessionId } : {}),
    };
    state.sessions = state.sessions.slice(-199);
    state.sessions.push(attachment);
    return attachment;
  });
}

function gitCommonDir(repoPath: string): string | undefined {
  const marker = join(repoPath, '.git');
  if (!existsSync(marker)) return undefined;

  try {
    if (statSync(marker).isDirectory()) return marker;
    const text = readFileSync(marker, 'utf8').trim();
    const match = /^gitdir:\s*(.+)$/i.exec(text);
    const rawGitDir = match?.[1]?.trim();
    if (!rawGitDir) return undefined;
    const gitDir = isAbsolute(rawGitDir) ? rawGitDir : resolve(repoPath, rawGitDir);
    const commonDirFile = join(gitDir, 'commondir');
    if (!existsSync(commonDirFile)) return gitDir;
    const common = readFileSync(commonDirFile, 'utf8').trim();
    if (!common) return gitDir;
    return isAbsolute(common) ? common : resolve(gitDir, common);
  } catch {
    return undefined;
  }
}

function readRemoteName(repoPath: string): string | undefined {
  const commonDir = gitCommonDir(repoPath);
  if (!commonDir) return undefined;
  const config = join(commonDir, 'config');
  if (!existsSync(config)) return undefined;
  const text = readFileSync(config, 'utf8');
  const matches = [...text.matchAll(/^\s*url\s*=\s*(.+)$/gm)];
  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    const cleaned = raw.replace(/\.git$/, '').replace(/\/$/, '');
    const repo = cleaned.split(/[/:]/).pop();
    if (repo) return repo;
  }
  return undefined;
}

function gitRootFrom(path: string): string | undefined {
  let current = resolve(path);
  for (;;) {
    if (existsSync(join(current, '.git'))) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function validRememberedRepoPath(path: string | undefined): string | undefined {
  if (!path) return undefined;
  const remembered = resolve(path);
  const root = gitRootFrom(remembered);
  return root === remembered ? remembered : undefined;
}

function scanRepos(root: string, depth: number): string[] {
  if (depth < 0 || !existsSync(root)) return [];
  const results: string[] = [];
  let entries: string[];
  try {
    entries = readdirSync(root);
  } catch {
    return results;
  }
  for (const entry of entries) {
    if (entry.startsWith('.') || ['node_modules', 'Library', 'Applications'].includes(entry))
      continue;
    const full = join(root, entry);
    let isDirectory = false;
    try {
      isDirectory = statSync(full).isDirectory();
    } catch {
      continue;
    }
    if (!isDirectory) continue;
    if (existsSync(join(full, '.git'))) {
      results.push(full);
      continue;
    }
    if (depth > 0) results.push(...scanRepos(full, depth - 1));
  }
  return results;
}

export function resolveProject(
  project: string,
  cwd = process.cwd(),
): { project: string; repoPath: string } {
  const cwdRoot = gitRootFrom(cwd);
  if (cwdRoot) {
    const cwdName = basename(cwdRoot);
    const remoteName = readRemoteName(cwdRoot);
    if (project === cwdName || project === remoteName || project === 'current') {
      return { project: remoteName ?? cwdName, repoPath: cwdRoot };
    }
  }

  const state = readSupervisorState();
  const priorGoal = [...state.goals].reverse().find((goal) => goal.project === project);
  const priorGoalPath = validRememberedRepoPath(priorGoal?.repoPath);
  if (priorGoalPath) return { project, repoPath: priorGoalPath };

  const priorSession = [...state.sessions].reverse().find((session) => session.project === project);
  const priorSessionPath = validRememberedRepoPath(priorSession?.repoPath);
  if (priorSessionPath) return { project, repoPath: priorSessionPath };

  const roots = [join(homedir(), 'Projects'), join(homedir(), 'Documents')];
  for (const root of roots) {
    for (const repoPath of scanRepos(root, 2)) {
      const local = basename(repoPath);
      const remote = readRemoteName(repoPath);
      if (project === local || project === remote) {
        return { project: remote ?? local, repoPath };
      }
    }
  }
  throw new Error(
    `cannot resolve project '${project}'. Open a Major-managed session inside the repo once, or bootstrap/register the project.`,
  );
}

export function resolveProjectForCwd(
  cwd: string,
): { project: string; repoPath: string } | undefined {
  const root = gitRootFrom(cwd);
  if (!root) return undefined;
  return { project: readRemoteName(root) ?? basename(root), repoPath: root };
}

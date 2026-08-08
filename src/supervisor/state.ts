import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';

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
  const state = readSupervisorState();
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
      existing.nextRunAt = now;
      writeSupervisorState(state);
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
  writeSupervisorState(state);
  return goal;
}

export function updateGoal(id: string, patch: Partial<Omit<SupervisorGoal, 'id'>>): SupervisorGoal {
  const state = readSupervisorState();
  const goal = state.goals.find((candidate) => candidate.id === id);
  if (!goal) throw new Error(`goal not found: ${id}`);
  Object.assign(goal, patch, { updatedAt: new Date().toISOString() });
  writeSupervisorState(state);
  return goal;
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
  const state = readSupervisorState();
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
  writeSupervisorState(state);
  return attachment;
}

function readRemoteName(repoPath: string): string | undefined {
  const config = join(repoPath, '.git', 'config');
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

  const prior = readSupervisorState().goals.find((goal) => goal.project === project);
  if (prior && existsSync(prior.repoPath)) return { project, repoPath: prior.repoPath };

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
    `cannot resolve project '${project}'. Run Major from inside the repo once, or bootstrap/register the project.`,
  );
}

export function resolveProjectForCwd(
  cwd: string,
): { project: string; repoPath: string } | undefined {
  const root = gitRootFrom(cwd);
  if (!root) return undefined;
  return { project: readRemoteName(root) ?? basename(root), repoPath: root };
}

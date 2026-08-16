import { createHash, randomUUID } from 'node:crypto';
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
  requiredOperations?: string[] | undefined;
  /** Set by the last cycle when it stopped on an authoritative provider
   * exhaustion/rate-limit (or a selected CLI turning out to be missing)
   * with other capacity still eligible: the foreground continuation loop
   * may immediately dispatch another cycle without a new owner action. */
  retryImmediately?: boolean | undefined;
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
  workshopAuthorization?:
    | {
        status: 'active' | 'revoked';
        authorizedAt: string;
        expiresAt: string;
        revokedAt?: string | undefined;
      }
    | undefined;
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
  requiredOperations?: string[];
}): SupervisorGoal {
  return mutateSupervisorState((state) => {
    const now = new Date().toISOString();
    const inputCommonDir = gitCommonDir(resolve(input.repoPath));
    for (const existing of state.goals) {
      if (
        (existing.project === input.project ||
          (inputCommonDir !== undefined &&
            gitCommonDir(resolve(existing.repoPath)) === inputCommonDir)) &&
        ['active', 'running', 'blocked'].includes(existing.status)
      ) {
        existing.project = input.project;
        existing.goal = input.goal;
        existing.repoPath = resolve(input.repoPath);
        existing.autonomous = input.autonomous;
        existing.requiredOperations = input.requiredOperations;
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
      ...(input.requiredOperations && input.requiredOperations.length > 0
        ? { requiredOperations: input.requiredOperations }
        : {}),
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

export function bindGoalToProject(
  id: string,
  project: string,
  repoPath: string,
): SupervisorGoal | undefined {
  return mutateSupervisorState((state) => {
    const goal = state.goals.find((candidate) => candidate.id === id);
    if (!goal) return undefined;
    const commonDir = gitCommonDir(resolve(repoPath));
    if (
      goal.project !== project &&
      (commonDir === undefined || gitCommonDir(resolve(goal.repoPath)) !== commonDir)
    ) {
      return undefined;
    }
    goal.project = project;
    goal.repoPath = resolve(repoPath);
    goal.updatedAt = new Date().toISOString();
    return goal;
  });
}

export function activeGoals(project?: string, repoPath?: string): SupervisorGoal[] {
  const commonDir = repoPath ? gitCommonDir(resolve(repoPath)) : undefined;
  return readSupervisorState().goals.filter(
    (goal) =>
      ['active', 'running', 'blocked'].includes(goal.status) &&
      (project === undefined ||
        goal.project === project ||
        (commonDir !== undefined && gitCommonDir(resolve(goal.repoPath)) === commonDir)),
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

export function authorizeSessionWorkshop(input: {
  host: string;
  cwd: string;
  project: string;
  repoPath: string;
  sessionId: string;
  expiresAt: string;
}): SessionAttachment {
  return mutateSupervisorState((state) => {
    const now = new Date().toISOString();
    const commonDir = gitCommonDir(resolve(input.repoPath));
    for (const session of state.sessions) {
      if (
        session.workshopAuthorization?.status === 'active' &&
        (session.project === input.project ||
          (commonDir !== undefined &&
            session.repoPath !== undefined &&
            gitCommonDir(resolve(session.repoPath)) === commonDir))
      ) {
        session.workshopAuthorization = {
          ...session.workshopAuthorization,
          status: 'revoked',
          revokedAt: now,
        };
      }
    }
    const attachment: SessionAttachment = {
      id: randomUUID(),
      host: input.host,
      cwd: resolve(input.cwd),
      project: input.project,
      repoPath: resolve(input.repoPath),
      sessionId: input.sessionId,
      attachedAt: now,
      workshopAuthorization: {
        status: 'active',
        authorizedAt: now,
        expiresAt: input.expiresAt,
      },
    };
    state.sessions = state.sessions.slice(-199);
    state.sessions.push(attachment);
    return attachment;
  });
}

export function revokeSessionWorkshop(input: { sessionId?: string; repoPath?: string }): number {
  return mutateSupervisorState((state) => {
    const now = new Date().toISOString();
    const commonDir = input.repoPath ? gitCommonDir(resolve(input.repoPath)) : undefined;
    let revoked = 0;
    for (const session of state.sessions) {
      if (
        session.workshopAuthorization?.status === 'active' &&
        (input.sessionId === undefined || session.sessionId === input.sessionId) &&
        (input.repoPath === undefined ||
          (commonDir !== undefined &&
            session.repoPath !== undefined &&
            gitCommonDir(resolve(session.repoPath)) === commonDir))
      ) {
        session.workshopAuthorization = {
          ...session.workshopAuthorization,
          status: 'revoked',
          revokedAt: now,
        };
        revoked += 1;
      }
    }
    return revoked;
  });
}

export function gitCommonDir(repoPath: string): string | undefined {
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

function repositoryIdentity(repoPath: string): string {
  const commonDir = gitCommonDir(repoPath);
  if (!commonDir) throw new Error(`not a git repository: ${repoPath}`);
  const config = join(commonDir, 'config');
  if (existsSync(config)) {
    const text = readFileSync(config, 'utf8');
    const origin = /\[remote "origin"\]([\s\S]*?)(?=\n\[|$)/.exec(text)?.[1];
    const raw = /^\s*url\s*=\s*(.+)$/m.exec(origin ?? '')?.[1]?.trim();
    if (raw) {
      const normalized = raw
        .replace(/^git@([^:]+):/, 'ssh://$1/')
        .replace(/\.git$/, '')
        .replace(/\/$/, '');
      try {
        const url = new URL(normalized);
        const hostname = url.hostname.toLowerCase();
        const pathname = hostname === 'github.com' ? url.pathname.toLowerCase() : url.pathname;
        return `${hostname}${pathname}`.replace(/\/$/, '');
      } catch {
        return `remote:${createHash('sha256').update(normalized).digest('hex').slice(0, 24)}`;
      }
    }
  }
  return `local:${createHash('sha256').update(resolve(commonDir)).digest('hex').slice(0, 24)}`;
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
    const identity = repositoryIdentity(cwdRoot);
    const remoteName = identity.split('/').pop();
    if (
      project === cwdName ||
      project === remoteName ||
      project === identity ||
      project === 'current'
    ) {
      return { project: identity, repoPath: cwdRoot };
    }
  }

  const state = readSupervisorState();
  const matchesProject = (repoPath: string): { project: string; repoPath: string } | undefined => {
    const identity = repositoryIdentity(repoPath);
    const remote = identity.split('/').pop();
    return project === basename(repoPath) || project === remote || project === identity
      ? { project: identity, repoPath }
      : undefined;
  };
  const active = state.goals
    .filter((goal) => ['active', 'running', 'blocked'].includes(goal.status))
    .flatMap((goal) => {
      const repoPath = validRememberedRepoPath(goal.repoPath);
      const match = repoPath ? matchesProject(repoPath) : undefined;
      return match ? [match] : [];
    });
  const activePaths = new Map(active.map((match) => [match.repoPath, match]));
  if (activePaths.size === 1) return [...activePaths.values()][0]!;
  if (activePaths.size > 1) {
    throw new Error(
      `project '${project}' has multiple active worktrees: ${[...activePaths.keys()].join(', ')}`,
    );
  }
  const sessionMatches = new Map<string, { project: string; repoPath: string }>();
  for (const session of [...state.sessions].reverse()) {
    const repoPath = validRememberedRepoPath(session.repoPath);
    const match = repoPath ? matchesProject(repoPath) : undefined;
    if (match && !sessionMatches.has(match.project)) sessionMatches.set(match.project, match);
  }
  if (sessionMatches.size === 1) return [...sessionMatches.values()][0]!;
  if (sessionMatches.size > 1) {
    throw new Error(
      `project '${project}' is ambiguous; use one canonical identity: ${[...sessionMatches.values()]
        .map((match) => `${match.project} (${match.repoPath})`)
        .join(', ')}`,
    );
  }
  const paths: string[] = state.goals.flatMap((goal) => {
    const repoPath = validRememberedRepoPath(goal.repoPath);
    return repoPath ? [repoPath] : [];
  });
  const roots = [join(homedir(), 'Projects'), join(homedir(), 'Documents')];
  for (const root of roots) {
    paths.push(...scanRepos(root, 2));
  }
  const matches = new Map<string, { identity: string; repoPath: string }>();
  for (const repoPath of paths) {
    const identity = repositoryIdentity(repoPath);
    const remote = identity.split('/').pop();
    if (project === basename(repoPath) || project === remote || project === identity) {
      matches.set(`${identity}\0${repoPath}`, { identity, repoPath });
    }
  }
  if (matches.size === 1) {
    const { identity, repoPath } = [...matches.values()][0]!;
    return { project: identity, repoPath };
  }
  if (matches.size > 1) {
    throw new Error(
      `project '${project}' is ambiguous; use an active worktree or canonical identity: ${[
        ...matches.values(),
      ]
        .map(({ identity, repoPath }) => `${identity} (${repoPath})`)
        .join(', ')}`,
    );
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
  return { project: repositoryIdentity(root), repoPath: root };
}

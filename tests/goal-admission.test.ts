import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureProjectPolicy } from '../src/supervisor/policy.js';
import { runSupervisorCli } from '../src/supervisor/cli.js';
import { activeGoals, readSupervisorState, writeSupervisorState } from '../src/supervisor/state.js';
import { requestResource } from '../src/supervisor/resources.js';

let root = '';
let priorStatePath: string | undefined;
let priorPolicyPath: string | undefined;
let priorDbPath: string | undefined;
let priorResourcePath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-goal-admission-'));
  priorStatePath = process.env.MAJOR_STATE_PATH;
  priorPolicyPath = process.env.MAJOR_POLICY_PATH;
  priorDbPath = process.env.MAJOR_DB_PATH;
  priorResourcePath = process.env.MAJOR_RESOURCE_PATH;
  process.env.MAJOR_STATE_PATH = join(root, 'state.json');
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
  process.env.MAJOR_RESOURCE_PATH = join(root, 'resources.json');
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorStatePath === undefined) delete process.env.MAJOR_STATE_PATH;
  else process.env.MAJOR_STATE_PATH = priorStatePath;
  if (priorPolicyPath === undefined) delete process.env.MAJOR_POLICY_PATH;
  else process.env.MAJOR_POLICY_PATH = priorPolicyPath;
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  if (priorResourcePath === undefined) delete process.env.MAJOR_RESOURCE_PATH;
  else process.env.MAJOR_RESOURCE_PATH = priorResourcePath;
  rmSync(root, { recursive: true, force: true });
});

function repo(name = 'jss-tool'): string {
  const repoPath = join(root, name);
  mkdirSync(join(repoPath, '.git'), { recursive: true });
  writeFileSync(
    join(repoPath, '.git', 'config'),
    `[remote "origin"]\n\turl = https://github.com/chukadele/${name}.git\n`,
  );
  return repoPath;
}

function lastLog(logs: string[]): unknown {
  return JSON.parse(logs.at(-1)!);
}

describe('major goal admit', () => {
  it('refuses admission for a project that is not owner-approved build', async () => {
    const repoPath = repo();
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'thread-a',
    ]);
    expect(lastLog(logs)).toMatchObject({ admitted: false });
    expect(activeGoals('jss-tool', repoPath)).toHaveLength(0);
  });

  it('creates a goal, auto-grants foreground authority, and claims live work on first admission', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the ranking/shortlist workflow correctly',
      '--session-id',
      'thread-a',
    ]);
    const result = lastLog(logs) as {
      admitted: boolean;
      created: boolean;
      outcome: string;
      authority: { status: string };
      ownLiveWork: boolean;
    };
    expect(result).toMatchObject({
      admitted: true,
      created: true,
      outcome: 'Ship the ranking/shortlist workflow correctly',
      authority: { status: 'active' },
      ownLiveWork: true,
    });
    expect(activeGoals('jss-tool', repoPath)).toHaveLength(1);
  });

  it('resumes the same goal on a second admission from the same session without duplicating or overwriting the outcome', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    const admit = (outcome: string) =>
      runSupervisorCli([
        'goal',
        'admit',
        '--cwd',
        repoPath,
        '--host',
        'codex',
        '--outcome',
        outcome,
        '--session-id',
        'thread-a',
      ]);

    await admit('Ship the ranking/shortlist workflow correctly');
    await admit('edit ranking component'); // a later, narrower implementation-step phrasing
    const result = lastLog(logs) as { created: boolean; outcome: string };
    expect(result.created).toBe(false);
    expect(result.outcome).toBe('Ship the ranking/shortlist workflow correctly');
    expect(activeGoals('jss-tool', repoPath)).toHaveLength(1);
  });

  it('updates the outcome only when --refine is explicitly passed', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the ranking/shortlist workflow correctly',
      '--session-id',
      'thread-a',
    ]);
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'The user has moved on to redesigning the onboarding flow',
      '--session-id',
      'thread-a',
      '--refine',
    ]);
    const result = lastLog(logs) as { outcome: string };
    expect(result.outcome).toBe('The user has moved on to redesigning the onboarding flow');
    expect(activeGoals('jss-tool', repoPath)).toHaveLength(1);
  });

  it('reports another session already owns live work instead of silently starting parallel work', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'thread-a',
    ]);
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'claude',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'session-b',
    ]);
    const result = lastLog(logs) as {
      created: boolean;
      ownLiveWork: boolean;
      authority: { status: string };
      guidance: string;
    };
    expect(result.created).toBe(false);
    expect(result.ownLiveWork).toBe(false);
    // Workshop authority is project-scoped and already active; a second
    // attached session does not need to re-request it to see it is live.
    expect(result.authority.status).toBe('active');
    expect(result.guidance).toContain('codex');
    expect(activeGoals('jss-tool', repoPath)).toHaveLength(1);
  });

  it('automatically rebinds a goal from a deleted worktree after its cycle is conclusively dead', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    const admit = () =>
      runSupervisorCli([
        'goal',
        'admit',
        '--cwd',
        repoPath,
        '--host',
        'codex',
        '--outcome',
        'Ship the MVP',
        '--session-id',
        'thread-a',
      ]);

    await admit();
    const state = readSupervisorState();
    const goal = state.goals[0]!;
    const removedWorktree = join(root, 'removed-worktree');
    goal.repoPath = removedWorktree;
    goal.status = 'running';
    goal.activePid = 999_999;
    writeSupervisorState(state);

    await admit();
    const result = lastLog(logs) as {
      ownLiveWork: boolean;
      ownershipReconciled?: { previousRepoPath: string; repoPath: string };
    };
    expect(result.ownLiveWork).toBe(true);
    expect(result.ownershipReconciled).toMatchObject({
      previousRepoPath: removedWorktree,
      repoPath,
    });
    const persisted = readSupervisorState().goals[0]!;
    expect(persisted).toMatchObject({
      repoPath,
      status: 'active',
      lastOwnershipReconciliation: { previousRepoPath: removedWorktree, repoPath },
    });
    expect(persisted.activePid).toBeUndefined();
  });

  it('does not rebind a deleted worktree while a real worker lease is live', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    const args = [
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'thread-a',
    ];
    await runSupervisorCli(args);
    const state = readSupervisorState();
    const removedWorktree = join(root, 'removed-worktree');
    state.goals[0]!.repoPath = removedWorktree;
    state.goals[0]!.activePid = undefined;
    writeSupervisorState(state);
    requestResource({
      kind: 'worker',
      owner: 'live-worker',
      project: 'github.com/chukadele/jss-tool',
      pid: process.pid,
    });

    await runSupervisorCli(args);
    const result = lastLog(logs) as { ownershipReconciled?: unknown };
    expect(result.ownershipReconciled).toBeUndefined();
    expect(readSupervisorState().goals[0]!.repoPath).toBe(removedWorktree);
  });

  it('does not fall back to a stale (24h+) attached session id', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const state = readSupervisorState();
    state.sessions.push({
      id: 'old-attachment',
      host: 'codex',
      cwd: repoPath,
      project: 'jss-tool',
      repoPath,
      sessionId: 'ancient-thread',
      attachedAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString(),
    });
    writeSupervisorState(state);

    await expect(
      runSupervisorCli([
        'goal',
        'admit',
        '--cwd',
        repoPath,
        '--host',
        'codex',
        '--outcome',
        'Ship the MVP',
      ]),
    ).rejects.toThrow(/requires --session-id/);
  });

  it('does fall back to a recently attached session id', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const state = readSupervisorState();
    state.sessions.push({
      id: 'recent-attachment',
      host: 'codex',
      cwd: repoPath,
      project: 'jss-tool',
      repoPath,
      sessionId: 'todays-thread',
      attachedAt: new Date(Date.now() - 5 * 60 * 1000).toISOString(),
    });
    writeSupervisorState(state);
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));

    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
    ]);
    const result = lastLog(logs) as { liveWorker: { sessionId: string } };
    expect(result.liveWorker.sessionId).toBe('todays-thread');
  });

  it('treats a malformed or clock-skewed-future attachedAt as not fresh (fails closed)', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const state = readSupervisorState();
    state.sessions.push(
      {
        id: 'malformed-attachment',
        host: 'codex',
        cwd: repoPath,
        project: 'jss-tool',
        repoPath,
        sessionId: 'malformed-thread',
        attachedAt: 'not-a-timestamp',
      },
      {
        id: 'future-attachment',
        host: 'codex',
        cwd: repoPath,
        project: 'jss-tool',
        repoPath,
        sessionId: 'future-thread',
        attachedAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      },
    );
    writeSupervisorState(state);

    await expect(
      runSupervisorCli([
        'goal',
        'admit',
        '--cwd',
        repoPath,
        '--host',
        'codex',
        '--outcome',
        'Ship the MVP',
      ]),
    ).rejects.toThrow(/requires --session-id/);
  });
});

describe('major goal heartbeat', () => {
  it('succeeds only for the session holding the live-worker claim', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'thread-a',
    ]);
    const goalId = (lastLog(logs) as { goalId: string }).goalId;
    await runSupervisorCli([
      'goal',
      'heartbeat',
      '--id',
      goalId,
      '--host',
      'codex',
      '--session-id',
      'thread-a',
    ]);
    expect(lastLog(logs)).toEqual({ heartbeat: true });
    await runSupervisorCli([
      'goal',
      'heartbeat',
      '--id',
      goalId,
      '--host',
      'claude',
      '--session-id',
      'session-b',
    ]);
    expect(lastLog(logs)).toEqual({ heartbeat: false });
  });
});

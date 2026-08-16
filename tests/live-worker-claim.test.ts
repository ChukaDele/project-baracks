import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  claimLiveWorker,
  getGoal,
  heartbeatLiveWorker,
  startGoal,
} from '../src/supervisor/state.js';

let root = '';
let priorStatePath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-live-worker-'));
  priorStatePath = process.env.MAJOR_STATE_PATH;
  process.env.MAJOR_STATE_PATH = join(root, 'state.json');
});

afterEach(() => {
  if (priorStatePath === undefined) delete process.env.MAJOR_STATE_PATH;
  else process.env.MAJOR_STATE_PATH = priorStatePath;
  rmSync(root, { recursive: true, force: true });
});

function fakeRepo(name = 'jss-tool'): string {
  const repo = join(root, name);
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(
    join(repo, '.git', 'config'),
    `[remote "origin"]\n\turl = https://github.com/chukadele/${name}.git\n`,
  );
  return repo;
}

function newGoal(repoPath: string) {
  return startGoal({ project: 'jss-tool', repoPath, goal: 'Ship the MVP', autonomous: false });
}

describe('live-worker claim', () => {
  it('grants the claim to the first session and refreshes it on repeat calls from the same session', () => {
    const goal = newGoal(fakeRepo());
    const first = claimLiveWorker(goal.id, { host: 'codex', sessionId: 'thread-a' });
    expect(first.owned).toBe(true);
    expect(first.claim).toMatchObject({ host: 'codex', sessionId: 'thread-a' });

    const refreshed = claimLiveWorker(goal.id, { host: 'codex', sessionId: 'thread-a' });
    expect(refreshed.owned).toBe(true);
    expect(refreshed.claim.claimedAt).toBe(first.claim.claimedAt);
  });

  it('refuses to steal a fresh claim held by a different session, reporting who holds it', () => {
    const goal = newGoal(fakeRepo());
    claimLiveWorker(goal.id, { host: 'codex', sessionId: 'thread-a' });
    const attempt = claimLiveWorker(goal.id, { host: 'claude', sessionId: 'session-b' });
    expect(attempt.owned).toBe(false);
    expect(attempt.claim).toMatchObject({ host: 'codex', sessionId: 'thread-a' });
    expect(getGoal(goal.id)!.liveWorker).toMatchObject({ host: 'codex', sessionId: 'thread-a' });
  });

  it('lets a different session reclaim an abandoned (stale) claim', () => {
    const goal = newGoal(fakeRepo());
    const claimedAt = new Date('2026-01-01T00:00:00.000Z');
    claimLiveWorker(goal.id, { host: 'codex', sessionId: 'thread-a' }, () => claimedAt);
    const muchLater = () => new Date(claimedAt.getTime() + 46 * 60 * 1000);
    const attempt = claimLiveWorker(goal.id, { host: 'claude', sessionId: 'session-b' }, muchLater);
    expect(attempt.owned).toBe(true);
    expect(attempt.claim).toMatchObject({ host: 'claude', sessionId: 'session-b' });
  });

  it('heartbeat succeeds only for the session that actually holds the claim', () => {
    const goal = newGoal(fakeRepo());
    claimLiveWorker(goal.id, { host: 'codex', sessionId: 'thread-a' });
    expect(heartbeatLiveWorker(goal.id, { host: 'codex', sessionId: 'thread-a' })).toBe(true);
    expect(heartbeatLiveWorker(goal.id, { host: 'claude', sessionId: 'session-b' })).toBe(false);
  });

  it('heartbeat on a never-claimed goal is a no-op, not a throw', () => {
    const goal = newGoal(fakeRepo());
    expect(heartbeatLiveWorker(goal.id, { host: 'codex', sessionId: 'thread-a' })).toBe(false);
  });
});

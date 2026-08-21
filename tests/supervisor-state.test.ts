import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  activeGoals,
  attachSession,
  getGoal,
  readSupervisorState,
  resolveProject,
  resolveProjectForCwd,
  startGoal,
  updateGoal,
} from '../src/supervisor/state.js';

let root = '';
let priorStatePath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-supervisor-'));
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

describe('Major supervisor state', () => {
  it('persists one durable autonomous goal and updates it without duplication', () => {
    const repoPath = fakeRepo();
    const first = startGoal({
      project: 'jss-tool',
      repoPath,
      goal: 'Ship the JSS MVP',
      autonomous: true,
    });
    const updated = startGoal({
      project: 'jss-tool',
      repoPath,
      goal: 'Ship the smallest credible end-to-end JSS MVP',
      autonomous: true,
    });

    expect(updated.id).toBe(first.id);
    expect(activeGoals('jss-tool')).toHaveLength(1);
    expect(getGoal(first.id)?.goal).toContain('end-to-end');
    expect(readSupervisorState().goals).toHaveLength(1);

    updateGoal(first.id, { status: 'blocked', ownerGate: 'MFA required' });
    const blocked = getGoal(first.id);
    expect(blocked?.status).toBe('blocked');
    expect(blocked?.ownerGate).toBe('MFA required');

    const raw = JSON.parse(readFileSync(process.env.MAJOR_STATE_PATH!, 'utf8')) as {
      version: number;
    };
    expect(raw.version).toBe(1);
  });

  it('migrates a live legacy goal by git identity instead of duplicating it', () => {
    const repoPath = fakeRepo('legacy-goal');
    const first = startGoal({
      project: 'legacy-goal',
      repoPath,
      goal: 'Legacy objective',
      autonomous: false,
    });
    const migrated = startGoal({
      project: 'github.com/chukadele/legacy-goal',
      repoPath,
      goal: 'Canonical objective',
      autonomous: false,
    });
    expect(migrated.id).toBe(first.id);
    expect(migrated.project).toBe('github.com/chukadele/legacy-goal');
    expect(readSupervisorState().goals).toHaveLength(1);
  });

  it('attaches sessions to the git project and preserves the host', () => {
    const repoPath = fakeRepo('surface-talent');
    const project = resolveProjectForCwd(repoPath);
    expect(project).toEqual({ project: 'github.com/chukadele/surface-talent', repoPath });

    const attachment = attachSession({
      host: 'claude',
      cwd: repoPath,
      project: project!.project,
      repoPath: project!.repoPath,
      sessionId: 'session-123',
    });
    expect(attachment.host).toBe('claude');
    expect(readSupervisorState().sessions.at(-1)?.sessionId).toBe('session-123');
  });

  it('records a native DSH interaction origin without inventing an external host', () => {
    const repoPath = fakeRepo('major-app');
    const project = resolveProjectForCwd(repoPath);
    const attachment = attachSession({
      host: 'unknown',
      interactionOrigin: 'major-app/dsh',
      cwd: repoPath,
      project: project!.project,
      repoPath: project!.repoPath,
      sessionId: 'dsh-session-123',
    });
    expect(attachment.host).toBe('unknown');
    expect(attachment.interactionOrigin).toBe('major-app/dsh');
    expect(readSupervisorState().sessions.at(-1)).toMatchObject({
      host: 'unknown',
      interactionOrigin: 'major-app/dsh',
    });
  });

  it('resolves current project by remote repository name', () => {
    const repoPath = fakeRepo('jss-tool');
    expect(resolveProject('jss-tool', repoPath)).toEqual({
      project: 'github.com/chukadele/jss-tool',
      repoPath,
    });
    expect(resolveProject('current', repoPath)).toEqual({
      project: 'github.com/chukadele/jss-tool',
      repoPath,
    });
  });

  it('keeps unrelated same-basename remotes distinct', () => {
    const first = fakeRepo('shared-name');
    const second = join(root, 'fork', 'shared-name');
    mkdirSync(join(second, '.git'), { recursive: true });
    writeFileSync(
      join(second, '.git', 'config'),
      '[remote "origin"]\n\turl = git@github.com:OtherOwner/shared-name.git\n',
    );
    expect(resolveProjectForCwd(first)?.project).toBe('github.com/chukadele/shared-name');
    expect(resolveProjectForCwd(second)?.project).toBe('github.com/otherowner/shared-name');
  });

  it('rejects an ambiguous short project name outside either repository', () => {
    const first = fakeRepo('shared');
    const second = join(root, 'fork', 'shared');
    mkdirSync(join(second, '.git'), { recursive: true });
    writeFileSync(
      join(second, '.git', 'config'),
      '[remote "origin"]\n\turl = git@github.com:OtherOwner/shared.git\n',
    );
    startGoal({ project: 'shared', repoPath: first, goal: 'First', autonomous: false });
    startGoal({ project: 'other-shared', repoPath: second, goal: 'Second', autonomous: false });
    expect(() => resolveProject('shared', root)).toThrow(/multiple active worktrees/);
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkProjectContext } from '../src/context/project-integrity.js';
import {
  attachSession,
  resolveProject,
  resolveProjectForCwd,
  startGoal,
} from '../src/supervisor/state.js';

let root = '';
let priorStatePath: string | undefined;

function makeRepo(name: string): string {
  const repo = join(root, name);
  mkdirSync(join(repo, '.git'), { recursive: true });
  writeFileSync(
    join(repo, '.git', 'config'),
    `[remote "origin"]\n\turl = https://github.com/ChukaDele/${name}.git\n`,
  );
  return repo;
}

function makeWorktree(name: string): string {
  const base = makeRepo(name);
  const gitDir = join(base, '.git', 'worktrees', 'feature');
  mkdirSync(gitDir, { recursive: true });
  writeFileSync(join(gitDir, 'commondir'), '../..\n');

  const worktree = join(root, `${name}-feature-worktree`);
  mkdirSync(worktree, { recursive: true });
  writeFileSync(join(worktree, '.git'), `gitdir: ${gitDir}\n`);
  return worktree;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-project-context-'));
  priorStatePath = process.env.MAJOR_STATE_PATH;
  process.env.MAJOR_STATE_PATH = join(root, 'supervisor-state.json');
});

afterEach(() => {
  if (priorStatePath === undefined) delete process.env.MAJOR_STATE_PATH;
  else process.env.MAJOR_STATE_PATH = priorStatePath;
  rmSync(root, { recursive: true, force: true });
});

describe('project context integrity', () => {
  it('passes when the named target matches the active repository', () => {
    const repo = makeRepo('jss-tool');
    const result = checkProjectContext('jss-tool', repo);
    expect(result.status).toBe('pass');
    expect(result.targetProject).toBe('jss-tool');
    expect(result.currentProject).toBe('jss-tool');
  });

  it('reroutes before edits when the task belongs to another known repository', () => {
    const current = makeRepo('jss-tool');
    const target = makeRepo('surface-talent');
    startGoal({
      project: 'surface-talent',
      repoPath: target,
      goal: 'Ship Surface Talent',
      autonomous: false,
    });

    const result = checkProjectContext('surface-talent', current);
    expect(result.status).toBe('reroute');
    expect(result.currentProject).toBe('jss-tool');
    expect(result.targetProject).toBe('surface-talent');
    expect(result.targetRepoPath).toBe(target);
  });

  it('keeps canonical project identity inside a Git worktree', () => {
    const worktree = makeWorktree('jss-tool');
    const project = resolveProjectForCwd(worktree);
    expect(project).toEqual({ project: 'jss-tool', repoPath: worktree });
  });

  it('resolves a previously attached project even when it has no active goal', () => {
    const repo = makeRepo('archived-app');
    attachSession({
      host: 'codex',
      cwd: repo,
      project: 'archived-app',
      repoPath: repo,
    });

    expect(resolveProject('archived-app', root)).toEqual({
      project: 'archived-app',
      repoPath: repo,
    });
  });
});

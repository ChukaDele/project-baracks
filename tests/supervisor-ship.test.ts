import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getProjectByName,
  projectConfig,
  setVerificationCommands,
} from '../src/config/project-service.js';
import type { RunCommand } from '../src/supervisor/parallel-dispatch.js';
import { supervisorShipContract } from '../src/supervisor/runtime.js';
import {
  restoreCheckout,
  shipBranch,
  supervisorShipEnabled,
  validateCommittedHead,
} from '../src/supervisor/ship.js';
import { seedProject, testDb } from './helpers.js';

let root = '';
let repo = '';
let priorMajorHome: string | undefined;

function git(cwd: string, ...args: string[]): string {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** Real git; every other executable (pnpm, gh, verification) is scripted. */
function fakeRunner(
  script: Record<string, (args: readonly string[]) => { ok: boolean; output: string }>,
) {
  const calls: { executable: string; args: readonly string[]; cwd: string }[] = [];
  const run: RunCommand = async (executable, args, cwd) => {
    calls.push({ executable, args, cwd });
    const fake = script[executable];
    if (fake) return fake(args);
    const result = spawnSync(executable, [...args], { cwd, encoding: 'utf8' });
    return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
  };
  return { run, calls };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-ship-'));
  priorMajorHome = process.env.MAJOR_HOME;
  process.env.MAJOR_HOME = join(root, 'major-home');
  repo = join(root, 'repo');
  git(root, 'init', '--initial-branch=main', repo);
  git(repo, 'config', 'user.name', 'Major Test');
  git(repo, 'config', 'user.email', 'major@example.invalid');
  writeFileSync(join(repo, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'seed');
  git(repo, 'checkout', '-b', 'feature');
  writeFileSync(join(repo, 'change.txt'), 'change\n');
  git(repo, 'add', '.');
  git(repo, 'commit', '-m', 'change');
});

afterEach(() => {
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  rmSync(root, { recursive: true, force: true });
});

describe('supervisor host validation', () => {
  it('installs and verifies the committed head in a throwaway worktree, then removes it', async () => {
    const head = git(repo, 'rev-parse', 'HEAD');
    const { run, calls } = fakeRunner({
      pnpm: () => ({ ok: true, output: 'ok' }),
    });
    const result = await validateCommittedHead({
      repoPath: repo,
      sourceHead: head,
      verificationCommands: ['pnpm lint', 'pnpm test'],
      allowedExecutables: ['git', 'pnpm'],
      run,
    });
    expect(result).toMatchObject({ ok: true, sourceHead: head });
    const pnpm = calls.filter((call) => call.executable === 'pnpm');
    expect(pnpm.map((call) => call.args.join(' '))).toEqual([
      'install --frozen-lockfile',
      'lint',
      'test',
    ]);
    // Checks ran in the validation worktree, never in the owner's checkout.
    expect(pnpm.every((call) => call.cwd !== repo && call.cwd.includes('worktrees'))).toBe(true);
    expect(existsSync(pnpm[0]!.cwd)).toBe(false);
    expect(git(repo, 'worktree', 'list')).not.toContain('validate');
  });

  it('stops at the first failing check and reports its output', async () => {
    const { run } = fakeRunner({
      pnpm: (args) =>
        args[0] === 'test'
          ? { ok: false, output: 'FAIL tests/x.test.ts' }
          : { ok: true, output: '' },
    });
    const result = await validateCommittedHead({
      repoPath: repo,
      sourceHead: git(repo, 'rev-parse', 'HEAD'),
      verificationCommands: ['pnpm test', 'pnpm build'],
      allowedExecutables: ['pnpm'],
      run,
    });
    expect(result.ok).toBe(false);
    expect(result.summary).toBe('host validation failed: pnpm test');
    expect(result.checks.at(-1)).toMatchObject({
      command: 'pnpm test',
      output: 'FAIL tests/x.test.ts',
    });
    expect(result.checks.map((check) => check.command)).not.toContain('pnpm build');
    expect(
      supervisorShipContract({ hostValidation: { ...result, sourceTreeDigest: 'd' } }, [
        'pnpm test',
      ]),
    ).toContain('FAIL tests/x.test.ts');
  });

  it('refuses uncommitted changes and executables outside the project allowlist', async () => {
    const { run, calls } = fakeRunner({ pnpm: () => ({ ok: true, output: '' }) });
    const head = git(repo, 'rev-parse', 'HEAD');
    const refused = await validateCommittedHead({
      repoPath: repo,
      sourceHead: head,
      verificationCommands: ['bash -c true'],
      allowedExecutables: ['pnpm'],
      run,
    });
    expect(refused.summary).toContain('not in project allowedExecutables: bash -c true');
    writeFileSync(join(repo, 'dirty.txt'), 'dirty\n');
    const dirty = await validateCommittedHead({
      repoPath: repo,
      sourceHead: head,
      verificationCommands: ['pnpm test'],
      allowedExecutables: ['pnpm'],
      run,
    });
    expect(dirty.summary).toContain('uncommitted changes');
    expect(calls.some((call) => call.executable === 'pnpm')).toBe(false);
  });
});

describe('supervisor push and PR', () => {
  const ghCreate = () => ({
    gh: (args: readonly string[]) =>
      args[1] === 'list'
        ? { ok: true, output: '' }
        : { ok: true, output: 'https://github.com/ChukaDele/demo/pull/7' },
  });

  function withRemote(url: string) {
    git(repo, 'remote', 'add', 'origin', url);
  }

  it('pushes the feature branch and opens a PR against main on an allowed remote', async () => {
    withRemote('https://github.com/ChukaDele/demo.git');
    const { run, calls } = fakeRunner({
      ...ghCreate(),
      git: (args) =>
        args[0] === 'push'
          ? { ok: true, output: 'pushed' }
          : (() => {
              const result = spawnSync('git', [...args], { cwd: repo, encoding: 'utf8' });
              return { ok: result.status === 0, output: `${result.stdout}${result.stderr}`.trim() };
            })(),
    });
    const shipped = await shipBranch({
      repoPath: repo,
      base: 'main',
      protectedBranches: ['main'],
      title: 'major: demo',
      body: 'body',
      run,
    });
    expect(shipped).toEqual({
      ok: true,
      url: 'https://github.com/ChukaDele/demo/pull/7',
      branch: 'feature',
    });
    expect(calls.find((call) => call.args[0] === 'push')?.args).toEqual([
      'push',
      '-u',
      'origin',
      'feature',
    ]);
    const create = calls.find((call) => call.executable === 'gh' && call.args[1] === 'create');
    expect(create?.args).toEqual([
      'pr',
      'create',
      '--repo',
      'ChukaDele/demo',
      '--base',
      'main',
      '--head',
      'feature',
      '--title',
      'major: demo',
      '--body',
      'body',
    ]);
  });

  it('reuses an open PR for the branch instead of creating another', async () => {
    withRemote('git@github.com:ChukaDele/demo.git');
    const { run, calls } = fakeRunner({
      gh: () => ({ ok: true, output: 'https://github.com/ChukaDele/demo/pull/3' }),
      git: (args) =>
        args[0] === 'push'
          ? { ok: true, output: '' }
          : (() => {
              const result = spawnSync('git', [...args], { cwd: repo, encoding: 'utf8' });
              return { ok: result.status === 0, output: result.stdout.trim() };
            })(),
    });
    const shipped = await shipBranch({
      repoPath: repo,
      base: 'main',
      protectedBranches: ['main'],
      title: 't',
      body: 'b',
      run,
    });
    expect(shipped).toMatchObject({ ok: true, url: 'https://github.com/ChukaDele/demo/pull/3' });
    expect(calls.some((call) => call.args[1] === 'create')).toBe(false);
  });

  it('never pushes to another org, a protected branch, or a dirty checkout', async () => {
    withRemote('https://github.com/Surface-Talent/demo.git');
    const { run, calls } = fakeRunner(ghCreate());
    const ship = () =>
      shipBranch({
        repoPath: repo,
        base: 'main',
        protectedBranches: ['main'],
        title: 't',
        body: 'b',
        run,
      });
    expect(await ship()).toMatchObject({
      ok: false,
      reason: expect.stringContaining('not an allowed push remote'),
    });
    git(repo, 'remote', 'set-url', 'origin', 'https://github.com/ChukaDele/demo.git');
    writeFileSync(join(repo, 'dirty.txt'), 'x');
    expect(await ship()).toMatchObject({ ok: false, reason: 'checkout has uncommitted changes' });
    rmSync(join(repo, 'dirty.txt'));
    git(repo, 'checkout', 'main');
    expect(await ship()).toMatchObject({
      ok: false,
      reason: 'refusing to push protected or base branch main',
    });
    expect(calls.some((call) => call.args[0] === 'push' || call.executable === 'gh')).toBe(false);
  });
});

describe('supervisor checkout restore and gating', () => {
  it('returns a clean checkout to its origin branch and leaves a dirty one alone', async () => {
    const { run } = fakeRunner({});
    writeFileSync(join(repo, 'dirty.txt'), 'x');
    expect(await restoreCheckout(repo, 'main', run)).toBe(
      'checkout left on feature: uncommitted changes',
    );
    rmSync(join(repo, 'dirty.txt'));
    expect(await restoreCheckout(repo, 'main', run)).toBe('checkout returned to main');
    expect(git(repo, 'branch', '--show-current')).toBe('main');
    expect(readdirSync(repo)).not.toContain('change.txt');
  });

  it('needs configured verification commands plus owner build approval or external writes', () => {
    const approved = { ownerApprovedBuild: true, allowExternalWrites: false };
    expect(supervisorShipEnabled(approved, ['pnpm test'])).toBe(true);
    expect(supervisorShipEnabled(approved, [])).toBe(false);
    expect(
      supervisorShipEnabled({ ownerApprovedBuild: false, allowExternalWrites: false }, [
        'pnpm test',
      ]),
    ).toBe(false);
    expect(
      supervisorShipEnabled({ ownerApprovedBuild: false, allowExternalWrites: true }, [
        'pnpm test',
      ]),
    ).toBe(true);
  });

  it('stores owner verification commands on the project config', () => {
    const db = testDb();
    seedProject(db, 'demo');
    setVerificationCommands(db, 'demo', ['pnpm lint', 'pnpm test']);
    expect(projectConfig(getProjectByName(db, 'demo')).verificationCommands).toEqual([
      'pnpm lint',
      'pnpm test',
    ]);
    expect(() => setVerificationCommands(db, 'missing', [])).toThrow('project not found');
  });
});

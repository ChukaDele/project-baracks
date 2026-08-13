import { chmodSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const broker = join(process.cwd(), 'scripts', 'manage-major-provider-state.py');
const authPaths = {
  claude: '.claude/.credentials.json',
  codex: '.codex/auth.json',
  cursor: '.config/cursor/auth.json',
  antigravity: '.gemini/antigravity-cli/antigravity-oauth-token',
} as const;

function run(
  root: string,
  action: string,
  provider: keyof typeof authPaths,
  hash: string,
  home: string,
) {
  const result = spawnSync('python3', [broker, action, provider, hash, home], {
    encoding: 'utf8',
    env: {
      PATH: '/usr/bin:/bin',
      MAJOR_PROVIDER_STATE_TESTING: '1',
      MAJOR_PROVIDER_STATE_TEST_ROOT: root,
    },
  });
  if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

describe('project-scoped provider state broker', () => {
  it('persists the first supported in-guest login without a pre-existing auth directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-state-first-login-'));
    const home = join(root, 'runs', 'first-login', 'home');
    const credential = join(home, authPaths.claude);
    mkdirSync(join(credential, '..'), { recursive: true, mode: 0o700 });
    writeFileSync(credential, 'first-login-proof', { mode: 0o600 });

    run(root, 'finalize', 'claude', 'f'.repeat(64), home);

    const persisted = join(root, 'provider-auth', 'claude', authPaths.claude);
    expect(readFileSync(persisted, 'utf8')).toBe('first-login-proof');
    expect(statSync(persisted).mode & 0o777).toBe(0o440);
  });

  it.each(Object.entries(authPaths) as [keyof typeof authPaths, string][])(
    '%s preserves only auth across isolated projects and reset',
    (provider, authRelative) => {
      const root = mkdtempSync(join(tmpdir(), `major-state-${provider}-`));
      const auth = join(root, 'provider-auth', provider, authRelative);
      mkdirSync(join(auth, '..'), { recursive: true, mode: 0o700 });
      writeFileSync(auth, 'opaque-auth-proof', { mode: 0o440 });
      chmodSync(auth, 0o440);
      const projectA = 'a'.repeat(64);
      const projectB = 'b'.repeat(64);

      const runA1 = join(root, 'runs', 'a1', 'home');
      run(root, 'prepare', provider, projectA, runA1);
      expect(readFileSync(join(runA1, authRelative), 'utf8')).toBe('opaque-auth-proof');
      expect(statSync(join(runA1, authRelative)).mode & 0o777).toBe(0o600);
      writeFileSync(join(runA1, authRelative), 'refreshed-auth-proof');
      writeFileSync(join(runA1, 'project-a-only.txt'), 'private-a');
      run(root, 'finalize', provider, projectA, runA1);

      const runB = join(root, 'runs', 'b', 'home');
      run(root, 'prepare', provider, projectB, runB);
      expect(() => readFileSync(join(runB, 'project-a-only.txt'))).toThrow();
      expect(readFileSync(join(runB, authRelative), 'utf8')).toBe('refreshed-auth-proof');
      run(root, 'finalize', provider, projectB, runB);

      const runA2 = join(root, 'runs', 'a2', 'home');
      run(root, 'prepare', provider, projectA, runA2);
      expect(readFileSync(join(runA2, 'project-a-only.txt'), 'utf8')).toBe('private-a');
      expect(() =>
        readFileSync(join(root, 'projects', projectA, provider, 'home', authRelative)),
      ).toThrow();
      run(root, 'reset', provider, projectA, runA2);

      const runA3 = join(root, 'runs', 'a3', 'home');
      run(root, 'prepare', provider, projectA, runA3);
      expect(() => readFileSync(join(runA3, 'project-a-only.txt'))).toThrow();
      expect(readFileSync(join(runA3, authRelative), 'utf8')).toBe('refreshed-auth-proof');
    },
  );

  it('rejects a symlink instead of persisting it into project state', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-state-link-'));
    const auth = join(root, 'provider-auth', 'codex', authPaths.codex);
    mkdirSync(join(auth, '..'), { recursive: true });
    writeFileSync(auth, 'opaque');
    const home = join(root, 'runs', 'link', 'home');
    run(root, 'prepare', 'codex', 'c'.repeat(64), home);
    const result = spawnSync('ln', ['-s', '/etc/passwd', join(home, 'leak')]);
    expect(result.status).toBe(0);
    expect(() => run(root, 'finalize', 'codex', 'c'.repeat(64), home)).toThrow(
      /unsafe provider state entry/,
    );
  });

  it('drops only Antigravity’s exact transient log symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-state-antigravity-log-'));
    const auth = join(root, 'provider-auth', 'antigravity', authPaths.antigravity);
    mkdirSync(join(auth, '..'), { recursive: true });
    writeFileSync(auth, 'opaque');
    const home = join(root, 'runs', 'antigravity-log', 'home');
    run(root, 'prepare', 'antigravity', 'd'.repeat(64), home);
    const logDir = join(home, '.gemini', 'antigravity-cli');
    mkdirSync(join(logDir, 'log'), { recursive: true });
    writeFileSync(join(logDir, 'log', 'current.log'), 'not persisted');
    expect(spawnSync('ln', ['-s', 'log/current.log', join(logDir, 'cli.log')]).status).toBe(0);
    run(root, 'finalize', 'antigravity', 'd'.repeat(64), home);
    expect(() =>
      readFileSync(
        join(
          root,
          'projects',
          'd'.repeat(64),
          'antigravity',
          'home',
          '.gemini',
          'antigravity-cli',
          'cli.log',
        ),
      ),
    ).toThrow();
  });

  it('drops only Cursor’s per-user transient latest-log symlink', () => {
    const root = mkdtempSync(join(tmpdir(), 'major-state-cursor-log-'));
    const auth = join(root, 'provider-auth', 'cursor', authPaths.cursor);
    mkdirSync(join(auth, '..'), { recursive: true });
    writeFileSync(auth, 'opaque');
    const home = join(root, 'runs', 'cursor-log', 'home');
    run(root, 'prepare', 'cursor', 'e'.repeat(64), home);
    const logDir = join(home, 'tmp', 'cursor-agent-logs-1002');
    mkdirSync(logDir, { recursive: true });
    writeFileSync(join(logDir, 'session.log'), 'persisted project state');
    expect(spawnSync('ln', ['-s', 'session.log', join(logDir, 'latest.log')]).status).toBe(0);
    run(root, 'finalize', 'cursor', 'e'.repeat(64), home);
    const archive = join(
      root,
      'projects',
      'e'.repeat(64),
      'cursor',
      'home',
      'tmp',
      'cursor-agent-logs-1002',
    );
    expect(readFileSync(join(archive, 'session.log'), 'utf8')).toBe('persisted project state');
    expect(() => readFileSync(join(archive, 'latest.log'))).toThrow();
  });
});

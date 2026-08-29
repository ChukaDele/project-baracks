import {
  chmodSync,
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function cleanSource(prefix: string): string {
  const source = mkdtempSync(join(tmpdir(), prefix));
  roots.push(source);
  for (const directory of ['guidance', 'package', 'skills', 'evals', 'templates', 'adapters']) {
    cpSync(join(process.cwd(), directory), join(source, directory), { recursive: true });
  }
  for (const args of [
    ['init', '-q'],
    ['add', '.'],
    [
      '-c',
      'user.name=Major Tests',
      '-c',
      'user.email=major@example.invalid',
      'commit',
      '-qm',
      'fixture',
    ],
  ]) {
    const result = spawnSync('git', args, {
      cwd: source,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  }
  return source;
}

function fixtureExecutable(home: string): string {
  const runtime = mkdtempSync(join(tmpdir(), 'major-shell-runtime-fixture-'));
  roots.push(runtime);
  cpSync(join(process.cwd(), 'dist'), join(runtime, 'dist'), { recursive: true });
  for (const directory of ['guidance', 'skills', 'evals', 'adapters', 'templates']) {
    cpSync(join(process.cwd(), directory), join(runtime, directory), { recursive: true });
  }
  symlinkSync(join(process.cwd(), 'node_modules'), join(runtime, 'node_modules'), 'dir');
  writeFileSync(
    join(runtime, 'package.json'),
    JSON.stringify({ type: 'module', imports: { '#trust-roots': './trust-roots.mjs' } }),
  );
  writeFileSync(
    join(runtime, 'trust-roots.mjs'),
    `import { dirname, join, resolve } from 'node:path';
export const trustedMajorHome = (env = process.env) => resolve(env.MAJOR_HOME ?? ${JSON.stringify(join(home, '.major'))});
export const trustedAccountHome = (env = process.env) => env.MAJOR_HOME ? dirname(trustedMajorHome(env)) : resolve(env.HOME ?? ${JSON.stringify(home)});
export const trustedCodexHome = (env = process.env) => resolve(env.CODEX_HOME ?? join(trustedAccountHome(env), '.codex'));
export const testFixturePath = (name) => process.env[name];
`,
  );
  const executable = join(runtime, 'major');
  writeFileSync(
    executable,
    `#!/bin/sh\nexec "${process.execPath}" "${join(runtime, 'dist', 'entry.js')}" "$@"\n`,
  );
  chmodSync(executable, 0o755);
  return executable;
}

describe('shipped Major skill sync compatibility path', () => {
  it('delegates an idempotent complete-bundle activation to the canonical transaction', () => {
    const homeRoot = mkdtempSync(join(tmpdir(), 'major-shell-sync-home-'));
    const source = cleanSource('major-shell-sync-source-');
    roots.push(homeRoot);
    const majorHome = join(homeRoot, '.major');
    const env = {
      ...process.env,
      MAJOR_HOME: majorHome,
      NODE_ENV: 'test',
      MAJOR_SYNC_EXECUTABLE: fixtureExecutable(homeRoot),
      GIT_CONFIG_GLOBAL: '/dev/null',
    };
    const run = () =>
      spawnSync('bash', ['scripts/sync-major-skills.sh', source], {
        cwd: process.cwd(),
        env,
        encoding: 'utf8',
      });

    const first = run();
    expect(first.status, first.stderr).toBe(0);
    const firstId = readlinkSync(join(majorHome, 'skill-bundles', 'current'));
    expect(firstId).toMatch(/^[0-9a-f]{64}$/);
    const bundle = join(majorHome, 'skill-bundles', firstId);
    expect(existsSync(join(bundle, 'adapters', 'skills', 'CODEX.md'))).toBe(true);
    expect(existsSync(join(bundle, 'templates', 'project', 'GOAL_STATE.md'))).toBe(true);
    expect(existsSync(join(bundle, 'guidance', 'reusable-assets.registry.json'))).toBe(true);
    expect(readFileSync(join(majorHome, 'skills.catalog.json'), 'utf8')).toBe(
      readFileSync(join(bundle, 'guidance', 'skills.catalog.json'), 'utf8'),
    );

    const second = run();
    expect(second.status, second.stderr).toBe(0);
    expect(readlinkSync(join(majorHome, 'skill-bundles', 'current'))).toBe(firstId);
    expect(second.stdout).toContain(`bundle: ${firstId}`);
  }, 30_000);
});

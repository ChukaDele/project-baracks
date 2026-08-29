import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';

const roots: string[] = [];
const priorHome = process.env.MAJOR_HOME;
const priorRegistry = process.env.MAJOR_SKILLS_REGISTRY;

afterEach(() => {
  vi.restoreAllMocks();
  if (priorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorHome;
  if (priorRegistry === undefined) delete process.env.MAJOR_SKILLS_REGISTRY;
  else process.env.MAJOR_SKILLS_REGISTRY = priorRegistry;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('installed host skill commands', () => {
  it('stages discovery and namespaced per-skill commands for every supported host', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-command-home-'));
    const stage = mkdtempSync(join(tmpdir(), 'major-command-stage-'));
    roots.push(home, stage);
    const result = spawnSync(
      'python3',
      ['scripts/stage-major-user-state.py', '--root', resolve('.'), '--stage', stage],
      { env: { ...process.env, HOME: home, CODEX_HOME: join(home, '.codex') }, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const manifest = JSON.parse(readFileSync(join(stage, 'manifest.json'), 'utf8')) as {
      entries: Array<{ target: string; source?: string }>;
    };
    const targets = manifest.entries.map((entry) => entry.target);
    for (const target of [
      join(home, '.claude/commands/major.md'),
      join(home, '.codex/prompts/major.md'),
      join(home, '.cursor/commands/major.md'),
      join(home, '.gemini/commands/major.toml'),
      join(home, '.claude/commands/major/root-cause-qa.md'),
      join(home, '.codex/prompts/major/root-cause-qa.md'),
      join(home, '.cursor/commands/major/root-cause-qa.md'),
      join(home, '.gemini/commands/major/root-cause-qa.toml'),
    ])
      expect(targets, target).toContain(target);
  });

  it('interprets every native artifact and executes its payload through the built installation', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-command-cli-home-'));
    const stage = mkdtempSync(join(tmpdir(), 'major-command-cli-stage-'));
    roots.push(home, stage);
    process.env.MAJOR_HOME = join(home, '.major');
    process.env.MAJOR_SKILLS_REGISTRY = resolve('guidance/skills.registry.json');
    const installEnv = {
      ...process.env,
      HOME: home,
      CODEX_HOME: join(home, '.codex'),
      NODE_ENV: 'test',
    };
    const staged = spawnSync(
      'python3',
      ['scripts/stage-major-user-state.py', '--root', resolve('.'), '--stage', stage],
      { env: installEnv, encoding: 'utf8' },
    );
    expect(staged.status, staged.stderr).toBe(0);
    const activated = spawnSync(
      'python3',
      ['scripts/activate-major-user-state.py', '--manifest', join(stage, 'manifest.json')],
      { env: installEnv, encoding: 'utf8' },
    );
    expect(activated.status, activated.stderr).toBe(0);

    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const major = join(bin, 'major');
    writeFileSync(
      major,
      `#!/bin/sh\nexec "${process.execPath}" "${resolve('dist/entry.js')}" "$@"\n`,
    );
    chmodSync(major, 0o755);
    const commandEnv = { ...installEnv, PATH: `${bin}:${process.env.PATH ?? ''}` };
    const artifacts = [
      join(home, '.claude', 'commands', 'major', 'root-cause-qa.md'),
      join(home, '.codex', 'prompts', 'major', 'root-cause-qa.md'),
      join(home, '.cursor', 'commands', 'major', 'root-cause-qa.md'),
      join(home, '.gemini', 'commands', 'major', 'root-cause-qa.toml'),
    ];
    const commands = artifacts.map((path) => {
      const artifact = readFileSync(path, 'utf8');
      const payload = artifact.match(/Run `([^`]+)`/)?.[1];
      expect(payload, path).toBeDefined();
      return payload!
        .replace('"$ARGUMENTS"', "'Investigate and verify this regression'")
        .replace('{{args}}', "'Investigate and verify this regression'");
    });
    for (const installedCommand of commands) {
      expect(installedCommand).toContain('skill resolve');
      expect(installedCommand).toContain('--skill root-cause-qa');
      const resolveResult = spawnSync('sh', ['-c', installedCommand], {
        env: commandEnv,
        encoding: 'utf8',
      });
      expect(resolveResult.status, resolveResult.stderr).toBe(0);
      const receipt = JSON.parse(resolveResult.stdout) as { receipt: { selected: string[] } };
      expect(receipt.receipt.selected).toContain('root-cause-qa');
    }

    const discoveryArtifacts = [
      join(home, '.claude', 'commands', 'major.md'),
      join(home, '.codex', 'prompts', 'major.md'),
      join(home, '.cursor', 'commands', 'major.md'),
      join(home, '.gemini', 'commands', 'major.toml'),
    ];
    for (const path of discoveryArtifacts) {
      const artifact = readFileSync(path, 'utf8');
      const payload = artifact.match(/`(major skill search[^`]+)`/)?.[1];
      expect(payload, path).toBeDefined();
      const command = payload!
        .replace('"$ARGUMENTS"', "'root cause regression'")
        .replace('{{args}}', "'root cause regression'");
      const searchResult = spawnSync('sh', ['-c', command], {
        env: commandEnv,
        encoding: 'utf8',
      });
      expect(searchResult.status, searchResult.stderr).toBe(0);
      expect(searchResult.stdout).toContain('root-cause-qa');
    }

    const failed = spawnSync('sh', ['-c', `${commands[0]} --skill missing-skill`], {
      env: commandEnv,
      encoding: 'utf8',
    });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('unknown skill "missing-skill"');
  }, 15_000);

  it('installs the core project profile transactionally while preserving project-owned skills', () => {
    const target = mkdtempSync(join(tmpdir(), 'major-project-skill-install-'));
    roots.push(target);
    const custom = join(target, '.agents', 'skills', 'project-owned', 'SKILL.md');
    mkdirSync(dirname(custom), { recursive: true });
    writeFileSync(custom, '# project owned\n');
    const result = spawnSync('bash', ['scripts/install-major-skills.sh', target, 'core'], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(custom, 'utf8')).toBe('# project owned\n');
    expect(existsSync(join(target, '.agents', 'skills.catalog.json'))).toBe(true);
    expect(existsSync(join(target, '.codex', 'prompts', 'major', 'root-cause-qa.md'))).toBe(true);
    expect(readFileSync(join(target, 'MAJOR_SKILLS.lock'), 'utf8')).toContain('[skills]');
  });
});

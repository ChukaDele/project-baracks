import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

  it('executes installed catalogue and namespaced command behavior through the supported entrypoint', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-command-cli-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;
    process.env.MAJOR_SKILLS_REGISTRY = resolve('guidance/skills.registry.json');
    const search = spawnSync(
      process.execPath,
      ['--import', 'tsx', 'src/entry.ts', 'skill', 'search', '--query', 'root cause'],
      { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' },
    );
    expect(search.status, search.stderr).toBe(0);
    expect(search.stdout).toContain('root-cause-qa');
    const resolveResult = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'src/entry.ts',
        'skill',
        'resolve',
        '--task',
        'Investigate and verify this regression',
        '--skill',
        'root-cause-analysis',
        '--skill',
        'lean-quality',
        '--json',
      ],
      { env: { ...process.env, NODE_ENV: 'test' }, encoding: 'utf8' },
    );
    expect(resolveResult.status, resolveResult.stderr).toBe(0);
    const receipt = JSON.parse(resolveResult.stdout) as { receipt: { selected: string[] } };
    expect(receipt.receipt.selected).toEqual(['lean-quality', 'root-cause-qa']);
  });

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

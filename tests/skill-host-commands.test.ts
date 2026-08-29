import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { runSkillCli } from '../src/skills/cli.js';

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

  it('executes catalogue discovery and namespaced explicit composition at the command boundary', async () => {
    const home = mkdtempSync(join(tmpdir(), 'major-command-cli-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;
    process.env.MAJOR_SKILLS_REGISTRY = resolve('guidance/skills.registry.json');
    const output: string[] = [];
    vi.spyOn(console, 'log').mockImplementation((value) => output.push(String(value)));
    await expect(runSkillCli(['skill', 'search', '--query', 'root cause'])).resolves.toBe(true);
    expect(output.join('\n')).toContain('root-cause-qa');
    output.length = 0;
    await expect(
      runSkillCli([
        'skill',
        'resolve',
        '--task',
        'Investigate and verify this regression',
        '--skill',
        'root-cause-analysis',
        '--skill',
        'lean-quality',
        '--json',
      ]),
    ).resolves.toBe(true);
    const receipt = JSON.parse(output.join('\n')) as { receipt: { selected: string[] } };
    expect(receipt.receipt.selected).toEqual(['lean-quality', 'root-cause-qa']);
  });
});

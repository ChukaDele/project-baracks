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

type CommandAdapter = {
  discovery: string;
  explicit: string;
  discoveryDescription?: string;
  explicitDescription?: string;
};

function fixtureRepository(root: string, name: string, ids: string[]): void {
  const repository = join(root, name);
  mkdirSync(repository, { recursive: true });
  for (const id of ids) {
    const body = join(repository, 'skills', id, 'SKILL.md');
    mkdirSync(dirname(body), { recursive: true });
    writeFileSync(
      body,
      `---\ndescription: Fixture body for ${id}\n---\n\n# Exact ${id} fixture body\n`,
    );
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
      cwd: repository,
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
  }
}

function markdownAdapter(discovery: string, explicit: string): CommandAdapter {
  const parse = (artifact: string, path: string): string[] => {
    const lines = artifact.trimEnd().split('\n');
    expect(lines, path).toHaveLength(1);
    const commands = [...lines[0]!.matchAll(/`([^`\n]+)`/g)].map((match) => match[1]!);
    expect(commands.length, path).toBeGreaterThan(0);
    return commands;
  };
  return {
    discovery: parse(readFileSync(discovery, 'utf8'), discovery)[0]!,
    explicit: parse(readFileSync(explicit, 'utf8'), explicit)[0]!,
  };
}

function geminiTomlAdapter(discovery: string, explicit: string): CommandAdapter {
  const parse = (artifact: string, path: string): { description: string; command: string } => {
    const fields = new Map<string, string>();
    for (const line of artifact.trimEnd().split('\n')) {
      const match = line.match(/^([a-z]+) = ("(?:[^"\\]|\\.)*")$/);
      expect(match, `${path}: ${line}`).not.toBeNull();
      fields.set(match![1]!, JSON.parse(match![2]!) as string);
    }
    expect([...fields.keys()], path).toEqual(['description', 'prompt']);
    const prompt = fields.get('prompt')!;
    const command = prompt.match(/`([^`\n]+)`/)?.[1];
    expect(command, path).toBeDefined();
    return { description: fields.get('description')!, command: command! };
  };
  const discoveryArtifact = parse(readFileSync(discovery, 'utf8'), discovery);
  const explicitArtifact = parse(readFileSync(explicit, 'utf8'), explicit);
  return {
    discovery: discoveryArtifact.command,
    explicit: explicitArtifact.command,
    discoveryDescription: discoveryArtifact.description,
    explicitDescription: explicitArtifact.description,
  };
}

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
    const catalog = JSON.parse(readFileSync('guidance/skills.catalog.json', 'utf8')) as {
      entries: Array<{ id: string }>;
    };
    for (const [root, suffix] of [
      [join(home, '.claude/commands'), '.md'],
      [join(home, '.codex/prompts'), '.md'],
      [join(home, '.cursor/commands'), '.md'],
      [join(home, '.gemini/commands'), '.toml'],
    ] as const) {
      expect(targets).toContain(join(root, `major${suffix}`));
      expect(
        targets
          .filter((target) => dirname(target) === join(root, 'major'))
          .map((target) => target.slice(join(root, 'major').length + 1, -suffix.length))
          .sort(),
      ).toEqual(catalog.entries.map((entry) => entry.id).sort());
    }
  });

  it('validates installed host adapter formats and executes their payloads through built Major', () => {
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
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const major = join(bin, 'major');
    writeFileSync(
      major,
      `#!/bin/sh\nexec "${process.execPath}" "${resolve('dist/entry.js')}" "$@"\n`,
    );
    chmodSync(major, 0o755);

    const staged = spawnSync(
      'python3',
      [
        'scripts/stage-major-user-state.py',
        '--root',
        resolve('.'),
        '--stage',
        stage,
        '--major-bin',
        major,
      ],
      { env: installEnv, encoding: 'utf8' },
    );
    expect(staged.status, staged.stderr).toBe(0);
    const activated = spawnSync(
      'python3',
      ['scripts/activate-major-user-state.py', '--manifest', join(stage, 'manifest.json')],
      { env: installEnv, encoding: 'utf8' },
    );
    expect(activated.status, activated.stderr).toBe(0);

    const commandEnv = { ...installEnv, PATH: `${bin}:${process.env.PATH ?? ''}` };
    const adapters = [
      markdownAdapter(
        join(home, '.claude', 'commands', 'major.md'),
        join(home, '.claude', 'commands', 'major', 'root-cause-qa.md'),
      ),
      markdownAdapter(
        join(home, '.codex', 'prompts', 'major.md'),
        join(home, '.codex', 'prompts', 'major', 'root-cause-qa.md'),
      ),
      markdownAdapter(
        join(home, '.cursor', 'commands', 'major.md'),
        join(home, '.cursor', 'commands', 'major', 'root-cause-qa.md'),
      ),
      geminiTomlAdapter(
        join(home, '.gemini', 'commands', 'major.toml'),
        join(home, '.gemini', 'commands', 'major', 'root-cause-qa.toml'),
      ),
    ];
    for (const adapter of adapters) {
      expect(adapter.discovery.replace('{{args}}', '"$ARGUMENTS"')).toBe(
        'major skill search --query "$ARGUMENTS"',
      );
      expect(adapter.explicit.replace('{{args}}', '"$ARGUMENTS"')).toBe(
        'major skill resolve --task "$ARGUMENTS" --skill root-cause-qa --json',
      );
      const explicit = adapter.explicit
        .replace('"$ARGUMENTS"', "'Investigate and verify this regression'")
        .replace('{{args}}', "'Investigate and verify this regression'");
      const resolveResult = spawnSync('sh', ['-c', explicit], {
        env: commandEnv,
        encoding: 'utf8',
      });
      expect(resolveResult.status, resolveResult.stderr).toBe(0);
      const receipt = JSON.parse(resolveResult.stdout) as { receipt: { selected: string[] } };
      expect(receipt.receipt.selected).toContain('root-cause-qa');
      const discovery = adapter.discovery
        .replace('"$ARGUMENTS"', "'root cause regression'")
        .replace('{{args}}', "'root cause regression'");
      const searchResult = spawnSync('sh', ['-c', discovery], {
        env: commandEnv,
        encoding: 'utf8',
      });
      expect(searchResult.status, searchResult.stderr).toBe(0);
      expect(searchResult.stdout).toContain('root-cause-qa');

      const unknown = explicit.replace('--skill root-cause-qa', '--skill missing-skill');
      const failed = spawnSync('sh', ['-c', unknown], { env: commandEnv, encoding: 'utf8' });
      expect(failed.status).not.toBe(0);
      expect(failed.stderr).toContain('unknown skill "missing-skill"');
    }

    const plugin = JSON.parse(
      readFileSync(join(home, '.major', 'gemini-plugin', 'plugin.json'), 'utf8'),
    ) as { name: string };
    expect(plugin).toEqual({ name: 'major-global' });
    const hooks = JSON.parse(
      readFileSync(join(home, '.major', 'gemini-plugin', 'hooks.json'), 'utf8'),
    ) as {
      'major-attach': {
        PreInvocation: Array<{ type: string; command: string; timeout: number }>;
      };
    };
    expect(hooks['major-attach'].PreInvocation).toEqual([
      {
        type: 'command',
        command: `"${major}" session hook --host antigravity --envelope antigravity-pre-invocation`,
        timeout: 10,
      },
    ]);
    const pluginRegistry = JSON.parse(
      readFileSync(join(home, '.gemini', 'config', 'plugins.json'), 'utf8'),
    ) as { entries: Array<{ path: string }> };
    expect(pluginRegistry.entries).toContainEqual({
      path: join(home, '.major', 'gemini-plugin'),
    });
  }, 15_000);

  it('installs the core project profile transactionally while preserving project-owned skills', () => {
    const target = mkdtempSync(join(tmpdir(), 'major-project-skill-install-'));
    const home = mkdtempSync(join(tmpdir(), 'major-project-command-home-'));
    roots.push(target, home);
    process.env.MAJOR_HOME = join(home, '.major');
    process.env.MAJOR_SKILLS_REGISTRY = resolve('guidance/skills.registry.json');
    const bin = join(home, 'bin');
    mkdirSync(bin, { recursive: true });
    const major = join(bin, 'major');
    writeFileSync(
      major,
      `#!/bin/sh\nexec "${process.execPath}" "${resolve('dist/entry.js')}" "$@"\n`,
    );
    chmodSync(major, 0o755);
    const commandEnv = {
      ...process.env,
      HOME: home,
      NODE_ENV: 'test',
      PATH: `${bin}:${process.env.PATH ?? ''}`,
    };
    const custom = join(target, '.agents', 'skills', 'project-owned', 'SKILL.md');
    mkdirSync(dirname(custom), { recursive: true });
    writeFileSync(custom, '# project owned\n');
    const result = spawnSync('bash', ['scripts/install-major-skills.sh', target, 'core'], {
      env: commandEnv,
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(readFileSync(custom, 'utf8')).toBe('# project owned\n');
    expect(existsSync(join(target, '.agents', 'skills.catalog.json'))).toBe(true);
    expect(existsSync(join(target, '.codex', 'prompts', 'major', 'root-cause-qa.md'))).toBe(true);
    expect(readFileSync(join(target, 'MAJOR_SKILLS.lock'), 'utf8')).toContain('[skills]');

    const discoveryPath = join(target, '.gemini', 'commands', 'major.toml');
    const explicitPath = join(target, '.gemini', 'commands', 'major', 'root-cause-qa.toml');
    expect(readFileSync(discoveryPath, 'utf8')).toContain('{{args}}');
    expect(readFileSync(explicitPath, 'utf8')).toContain('{{args}}');
    const adapter = geminiTomlAdapter(discoveryPath, explicitPath);
    expect(adapter.discoveryDescription).toBe('Discover Major skills');
    expect(adapter.explicitDescription).toBe('Invoke Major skill root-cause-qa');
    expect(adapter.discovery).toBe('major skill search --query {{args}}');
    expect(adapter.explicit).toBe(
      'major skill resolve --task {{args}} --skill root-cause-qa --json',
    );

    const discovery = adapter.discovery.replace('{{args}}', "'root cause regression'");
    const searchResult = spawnSync('sh', ['-c', discovery], {
      env: commandEnv,
      encoding: 'utf8',
    });
    expect(searchResult.status, searchResult.stderr).toBe(0);
    expect(searchResult.stdout).toContain('root-cause-qa');

    const explicit = adapter.explicit.replace(
      '{{args}}',
      "'Investigate and verify this regression'",
    );
    const resolveResult = spawnSync('sh', ['-c', explicit], {
      env: commandEnv,
      encoding: 'utf8',
    });
    expect(resolveResult.status, resolveResult.stderr).toBe(0);
    const receipt = JSON.parse(resolveResult.stdout) as { receipt: { selected: string[] } };
    expect(receipt.receipt.selected).toContain('root-cause-qa');

    const unknown = explicit.replace('--skill root-cause-qa', '--skill missing-skill');
    const failed = spawnSync('sh', ['-c', unknown], { env: commandEnv, encoding: 'utf8' });
    expect(failed.status).not.toBe(0);
    expect(failed.stderr).toContain('unknown skill "missing-skill"');
  }, 15_000);

  it('materializes a source-locked full-profile registry, catalogue, commands, and resolver', () => {
    const target = mkdtempSync(join(tmpdir(), 'major-full-skill-install-'));
    const fixtures = mkdtempSync(join(tmpdir(), 'major-skill-sources-'));
    const home = mkdtempSync(join(tmpdir(), 'major-full-skill-home-'));
    roots.push(target, fixtures, home);
    fixtureRepository(fixtures, 'emil', [
      'animate',
      'animation-vocabulary',
      'apple-design',
      'emil-design-eng',
      'find-animation-opportunities',
      'improve-animations',
      'pick-ui-library',
      'prototype',
      'review-animations',
    ]);
    fixtureRepository(fixtures, 'anthropic', [
      'frontend-design',
      'webapp-testing',
      'algorithmic-art',
      'mcp-builder',
      'skill-creator',
    ]);
    fixtureRepository(fixtures, 'openai', [
      'playwright',
      'vercel-deploy',
      'figma-use',
      'figma-implement-design',
      'figma-generate-design',
      'security-threat-model',
      'pdf',
    ]);
    fixtureRepository(fixtures, 'graph', ['graph-engineering']);
    writeFileSync(join(target, 'package.json'), '{"name":"fixture-web"}\n');
    const custom = join(target, '.agents', 'skills', 'project-owned', 'SKILL.md');
    mkdirSync(dirname(custom), { recursive: true });
    writeFileSync(custom, '# preserved project body\n');
    const env = {
      ...process.env,
      HOME: home,
      MAJOR_HOME: join(home, '.major'),
      MAJOR_SKILL_FIXTURE_ROOT: fixtures,
      NODE_ENV: 'test',
      MAJOR_SKILLS_REGISTRY: resolve('guidance/skills.registry.json'),
      GIT_CONFIG_GLOBAL: '/dev/null',
    };
    const installed = spawnSync('bash', ['scripts/install-major-skills.sh', target, 'full'], {
      env,
      encoding: 'utf8',
    });
    expect(installed.status, installed.stderr).toBe(0);
    expect(readFileSync(custom, 'utf8')).toBe('# preserved project body\n');
    const registry = JSON.parse(
      readFileSync(join(target, '.agents', 'skills.registry.json'), 'utf8'),
    ) as { entries: Array<{ id: string; sourceKind?: string }> };
    const catalog = JSON.parse(
      readFileSync(join(target, '.agents', 'skills.catalog.json'), 'utf8'),
    ) as { entries: Array<{ id: string }> };
    const managed = registry.entries.map((entry) => entry.id).sort();
    expect(catalog.entries.map((entry) => entry.id).sort()).toEqual(managed);
    expect(managed).toContain('animate');
    expect(managed).not.toContain('project-owned');
    expect(readFileSync(join(target, 'MAJOR_SKILLS.lock'), 'utf8')).not.toContain(
      '\nproject-owned\n',
    );
    for (const id of managed) {
      expect(existsSync(join(target, '.claude', 'commands', 'major', `${id}.md`))).toBe(true);
      expect(existsSync(join(target, '.codex', 'prompts', 'major', `${id}.md`))).toBe(true);
      expect(existsSync(join(target, '.cursor', 'commands', 'major', `${id}.md`))).toBe(true);
      expect(existsSync(join(target, '.gemini', 'commands', 'major', `${id}.toml`))).toBe(true);
    }
    const cli = (args: string[]) =>
      spawnSync(process.execPath, [resolve('dist/entry.js'), ...args], {
        cwd: target,
        env,
        encoding: 'utf8',
      });
    const search = cli(['skill', 'search', '--query', 'animate']);
    expect(search.status, search.stderr).toBe(0);
    expect(search.stdout).toContain('animate');
    const explicit = cli([
      'skill',
      'resolve',
      '--task',
      'Animate this interface',
      '--skill',
      'animate',
      '--json',
    ]);
    expect(explicit.status, explicit.stderr).toBe(0);
    const explicitResult = JSON.parse(explicit.stdout) as { skills: Array<{ path: string }> };
    expect(readFileSync(explicitResult.skills[0]!.path, 'utf8')).toContain(
      'Exact animate fixture body',
    );
    const automatic = cli([
      'skill',
      'resolve',
      '--task',
      'Use animate for this frontend design',
      '--json',
    ]);
    expect(automatic.status, automatic.stderr).toBe(0);
    const automaticResult = JSON.parse(automatic.stdout) as { receipt: { mode: string } };
    expect(automaticResult.receipt.mode).toBe('automatic');
    const unknown = cli([
      'skill',
      'resolve',
      '--task',
      'Unknown',
      '--skill',
      'not-installed',
      '--json',
    ]);
    expect(unknown.status).not.toBe(0);
    expect(unknown.stderr).toContain('unknown skill "not-installed"');
  }, 30_000);
});

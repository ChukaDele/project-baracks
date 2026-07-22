import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests against the real CLI process: exit codes, versioned JSON
 * output, existence checks, and refusal semantics.
 */

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'src', 'cli', 'index.ts');

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

let dbPath: string;
let repoDir: string;
let configPath: string;

function majorEnv(env: NodeJS.ProcessEnv, ...args: string[]): CliResult {
  try {
    const stdout = execFileSync(process.execPath, ['--import', 'tsx', CLI, ...args], {
      cwd: ROOT,
      encoding: 'utf8',
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 60_000,
    });
    return { status: 0, stdout, stderr: '' };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

function major(...args: string[]): CliResult {
  return majorEnv({ ...process.env, MAJOR_DB_PATH: dbPath }, ...args);
}

beforeAll(() => {
  const scratch = mkdtempSync(join(tmpdir(), 'major-cli-'));
  dbPath = join(scratch, 'major.db');
  repoDir = join(scratch, 'demo-repo');
  mkdirSync(join(repoDir, '.git'), { recursive: true });
  configPath = join(scratch, 'demo.project.json');
  writeFileSync(configPath, JSON.stringify({ name: 'demo', repoPath: repoDir }));
});

describe('major CLI', () => {
  it('project add validates config existence and git-repository shape', () => {
    expect(major('project', 'add', '/nope/missing.json').status).toBe(2);

    const scratch = mkdtempSync(join(tmpdir(), 'major-nonrepo-'));
    const badConfig = join(scratch, 'bad.json');
    writeFileSync(badConfig, JSON.stringify({ name: 'bad', repoPath: scratch }));
    const result = major('project', 'add', badConfig);
    expect(result.status).toBe(2);
    expect(result.stderr).toMatch(/not a git repository/);
  });

  it('registers a valid project and lists it as versioned JSON', () => {
    expect(major('project', 'add', configPath).status).toBe(0);
    const list = major('project', 'list', '--json');
    expect(list.status).toBe(0);
    const parsed = JSON.parse(list.stdout) as {
      schemaVersion: number;
      kind: string;
      data: { name: string }[];
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.kind).toBe('project-list');
    expect(parsed.data[0]?.name).toBe('demo');
  });

  it('rejects invalid option values with a usage exit code', () => {
    const result = major(
      'task',
      'add',
      '--project',
      'demo',
      '--title',
      'x',
      '--complexity',
      'epic',
    );
    expect(result.status).toBe(2);
  });

  it('exits 3 for unknown entities', () => {
    expect(major('task', 'show', 'task_missing').status).toBe(3);
    expect(major('task', 'list', '--project', 'ghost').status).toBe(3);
  });

  it('creates and lists tasks with stable JSON envelopes', () => {
    expect(major('task', 'add', '--project', 'demo', '--title', 'first task').status).toBe(0);
    const list = major('task', 'list', '--project', 'demo', '--json');
    const parsed = JSON.parse(list.stdout) as { data: { title: string; status: string }[] };
    expect(parsed.data).toHaveLength(1);
    expect(parsed.data[0]).toMatchObject({ title: 'first task', status: 'draft' });
  });

  it('refuses live execution with the policy-refusal exit code', () => {
    const list = major('task', 'list', '--project', 'demo', '--json');
    const taskId = (JSON.parse(list.stdout) as { data: { id: string }[] }).data[0]!.id;
    const result = major('run', '--task', taskId);
    expect(result.status).toBe(4);
    expect(result.stderr).toMatch(/live execution is not enabled/);
  });

  it('folds duplicate suggestions and suppresses rejected scopes with exit 4', () => {
    const first = major('task', 'suggest', '--project', 'demo', '--title', 'Add rate limiting');
    expect(first.status).toBe(0);
    const suggestionId = first.stdout.match(/tsug_\w+/)?.[0];
    expect(suggestionId).toBeTruthy();

    const dup = major('task', 'suggest', '--project', 'demo', '--title', 'add RATE limiting');
    expect(dup.status).toBe(0);
    expect(dup.stdout).toMatch(/duplicate of pending suggestion/);

    expect(major('task', 'reject', suggestionId!, '--note', 'no').status).toBe(0);
    const suppressed = major(
      'task',
      'suggest',
      '--project',
      'demo',
      '--title',
      'Add rate limiting',
    );
    expect(suppressed.status).toBe(4);
    expect(suppressed.stderr).toMatch(/suppressed/);
  });

  it('doctor emits versioned JSON, strict exit codes, and the unavailable capabilities', () => {
    const result = major('doctor', '--json');
    expect([0, 5]).toContain(result.status);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      kind: string;
      data: { capabilities: { capability: string; available: boolean }[] };
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.kind).toBe('doctor-report');
    expect(parsed.data.capabilities.map((c) => c.capability).sort()).toEqual([
      'automated-task-completion',
      'external-roadmap-application',
      'live-agent-execution',
      'paid-provider-execution',
      'worker-owned-downstream-mutations',
    ]);
    expect(parsed.data.capabilities.every((c) => c.available === false)).toBe(true);
  }, 90_000);

  it('exposes no command that could complete tasks, claim work or apply roadmap writes', () => {
    const listCommands = (helpText: string) =>
      [...helpText.matchAll(/^ {2}([a-z]\S*)/gm)].map((m) => m[1]);

    const help = major('--help');
    expect(help.status).toBe(0);
    // the full production command surface of this build:
    expect(listCommands(help.stdout).sort()).toEqual([
      'doctor',
      'help',
      'project',
      'queue',
      'run',
      'task',
    ]);

    // `approve` is present but HARD-GATED: it refuses before any mutation (see
    // the dedicated approval test below). It is not a runnable mutation path.
    const taskHelp = major('task', '--help');
    expect(listCommands(taskHelp.stdout).sort()).toEqual([
      'add',
      'approve',
      'help',
      'list',
      'reject',
      'show',
      'suggest',
    ]);
  });

  it('hard-gates suggestion approval: refuses with exit 4 and mutates nothing', () => {
    const suggest = major('task', 'suggest', '--project', 'demo', '--title', 'Approval gate check');
    expect(suggest.status).toBe(0);
    const suggestionId = suggest.stdout.match(/tsug_\w+/)?.[0];
    expect(suggestionId).toBeTruthy();

    const beforeCount = (
      JSON.parse(major('task', 'list', '--project', 'demo', '--json').stdout) as { data: unknown[] }
    ).data.length;

    // Even with hostile env/config, approval refuses with the canonical
    // unavailable exit code (4), before any database mutation.
    const approve = majorEnv(
      {
        ...process.env,
        MAJOR_DB_PATH: dbPath,
        MAJOR_ENABLE_APPROVAL: '1',
        MAJOR_UNSAFE: '1',
      },
      'task',
      'approve',
      suggestionId!,
      '--note',
      'try to force it',
    );
    expect(approve.status).toBe(4);
    expect(approve.stderr).toMatch(/unavailable in this disabled foundation/);

    // No task was materialised…
    const afterCount = (
      JSON.parse(major('task', 'list', '--project', 'demo', '--json').stdout) as { data: unknown[] }
    ).data.length;
    expect(afterCount).toBe(beforeCount);

    // …and the suggestion is unchanged: still PENDING, so a same-scope re-suggest
    // folds into it as a duplicate (an approved/rejected one would not).
    const dup = major('task', 'suggest', '--project', 'demo', '--title', 'approval GATE check');
    expect(dup.stdout).toMatch(/duplicate of pending suggestion/);
  });

  it('doctor human and JSON output agree that overnight execution is unavailable', () => {
    const human = major('doctor');
    expect([0, 5]).toContain(human.status);
    expect(human.stdout).toMatch(/overnight execution: UNAVAILABLE/);
    expect(human.stdout).not.toMatch(/overnight execution: SAFE/);

    const json = major('doctor', '--json');
    const parsed = JSON.parse(json.stdout) as {
      data: { overnightExecution: string; liveExecutionReady: boolean };
    };
    expect(parsed.data.overnightExecution).toBe('unavailable');
    expect(parsed.data.liveExecutionReady).toBe(false);
  });

  it('discovery and dry-run create no process, even with a hostile executable override', () => {
    const hostileDir = mkdtempSync(join(tmpdir(), 'major-hostile-'));
    const sentinel = join(hostileDir, 'INVOKED');
    // A fake `claude` that, IF EVER EXECUTED, creates a sentinel file. It is
    // BOTH the environment override (MAJOR_CLAUDE_BIN) and first on PATH, so it
    // is resolvable — but discovery only stats it, never runs it.
    const fakeClaude = join(hostileDir, 'claude');
    writeFileSync(fakeClaude, `#!/bin/sh\ntouch ${JSON.stringify(sentinel)}\n`);
    chmodSync(fakeClaude, 0o755);

    const hostileEnv: NodeJS.ProcessEnv = {
      ...process.env,
      MAJOR_DB_PATH: dbPath,
      MAJOR_CLAUDE_BIN: fakeClaude,
      MAJOR_CODEX_BIN: fakeClaude,
      PATH: `${hostileDir}:${process.env.PATH ?? ''}`,
    };

    // doctor --json performs provider + tool discovery
    const doctor = majorEnv(hostileEnv, 'doctor', '--json');
    expect([0, 5]).toContain(doctor.status);
    expect(existsSync(sentinel)).toBe(false);

    // run --dry-run performs provider/model discovery + routing
    const taskId = (
      JSON.parse(major('task', 'list', '--project', 'demo', '--json').stdout) as {
        data: { id: string }[];
      }
    ).data[0]!.id;
    const dry = majorEnv(hostileEnv, 'run', '--task', taskId, '--dry-run', '--json');
    expect(dry.status).toBe(0);
    expect(existsSync(sentinel)).toBe(false);

    // The provider is reported truthfully as unverified, never available.
    const parsed = JSON.parse(doctor.stdout) as {
      data: { providers: { name: string; installed: boolean; executableUnverified?: boolean }[] };
    };
    const claude = parsed.data.providers.find((p) => p.name === 'claude-code');
    expect(claude?.installed).toBe(false);
    expect(claude?.executableUnverified).toBe(true);
  });
});

import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';

/**
 * Integration tests against the COMPILED CLI (`dist/cli/index.js`, built in
 * beforeAll): exit codes, versioned JSON output, existence checks, and refusal
 * semantics. Running the compiled artifact — not `src` via tsx — is what makes
 * "compiled-CLI coverage" an accurate claim.
 */

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'dist', 'cli', 'index.js');
const ENTRY = join(ROOT, 'dist', 'entry.js');

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
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
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

/**
 * Create a self-contained database with a registered project and one task,
 * through the compiled CLI. Returns its db path and the task id. Every step is
 * checked so a fixture failure surfaces meaningfully instead of yielding empty
 * output that a later JSON.parse would choke on. Used by the isolated
 * hostile-environment regression so it never depends on test order.
 */
function freshProjectDb(): { dbPath: string; taskId: string } {
  const scratch = mkdtempSync(join(tmpdir(), 'major-iso-'));
  const isoDb = join(scratch, 'major.db');
  const isoRepo = join(scratch, 'repo');
  mkdirSync(join(isoRepo, '.git'), { recursive: true });
  const isoConfig = join(scratch, 'iso.project.json');
  writeFileSync(isoConfig, JSON.stringify({ name: 'iso', repoPath: isoRepo }));
  const env = { ...process.env, MAJOR_DB_PATH: isoDb };

  const added = majorEnv(env, 'project', 'add', isoConfig);
  if (added.status !== 0) {
    throw new Error(`fixture: project add failed (exit ${added.status}): ${added.stderr}`);
  }
  const taskAdded = majorEnv(env, 'task', 'add', '--project', 'iso', '--title', 'iso work');
  if (taskAdded.status !== 0) {
    throw new Error(`fixture: task add failed (exit ${taskAdded.status}): ${taskAdded.stderr}`);
  }
  const list = majorEnv(env, 'task', 'list', '--project', 'iso', '--json');
  if (list.status !== 0 || !list.stdout.trim()) {
    throw new Error(`fixture: task list failed (exit ${list.status}): ${list.stderr}`);
  }
  const taskId = (JSON.parse(list.stdout) as { data: { id: string }[] }).data[0]!.id;
  return { dbPath: isoDb, taskId };
}

beforeAll(() => {
  // Build the production artifact so these tests exercise the compiled CLI.
  execFileSync('pnpm', ['build'], { cwd: ROOT, stdio: 'ignore', timeout: 300_000 });
  if (!existsSync(CLI)) throw new Error(`compiled CLI not found after build: ${CLI}`);

  const scratch = mkdtempSync(join(tmpdir(), 'major-cli-'));
  dbPath = join(scratch, 'major.db');
  repoDir = join(scratch, 'demo-repo');
  mkdirSync(join(repoDir, '.git'), { recursive: true });
  configPath = join(scratch, 'demo.project.json');
  writeFileSync(configPath, JSON.stringify({ name: 'demo', repoPath: repoDir }));
}, 300_000);

describe('major CLI', () => {
  it('preserves every concurrent session attachment', async () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-session-race-'));
    const statePath = join(scratch, 'supervisor-state.json');
    const env = {
      ...process.env,
      MAJOR_STATE_PATH: statePath,
      MAJOR_POLICY_PATH: join(scratch, 'policies.json'),
      MAJOR_RESOURCE_PATH: join(scratch, 'resources.json'),
    };
    const runs = Array.from(
      { length: 12 },
      (_, index) =>
        new Promise<void>((resolveRun, rejectRun) => {
          const child = spawn(
            process.execPath,
            [
              ENTRY,
              'session',
              'attach',
              '--cwd',
              repoDir,
              '--host',
              'codex',
              '--session-id',
              `session-${index}`,
            ],
            { cwd: ROOT, env, stdio: 'ignore' },
          );
          child.once('error', rejectRun);
          child.once('close', (code) =>
            code === 0 ? resolveRun() : rejectRun(new Error(`session attach exited ${code}`)),
          );
        }),
    );
    await Promise.all(runs);
    const state = JSON.parse(readFileSync(statePath, 'utf8')) as {
      sessions: { sessionId?: string }[];
    };
    expect(state.sessions).toHaveLength(12);
    expect(new Set(state.sessions.map((session) => session.sessionId)).size).toBe(12);
  }, 30_000);

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

  it('keeps task routing inspection distinct from the live supervisor run command', () => {
    const list = major('task', 'list', '--project', 'demo', '--json');
    const taskId = (JSON.parse(list.stdout) as { data: { id: string }[] }).data[0]!.id;
    const result = major('route', '--task', taskId, '--json');
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ kind: 'route-inspection' });
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

  it('doctor emits versioned JSON, strict exit codes, and the activated capabilities', () => {
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
    expect(parsed.data.capabilities.every((c) => c.available === true)).toBe(true);
  }, 90_000);

  it('keeps the legacy task-ledger CLI free of execution and downstream-write commands', () => {
    const listCommands = (helpText: string) =>
      [...helpText.matchAll(/^ {2}([a-z]\S*)/gm)].map((m) => m[1]);

    const help = major('--help');
    expect(help.status).toBe(0);
    // This is the Commander task-ledger surface. The successor supervisor is
    // routed by src/entry.ts before Commander and has separate contract tests.
    expect(listCommands(help.stdout).sort()).toEqual([
      'doctor',
      'help',
      'project',
      'queue',
      'route',
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
    // Self-contained: its own database and project, independent of test order.
    const { dbPath: isoDb } = freshProjectDb();
    const isoEnv = { ...process.env, MAJOR_DB_PATH: isoDb };

    const suggest = majorEnv(
      isoEnv,
      'task',
      'suggest',
      '--project',
      'iso',
      '--title',
      'Approval gate check',
    );
    expect(suggest.status).toBe(0);
    const suggestionId = suggest.stdout.match(/tsug_\w+/)?.[0];
    expect(suggestionId).toBeTruthy();

    const countTasks = (env: NodeJS.ProcessEnv) => {
      const list = majorEnv(env, 'task', 'list', '--project', 'iso', '--json');
      if (list.status !== 0 || !list.stdout.trim()) {
        throw new Error(`task list failed (exit ${list.status}): ${list.stderr}`);
      }
      return (JSON.parse(list.stdout) as { data: unknown[] }).data.length;
    };
    const beforeCount = countTasks(isoEnv);

    // Even with hostile env/config, approval refuses with the canonical
    // unavailable exit code (4), before any database mutation.
    const approve = majorEnv(
      { ...isoEnv, MAJOR_ENABLE_APPROVAL: '1', MAJOR_UNSAFE: '1' },
      'task',
      'approve',
      suggestionId!,
      '--note',
      'try to force it',
    );
    expect(approve.status).toBe(4);
    expect(approve.stderr).toMatch(/suggestion approval is unavailable/);

    // No task was materialised…
    expect(countTasks(isoEnv)).toBe(beforeCount);

    // …and the suggestion is unchanged: still PENDING, so a same-scope re-suggest
    // folds into it as a duplicate (an approved/rejected one would not).
    const dup = majorEnv(
      isoEnv,
      'task',
      'suggest',
      '--project',
      'iso',
      '--title',
      'approval GATE check',
    );
    expect(dup.stdout).toMatch(/duplicate of pending suggestion/);
  }, 30_000);

  it('doctor human and JSON output agree that overnight execution is unavailable', () => {
    const human = major('doctor');
    expect([0, 5]).toContain(human.status);
    expect(human.stdout).toMatch(/overnight execution: UNAVAILABLE/);
    expect(human.stdout).not.toMatch(/overnight execution: SAFE/);

    const json = major('doctor', '--json');
    const parsed = JSON.parse(json.stdout) as { data: { overnightExecution: string } };
    expect(parsed.data.overnightExecution).toBe('unavailable');
  });

  it('discovery and dry-run create no process, even with a hostile executable override', () => {
    // Self-contained: its own database, project and task, so it runs in
    // isolation regardless of test order.
    const { dbPath: isoDb, taskId } = freshProjectDb();

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
      MAJOR_DB_PATH: isoDb,
      MAJOR_CLAUDE_BIN: fakeClaude,
      MAJOR_CODEX_BIN: fakeClaude,
      PATH: `${hostileDir}:${process.env.PATH ?? ''}`,
    };

    // doctor --json performs provider + tool discovery
    const doctor = majorEnv(hostileEnv, 'doctor', '--json');
    expect([0, 5]).toContain(doctor.status);
    if (!doctor.stdout.trim()) throw new Error(`doctor produced no output: ${doctor.stderr}`);
    expect(existsSync(sentinel)).toBe(false);

    // route performs process-free provider/model discovery + routing
    const dry = majorEnv(hostileEnv, 'route', '--task', taskId, '--json');
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

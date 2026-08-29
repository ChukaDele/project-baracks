import { execFileSync, spawn } from 'node:child_process';
import {
  chmodSync,
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import {
  persistProviderDiscovery,
  recordBillingObservation,
} from '../src/providers/discovery-store.js';

/**
 * Integration tests against the COMPILED CLI (built in beforeAll).
 *
 * `majorEnv` targets the inner Commander surface (`dist/cli/index.js`).
 * Supervisor, session, and provider-lifecycle commands are reached only
 * through `dist/entry.js` — the package `bin` — so those contracts use
 * `entryEnv`. Running the compiled artifact, not `src` via tsx, is what
 * makes "compiled-CLI coverage" an accurate claim.
 */

const ROOT = join(import.meta.dirname, '..');
const CLI = join(ROOT, 'dist', 'cli', 'index.js');
const PRODUCTION_ENTRY = join(ROOT, 'dist', 'entry.js');
let entryFixtureRoot = '';
let entryFixture = '';

interface CliResult {
  status: number;
  stdout: string;
  stderr: string;
}

let dbPath: string;
let repoDir: string;
let configPath: string;

// `major doctor` now reports a Storage section derived from MAJOR_HOME. Point it
// at an empty directory (inherited by every spawned CLI here) so these tests do
// not walk the developer's real ~/.major, which is slow and machine-dependent.
const storageHome = mkdtempSync(join(tmpdir(), 'major-cli-home-'));
process.env.MAJOR_HOME = storageHome;
afterAll(() => rmSync(storageHome, { recursive: true, force: true }));

function compiledCli(bin: string, env: NodeJS.ProcessEnv, args: string[]): CliResult {
  try {
    const stdout = execFileSync(process.execPath, [bin, ...args], {
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

function majorEnv(env: NodeJS.ProcessEnv, ...args: string[]): CliResult {
  return compiledCli(CLI, env, args);
}

function entryEnv(env: NodeJS.ProcessEnv, ...args: string[]): CliResult {
  return compiledCli(entryFixture, env, args);
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
  execFileSync('corepack', ['pnpm', 'build'], {
    cwd: ROOT,
    stdio: 'ignore',
    timeout: 300_000,
  });
  if (!existsSync(CLI)) throw new Error(`compiled CLI not found after build: ${CLI}`);
  if (!existsSync(PRODUCTION_ENTRY)) {
    throw new Error(`compiled entrypoint not found after build: ${PRODUCTION_ENTRY}`);
  }

  entryFixtureRoot = mkdtempSync(join(tmpdir(), 'major-entry-runtime-'));
  cpSync(join(ROOT, 'dist'), join(entryFixtureRoot, 'dist'), { recursive: true });
  cpSync(join(ROOT, 'drizzle'), join(entryFixtureRoot, 'drizzle'), { recursive: true });
  symlinkSync(join(ROOT, 'node_modules'), join(entryFixtureRoot, 'node_modules'), 'dir');
  writeFileSync(
    join(entryFixtureRoot, 'package.json'),
    JSON.stringify({ type: 'module', imports: { '#trust-roots': './trust-roots.mjs' } }),
  );
  writeFileSync(
    join(entryFixtureRoot, 'trust-roots.mjs'),
    `import { userInfo } from 'node:os';
import { dirname, join, resolve } from 'node:path';
export const trustedMajorHome = (env = process.env) => resolve(env.MAJOR_HOME ?? join(userInfo().homedir, '.major'));
export const trustedAccountHome = (env = process.env) => env.MAJOR_HOME ? dirname(trustedMajorHome(env)) : resolve(env.HOME ?? userInfo().homedir);
export const trustedCodexHome = (env = process.env) => env.MAJOR_HOME ? join(trustedAccountHome(env), '.codex') : resolve(env.CODEX_HOME ?? join(trustedAccountHome(env), '.codex'));
export const testFixturePath = (name) => process.env[name];
`,
  );
  entryFixture = join(entryFixtureRoot, 'dist', 'entry.js');

  const scratch = mkdtempSync(join(tmpdir(), 'major-cli-'));
  dbPath = join(scratch, 'major.db');
  repoDir = join(scratch, 'demo-repo');
  mkdirSync(join(repoDir, '.git'), { recursive: true });
  configPath = join(scratch, 'demo.project.json');
  writeFileSync(configPath, JSON.stringify({ name: 'demo', repoPath: repoDir }));
}, 300_000);

afterAll(() => {
  if (entryFixtureRoot) rmSync(entryFixtureRoot, { recursive: true, force: true });
});

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
              entryFixture,
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

  it('exposes Toolsmith planning through the compiled control-plane CLI', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-capability-cli-'));
    const candidates = join(scratch, 'candidates.json');
    writeFileSync(
      candidates,
      JSON.stringify([
        {
          key: 'local-fetch',
          name: 'Local fetch',
          description: 'Fetch structured public data.',
          type: 'local_tool',
          operations: ['fetch-structured-data'],
          riskLevel: 'low',
          costProfile: 'none',
          permissions: [],
          source: { kind: 'local_tool', reference: 'bin/local-fetch' },
          provenance: { discoveredBy: 'cli-discovery', evidence: 'help output' },
          preflight: {
            dependencyReviewed: true,
            permissionsReviewed: true,
            secretsSafe: true,
            telemetryReviewed: true,
            compatibilityChecked: true,
            smokeTestPassed: true,
            failureBehaviorPassed: true,
          },
        },
      ]),
    );
    const result = major(
      'capability',
      'plan',
      '--project',
      'demo',
      '--operation',
      'fetch-structured-data',
      '--candidates',
      candidates,
      '--json',
    );
    expect(result.status).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      kind: 'capability-plan',
      data: { kind: 'provision', assessment: { accepted: true } },
    });
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

  it('doctor emits versioned JSON, strict exit codes, and all five build capabilities available', () => {
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
    // live-agent-execution gates core isolated-runner safety, not per-provider
    // field-test outcome, so it stays available regardless of which providers
    // are authenticated on the machine running this test.
    expect(parsed.data.capabilities.every((c) => c.available)).toBe(true);
  }, 90_000);

  it('setup reports core, per-provider readiness, and never requires unattended authority', () => {
    const result = major('setup', '--json');
    expect([0, 1]).toContain(result.status);
    const parsed = JSON.parse(result.stdout) as {
      schemaVersion: number;
      kind: string;
      data: {
        core: { ready: boolean; issues: string[] };
        providerReadiness: { provider: string; state: string }[];
        liveExecution: { ready: boolean; healthyProviders: string[]; fallbackCount: number };
        multiProvider: { ready: boolean; healthyCount: number };
      };
    };
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.kind).toBe('setup-report');
    expect(typeof parsed.data.core.ready).toBe('boolean');
    expect(Array.isArray(parsed.data.providerReadiness)).toBe(true);
    for (const provider of parsed.data.providerReadiness) {
      expect([
        'READY',
        'AUTH_REQUIRED',
        'RATE_LIMITED',
        'EXHAUSTED',
        'UNAVAILABLE',
        'UNSUPPORTED_VERSION',
        'NOT_CONFIGURED',
      ]).toContain(provider.state);
    }
    // No JSON envelope from setup ever claims unattended/overnight authority.
    expect(result.stdout).not.toMatch(/overnightExecution.*"safe"/i);
  }, 90_000);

  it('recommends major provider connect codex specifically when no execution provider is connected', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-setup-recommend-'));
    const isoDb = join(scratch, 'major.db');
    const result = majorEnv({ ...process.env, MAJOR_DB_PATH: isoDb }, 'setup');
    expect(result.stdout).toMatch(/No execution provider is connected\./);
    expect(result.stdout).toMatch(/Recommended:\n\s*major provider connect codex/);
  }, 90_000);

  it('--interactive does not hang or attempt a connection when stdin is not a real terminal', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-setup-interactive-'));
    const isoDb = join(scratch, 'major.db');
    const result = majorEnv({ ...process.env, MAJOR_DB_PATH: isoDb }, 'setup', '--interactive');
    expect(result.stdout).toMatch(/No execution provider is connected\./);
    // Non-interactive stdin means the prompt is skipped entirely -- no
    // second "MAJOR SETUP" banner from a re-run after a (non-existent)
    // connect attempt.
    expect(result.stdout.match(/MAJOR SETUP/g)?.length).toBe(1);
  }, 90_000);

  it("doctor and setup reflect a persisted probe+billing observation, not just this run's host resolution", () => {
    // runDoctor's OWN pass is resolution-only host discovery; the CLI must
    // reconcile with what `major provider probe` / `attest-billing` already
    // recorded (see withPersistedReadiness), so a real isolated-probe result
    // is not discarded by the next doctor/setup run's fresh discovery.
    const scratch = mkdtempSync(join(tmpdir(), 'major-persisted-readiness-'));
    const isoDb = join(scratch, 'major.db');
    const opened = openDb(isoDb);
    try {
      const persisted = persistProviderDiscovery(
        opened.db,
        {
          name: 'codex',
          executable: '/opt/major/providers/v1/codex/bin/codex-native',
          installed: true,
          authenticated: true,
          models: [
            {
              modelRef: 'auto',
              routingClass: 'codex',
              visible: true,
              authenticated: true,
              availability: 'available',
              billingMode: 'unknown',
              prohibited: false,
              source: 'probe',
            },
          ],
        },
        { source: 'probe', note: 'authenticated in the isolated worker' },
      );
      recordBillingObservation(opened.db, {
        providerName: 'codex',
        modelRef: 'auto',
        billingMode: 'subscription_included',
        source: 'human',
        note: 'ChatGPT Plus subscription confirmed by owner',
      });
      expect(persisted.models[0]?.modelRef).toBe('auto');
    } finally {
      opened.sqlite.close();
    }

    const result = majorEnv({ ...process.env, MAJOR_DB_PATH: isoDb }, 'setup', '--json');
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: {
        core: { ready: boolean };
        providerReadiness: { provider: string; state: string }[];
        liveExecution: { ready: boolean; healthyProviders: string[] };
      };
    };
    expect(parsed.data.providerReadiness).toEqual(
      expect.arrayContaining([expect.objectContaining({ provider: 'codex', state: 'READY' })]),
    );
    expect(parsed.data.liveExecution.healthyProviders).toContain('codex');
    // liveExecutionReady also requires CORE safety (a working isolated-worker
    // backend), which depends on whatever Lima installation this specific
    // machine happens to have -- unrelated to what this test proves
    // (persisted provider+billing reconciliation). Assert the implication,
    // not an environment-dependent absolute, so this passes identically on
    // a maintainer Mac with Lima configured and on a clean CI runner with
    // none.
    if (parsed.data.core.ready) {
      expect(parsed.data.liveExecution.ready).toBe(true);
    }

    // doctor's overnightExecutionReasons must not still claim "no
    // verified+authenticated provider"/"no provider is READY" once the
    // reconciled provider state (just proven above) says codex is READY —
    // that self-contradiction is exactly what a friend would see otherwise.
    const doctorResult = majorEnv({ ...process.env, MAJOR_DB_PATH: isoDb }, 'doctor', '--json');
    // Exit 5 here reflects inspection health (no projects configured in this
    // isolated fixture db), not live-execution readiness — see the EXIT enum
    // in src/cli/index.ts.
    expect([0, 5]).toContain(doctorResult.status);
    const doctorParsed = JSON.parse(doctorResult.stdout) as {
      data: {
        overnightExecutionReasons: string[];
        liveExecutionReady: boolean;
        core: { ready: boolean };
      };
    };
    if (doctorParsed.data.core.ready) {
      expect(doctorParsed.data.liveExecutionReady).toBe(true);
    }
    expect(doctorParsed.data.overnightExecutionReasons.join('; ')).not.toMatch(
      /no verified\+authenticated|no provider is READY/,
    );
  }, 90_000);

  it('keeps the legacy task-ledger CLI free of execution and downstream-write commands', () => {
    const listCommands = (helpText: string) =>
      [...helpText.matchAll(/^ {2}([a-z]\S*)/gm)].map((m) => m[1]);

    const help = major('--help');
    expect(help.status).toBe(0);
    // This is the Commander task-ledger surface. The successor supervisor is
    // routed by src/entry.ts before Commander and has separate contract tests.
    expect(listCommands(help.stdout).sort()).toEqual([
      'capability',
      // `cleanup` reclaims Major-owned resources. It is deliberately part of
      // this pinned surface: it removes only resources Major created, and
      // refuses active, rollback, credential-bearing and unknown ones.
      'cleanup',
      'doctor',
      'execution',
      'help',
      'history',
      'hosts',
      'project',
      'queue',
      'rollback',
      'route',
      'setup',
      'support-bundle',
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

  it('hosts reports per-host integration status separately from CLI presence and execution-provider health', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-hosts-'));
    const home = join(scratch, 'home');
    mkdirSync(join(home, '.claude'), { recursive: true });
    writeFileSync(join(home, '.claude', 'major-global.md'), 'rules\n');
    writeFileSync(
      join(home, '.claude', 'CLAUDE.md'),
      '# Major global worker rules\n@~/.claude/major-global.md\n',
    );
    writeFileSync(
      join(home, '.claude', 'settings.json'),
      JSON.stringify({
        hooks: {
          SessionStart: [{ hooks: [{ command: '"major" session hook --host claude' }] }],
        },
      }),
    );
    const env = {
      ...process.env,
      HOME: home,
      MAJOR_HOME: join(home, '.major'),
      CODEX_HOME: join(home, '.codex'),
      MAJOR_STATE_PATH: join(scratch, 'supervisor-state.json'),
      MAJOR_POLICY_PATH: join(scratch, 'policies.json'),
      MAJOR_RESOURCE_PATH: join(scratch, 'resources.json'),
      MAJOR_DB_PATH: join(scratch, 'major.db'),
      // Deterministic "no CLI on PATH" for every host -- proves integration
      // status and execution-provider health are reported independently.
      PATH: join(scratch, 'empty-bin'),
    };
    mkdirSync(join(scratch, 'empty-bin'), { recursive: true });

    const attach = entryEnv(env, 'session', 'attach', '--host', 'claude', '--cwd', repoDir);
    expect(attach.status).toBe(0);

    const result = entryEnv(env, 'hosts', '--json');
    expect(result.status).toBe(0);
    const parsed = JSON.parse(result.stdout) as {
      data: {
        hosts: {
          host: string;
          cliInstalled: boolean;
          rulesInstalled: boolean;
          hookInstalled: boolean;
          attachedAt?: string;
          project?: string;
        }[];
      };
    };
    const byHost = new Map(parsed.data.hosts.map((row) => [row.host, row]));
    const claudeRow = byHost.get('claude')!;
    expect(claudeRow.cliInstalled).toBe(false);
    expect(claudeRow.rulesInstalled).toBe(true);
    expect(claudeRow.hookInstalled).toBe(true);
    expect(claudeRow.attachedAt).toBeTruthy();
    expect(claudeRow.project).toBeTruthy();

    for (const host of ['codex', 'cursor', 'antigravity']) {
      const row = byHost.get(host)!;
      expect(row.cliInstalled).toBe(false);
      expect(row.rulesInstalled).toBe(false);
      expect(row.hookInstalled).toBe(false);
      expect(row.attachedAt).toBeUndefined();
      expect(row.project).toBeUndefined();
    }

    const human = entryEnv(env, 'hosts');
    expect(human.status).toBe(0);
    expect(human.stdout).toContain('MAJOR HOSTS');
    expect(human.stdout).toContain('major provider status');
  });

  it('compiled entrypoint status and session attach render persisted two-account Codex capacity', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-entry-codex-'));
    const home = join(scratch, 'major-home');
    const repo = join(scratch, 'project-baracks');
    mkdirSync(home, { recursive: true });
    mkdirSync(join(repo, '.git'), { recursive: true });
    writeFileSync(
      join(repo, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/chukadele/project-baracks.git\n',
    );
    writeFileSync(
      join(home, 'codex-usage.json'),
      `${JSON.stringify(
        {
          fetchedAt: '2026-08-17T18:00:00.000Z',
          methods: ['account/read', 'account/rateLimits/read'],
          accounts: [
            {
              accountLabel: 'default',
              planType: 'plus',
              primary: { usedPercent: 42, windowDurationMins: 300 },
              secondary: { usedPercent: 18, windowDurationMins: 10_080 },
            },
            {
              accountLabel: 'work-b',
              planType: 'plus',
              primary: { usedPercent: 91, windowDurationMins: 300 },
              secondary: { usedPercent: 8, windowDurationMins: 10_080 },
            },
          ],
        },
        null,
        2,
      )}\n`,
    );
    const env = {
      ...process.env,
      HOME: join(scratch, 'user'),
      MAJOR_HOME: home,
      MAJOR_DB_PATH: join(scratch, 'major.db'),
      MAJOR_STATE_PATH: join(scratch, 'supervisor-state.json'),
      MAJOR_POLICY_PATH: join(scratch, 'policies.json'),
      MAJOR_RESOURCE_PATH: join(scratch, 'resources.json'),
    };
    try {
      const status = entryEnv(env, 'status');
      expect(status.status, status.stderr).toBe(0);
      expect(status.stdout).toContain('MAJOR: ACTIVE');
      expect(status.stdout).toContain('Codex capacity:');
      expect(status.stdout).toMatch(/default\s+plus\s+5h \[####\.{6}\] 42%/);
      expect(status.stdout).toMatch(/work-b\s+plus\s+5h \[#{9}\.\] 91%/);
      expect(status.stdout).toContain('source: account/read + account/rateLimits/read');
      expect(status.stdout).toContain('refresh: major provider usage');
      expect(status.stdout).not.toContain('no refreshed snapshot');
      for (const line of status.stdout.split('\n')) {
        if (
          line.includes('Codex capacity') ||
          line.includes('[#') ||
          line.includes('refresh: major provider usage')
        ) {
          expect(line.length, line).toBeLessThanOrEqual(80);
        }
      }

      const attach = entryEnv(env, 'session', 'attach', '--host', 'codex', '--cwd', repo);
      expect(attach.status, attach.stderr).toBe(0);
      expect(attach.stdout).toContain('Codex capacity:');
      expect(attach.stdout).toMatch(/default\s+plus\s+5h \[####\.{6}\] 42%/);
      expect(attach.stdout).toMatch(/work-b\s+plus\s+5h \[#{9}\.\] 91%/);
      expect(attach.stdout).toContain('refresh: major provider usage');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });

  it('compiled entrypoint provider usage refreshes the snapshot that status rereads', () => {
    const scratch = mkdtempSync(join(tmpdir(), 'major-entry-usage-'));
    const home = join(scratch, 'major-home');
    mkdirSync(home, { recursive: true });
    const env = {
      ...process.env,
      HOME: join(scratch, 'user'),
      MAJOR_HOME: home,
      MAJOR_DB_PATH: join(scratch, 'major.db'),
      MAJOR_STATE_PATH: join(scratch, 'supervisor-state.json'),
      MAJOR_POLICY_PATH: join(scratch, 'policies.json'),
      MAJOR_RESOURCE_PATH: join(scratch, 'resources.json'),
    };
    try {
      const before = entryEnv(env, 'status');
      expect(before.status, before.stderr).toBe(0);
      expect(before.stdout).toContain('no refreshed snapshot — run `major provider usage`');

      const help = entryEnv(env, 'provider');
      expect(help.status, help.stderr).toBe(0);
      expect(help.stdout).toMatch(/usage \[--json\]/);

      const usage = entryEnv(env, 'provider', 'usage');
      expect(usage.status, usage.stderr).toBe(0);
      expect(usage.stderr).not.toMatch(/unknown provider subcommand/);
      expect(usage.stdout).toContain('CODEX CAPACITY');
      expect(usage.stdout).toContain('No authenticated Codex accounts');
      expect(existsSync(join(home, 'codex-usage.json'))).toBe(true);

      const after = entryEnv(env, 'status');
      expect(after.status, after.stderr).toBe(0);
      expect(after.stdout).toContain('No authenticated Codex accounts');
      expect(after.stdout).toContain('refresh: major provider usage');
      expect(after.stdout).not.toContain('no refreshed snapshot');
    } finally {
      rmSync(scratch, { recursive: true, force: true });
    }
  });
});

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runWorkerMock = vi.fn();

// Safely simulates provider exhaustion/failover WITHOUT spawning any real
// process or consuming any real quota: only the OS-subprocess boundary
// (runWorker/hostAvailable) is mocked. Everything else -- the CLI command,
// goal admission, the provider router, runForegroundGoal's continuation
// loop, discovery-store bookkeeping -- is the real, unmodified code.
vi.mock('../src/supervisor/worker.js', () => ({
  hostAvailable: () => true,
  workerCommand: () => ({ command: 'fake-provider', args: [] }),
  runWorker: (input: unknown) => runWorkerMock(input),
}));

import { openDb } from '../src/db/client.js';
import {
  persistProviderDiscovery,
  recordBillingObservation,
} from '../src/providers/discovery-store.js';
import { runSupervisorCli } from '../src/supervisor/cli.js';
import { configureProjectPolicy } from '../src/supervisor/policy.js';
import { tryAcquireRepoCycleLock } from '../src/supervisor/runtime.js';
import { getGoal } from '../src/supervisor/state.js';
import { model } from './helpers.js';

let root = '';
let priorStatePath: string | undefined;
let priorPolicyPath: string | undefined;
let priorDbPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-foreground-failover-'));
  priorStatePath = process.env.MAJOR_STATE_PATH;
  priorPolicyPath = process.env.MAJOR_POLICY_PATH;
  priorDbPath = process.env.MAJOR_DB_PATH;
  process.env.MAJOR_STATE_PATH = join(root, 'state.json');
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
  runWorkerMock.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  if (priorStatePath === undefined) delete process.env.MAJOR_STATE_PATH;
  else process.env.MAJOR_STATE_PATH = priorStatePath;
  if (priorPolicyPath === undefined) delete process.env.MAJOR_POLICY_PATH;
  else process.env.MAJOR_POLICY_PATH = priorPolicyPath;
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  rmSync(root, { recursive: true, force: true });
});

function repo(name = 'jss-tool'): string {
  const repoPath = join(root, name);
  mkdirSync(join(repoPath, '.git'), { recursive: true });
  writeFileSync(
    join(repoPath, '.git', 'config'),
    `[remote "origin"]\n\turl = https://github.com/chukadele/${name}.git\n`,
  );
  return repoPath;
}

function lastLog(logs: string[]): unknown {
  return JSON.parse(logs.at(-1)!);
}

function resultEnvelope(status: 'done' | 'active', summary: string): string {
  const promotionEvidence =
    status === 'done'
      ? ',"promotionEvidence":{"focusedTests":"focused tests passed","cheapestCompileTypeOrBuild":"typecheck passed","criticalPathBehavior":"critical path passed","materialRiskChecks":[],"broaderValidation":{"triggers":[],"repositoryPolicyRequires":false,"performed":false},"review":{"level":"focused","passed":true},"blockerFindings":0}'
      : '';
  return JSON.stringify({
    type: 'result',
    result: `MAJOR_RESULT: {"status":"${status}","summary":"${summary}"${promotionEvidence}}`,
  });
}

describe('major run --goal-id (dispatch an already-admitted goal)', () => {
  it('resumes the admitted goal as-is: no redefinition, and runs it in the foreground', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const { db, sqlite } = openDb(process.env.MAJOR_DB_PATH);
    persistProviderDiscovery(
      db,
      {
        name: 'codex',
        installed: true,
        authenticated: true,
        models: [model({ modelRef: 'gpt-codex', routingClass: 'codex' })],
      },
      { source: 'cli' },
    );
    recordBillingObservation(db, {
      providerName: 'codex',
      modelRef: 'gpt-codex',
      billingMode: 'subscription_included',
      source: 'human',
    });
    sqlite.close();

    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'thread-a',
    ]);
    const goalId = (lastLog(logs) as { goalId: string }).goalId;

    runWorkerMock.mockResolvedValueOnce({
      host: 'codex',
      status: 'succeeded',
      exitCode: 0,
      stdout: resultEnvelope('active', 'making progress'),
      stderr: '',
      durationMs: 5,
      rateLimited: false,
      exhausted: false,
    });

    await runSupervisorCli(['run', 'jss-tool', '--goal-id', goalId, '--foreground']);

    expect(runWorkerMock).toHaveBeenCalledTimes(1);
    const goal = getGoal(goalId)!;
    expect(goal.goal).toBe('Ship the MVP'); // not redefined by dispatch
    expect(goal.lastSummary).toContain('making progress');
  });

  it('rejects a nonexistent goal id without dispatching anything', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    // Needs at least one real goal for resolveProject('jss-tool') to find
    // the project at all; the bogus id is what's actually under test.
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'thread-a',
    ]);
    await expect(
      runSupervisorCli(['run', 'jss-tool', '--goal-id', 'does-not-exist', '--foreground']),
    ).rejects.toThrow(/does not belong to project/);
    expect(runWorkerMock).not.toHaveBeenCalled();
  });

  it('still refuses foreground dispatch for an observe-trust project even with a valid goal id', async () => {
    const repoPath = repo();
    // No configureProjectPolicy call: default policy is unknown/observe.
    const { startGoal } = await import('../src/supervisor/state.js');
    const goal = startGoal({
      project: 'jss-tool',
      repoPath,
      goal: 'Ship the MVP',
      autonomous: false,
    });
    await expect(
      runSupervisorCli(['run', 'jss-tool', '--goal-id', goal.id, '--foreground']),
    ).rejects.toThrow(/observe-only/);
    expect(runWorkerMock).not.toHaveBeenCalled();
  });

  it('refuses a goal id that does not belong to the given project', async () => {
    const repoA = repo('project-a');
    const repoB = repo('project-b');
    configureProjectPolicy({
      project: 'project-a',
      repoPath: repoA,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    configureProjectPolicy({
      project: 'project-b',
      repoPath: repoB,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoA,
      '--host',
      'codex',
      '--outcome',
      'Ship A',
      '--session-id',
      'thread-a',
    ]);
    const goalId = (lastLog(logs) as { goalId: string }).goalId;
    // project-b needs its own admitted goal so resolveProject('project-b')
    // can resolve it at all -- otherwise the test would fail on project
    // resolution rather than on the cross-project refusal being tested.
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoB,
      '--host',
      'codex',
      '--outcome',
      'Ship B',
      '--session-id',
      'thread-b',
    ]);

    await expect(
      runSupervisorCli(['run', 'project-b', '--goal-id', goalId, '--foreground']),
    ).rejects.toThrow(/does not belong to project/);
    expect(runWorkerMock).not.toHaveBeenCalled();
  });

  it('reroutes to a different provider when the first is authoritatively exhausted, completing the same goal in one dispatch', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const { db, sqlite } = openDb(process.env.MAJOR_DB_PATH);
    for (const [name, modelRef, routingClass] of [
      ['codex', 'gpt-codex', 'codex'],
      ['claude-code', 'opus', 'opus'],
    ] as const) {
      persistProviderDiscovery(
        db,
        { name, installed: true, authenticated: true, models: [model({ modelRef, routingClass })] },
        { source: 'cli' },
      );
      recordBillingObservation(db, {
        providerName: name,
        modelRef,
        billingMode: 'subscription_included',
        source: 'human',
      });
    }
    sqlite.close();

    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'thread-a',
    ]);
    const goalId = (lastLog(logs) as { goalId: string }).goalId;

    runWorkerMock
      .mockImplementationOnce(async (input: { host: string }) => ({
        host: input.host,
        status: 'failed',
        exitCode: 1,
        stdout: '',
        stderr: 'usage limit reached',
        durationMs: 5,
        rateLimited: false,
        exhausted: true,
      }))
      .mockImplementationOnce(async (input: { host: string }) => ({
        host: input.host,
        status: 'succeeded',
        exitCode: 0,
        stdout: resultEnvelope('done', 'shipped'),
        stderr: '',
        durationMs: 5,
        rateLimited: false,
        exhausted: false,
      }));

    // The literal acceptance test: one dispatch call, no second command
    // issued by the (simulated) exhausted host.
    await runSupervisorCli(['run', 'jss-tool', '--goal-id', goalId, '--foreground']);

    expect(runWorkerMock).toHaveBeenCalledTimes(2);
    const hostsUsed = runWorkerMock.mock.calls.map((call) => (call[0] as { host: string }).host);
    expect(hostsUsed[0]).not.toBe(hostsUsed[1]);
    const goal = getGoal(goalId)!;
    // A worker's own "done" claim awaits independent grading -- it does not
    // itself flip status to 'done' -- but it must have gotten there via the
    // SECOND (non-exhausted) provider, with no further dispatch needed.
    expect(goal.pendingCompletion).toMatchObject({ summary: 'shipped' });
    expect(goal.retryImmediately).toBe(false);
  });

  it('rejects combining --goal-id with flags that only apply when creating a goal via --goal', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'thread-a',
    ]);
    const goalId = (lastLog(logs) as { goalId: string }).goalId;

    await expect(
      runSupervisorCli(['run', 'jss-tool', '--goal-id', goalId, '--coordinator', 'claude']),
    ).rejects.toThrow(/cannot be combined/);
    await expect(
      runSupervisorCli(['run', 'jss-tool', '--goal-id', goalId, '--capability', 'x']),
    ).rejects.toThrow(/cannot be combined/);
    await expect(
      runSupervisorCli(['run', 'jss-tool', '--goal-id', goalId, '--goal', 'something else']),
    ).rejects.toThrow(/cannot be combined/);
    expect(runWorkerMock).not.toHaveBeenCalled();
  });

  it('tells the caller plainly when a dispatch did nothing because another integration owner holds the repo lock', async () => {
    const repoPath = repo();
    configureProjectPolicy({
      project: 'jss-tool',
      repoPath,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const logs: string[] = [];
    vi.mocked(console.log).mockImplementation((value) => logs.push(String(value)));
    await runSupervisorCli([
      'goal',
      'admit',
      '--cwd',
      repoPath,
      '--host',
      'codex',
      '--outcome',
      'Ship the MVP',
      '--session-id',
      'thread-a',
    ]);
    const goalId = (lastLog(logs) as { goalId: string }).goalId;

    const release = tryAcquireRepoCycleLock(repoPath);
    expect(release).toBeTypeOf('function');
    try {
      await runSupervisorCli(['run', 'jss-tool', '--goal-id', goalId, '--foreground']);
    } finally {
      release?.();
    }

    expect(runWorkerMock).not.toHaveBeenCalled();
    expect(logs.some((line) => line.includes('no cycle actually ran'))).toBe(true);
  });
});

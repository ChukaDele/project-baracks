import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runWorkerMock = vi.fn();
const runValeMock = vi.fn(() => ({
  state: 'available' as const,
  passed: true,
  engine: 'vale' as const,
  version: 'Vale test',
  profile: 'academic' as const,
  findings: [],
  suppressions: [],
  detail: 'bounded test seam',
}));

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

vi.mock('../src/writing/vale.js', () => ({
  runLocalVale: () => runValeMock(),
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
import { writingDraftDigest, writingSourcesDigest } from '../src/writing/runtime.js';
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
  runValeMock.mockClear();
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
  mkdirSync(repoPath, { recursive: true });
  writeFileSync(join(repoPath, 'candidate.txt'), 'frozen\n');
  const gitOptions = {
    cwd: repoPath,
    env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
  };
  execFileSync('/usr/bin/git', ['init'], gitOptions);
  execFileSync(
    '/usr/bin/git',
    ['remote', 'add', 'origin', `https://github.com/chukadele/${name}.git`],
    gitOptions,
  );
  execFileSync('/usr/bin/git', ['add', 'candidate.txt'], gitOptions);
  execFileSync(
    '/usr/bin/git',
    ['-c', 'user.name=Major Test', '-c', 'user.email=major@example.test', 'commit', '-m', 'base'],
    gitOptions,
  );
  return repoPath;
}

function lastLog(logs: string[]): unknown {
  return JSON.parse(logs.at(-1)!);
}

function resultEnvelope(status: 'done' | 'active', summary: string, writingDraft?: string): string {
  const promotionEvidence =
    status === 'done'
      ? ',"promotionEvidence":{"focusedTests":"focused tests passed","cheapestCompileTypeOrBuild":"typecheck passed","criticalPathBehavior":"critical path passed","materialRiskChecks":[],"broaderValidation":{"triggers":[],"repositoryPolicyRequires":false,"performed":false},"review":{"level":"focused","passed":true},"blockerFindings":0}'
      : '';
  const draft = writingDraft === undefined ? '' : `,"writingDraft":${JSON.stringify(writingDraft)}`;
  return JSON.stringify({
    type: 'result',
    result: `MAJOR_RESULT: {"status":"${status}","summary":"${summary}"${draft}${promotionEvidence}}`,
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

    runWorkerMock.mockImplementationOnce(async (input: { prompt: string }) => {
      const identity = getGoal(goalId)?.candidate;
      expect(identity?.resolution).toBe('no_task');
      expect(identity?.sourceHead).toMatch(/^[a-f0-9]{40}$/);
      expect(identity?.sourceTreeDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(input.prompt).toContain('FROZEN CANDIDATE');
      return {
        host: 'codex',
        status: 'succeeded',
        exitCode: 0,
        stdout: resultEnvelope('active', 'making progress'),
        stderr: '',
        durationMs: 5,
        rateLimited: false,
        exhausted: false,
        sessionRef: 'codex-session-progress-1',
      };
    });

    await runSupervisorCli(['run', 'jss-tool', '--goal-id', goalId, '--foreground']);

    expect(runWorkerMock).toHaveBeenCalledTimes(1);
    const goal = getGoal(goalId)!;
    expect(goal.goal).toBe('Ship the MVP'); // not redefined by dispatch
    expect(goal.lastSummary).toContain('making progress');
  });

  it('runs provider-owned writingDraft through the real supervisor completion branch', async () => {
    const repoPath = repo('writing-tool');
    configureProjectPolicy({
      project: 'writing-tool',
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
      'write a reply',
      '--session-id',
      'thread-writing',
    ]);
    const goalId = (lastLog(logs) as { goalId: string }).goalId;
    runWorkerMock
      .mockResolvedValueOnce({
        host: 'codex',
        status: 'succeeded',
        exitCode: 0,
        stdout: `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Unbound draft.' }] } })}\n${resultEnvelope('done', 'unbound reply')}`,
        stderr: '',
        durationMs: 5,
        rateLimited: false,
        exhausted: false,
        sessionRef: 'writing-session-1',
      })
      .mockResolvedValueOnce({
        host: 'codex',
        status: 'succeeded',
        exitCode: 0,
        stdout: resultEnvelope('done', 'reply drafted', 'Thanks, I will send the update today.'),
        stderr: '',
        durationMs: 5,
        rateLimited: false,
        exhausted: false,
        sessionRef: 'writing-session-2',
      });

    await runSupervisorCli(['run', 'writing-tool', '--goal-id', goalId, '--foreground']);

    expect(getGoal(goalId)?.pendingCompletion).toBeUndefined();
    expect(getGoal(goalId)?.lastSummary).toMatch(/writingDraft is missing/);

    await runSupervisorCli(['run', 'writing-tool', '--goal-id', goalId, '--foreground']);

    expect(getGoal(goalId)?.pendingCompletion).toMatchObject({ summary: 'reply drafted' });
  });

  it('persists exact writing context and reruns final verification after persisted review', async () => {
    const repoPath = repo('reviewed-writing-tool');
    configureProjectPolicy({
      project: 'reviewed-writing-tool',
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
      'write an academic critical summary from these supplied sources',
      '--session-id',
      'thread-reviewed-writing',
    ]);
    const goalId = (lastLog(logs) as { goalId: string }).goalId;
    const draft = '  The study reports a measured improvement.  \n';
    const draftSha256 = writingDraftDigest(draft);
    const sources = [{ id: 'study-1', content: draft }];
    const sourcesSha256 = writingSourcesDigest(
      sources.map(({ id, content }) => `${id}\0${content}`),
    );
    const implementation = {
      status: 'done',
      summary: 'proposal drafted',
      writingDraft: draft,
      writingEvidence: {
        sourcePreservation: {
          draftSha256,
          sourcesSha256,
          sources,
          claimTrace: [{ claim: draft, sourceId: 'study-1', sourceExcerpt: draft }],
          protectedStatements: [draft],
        },
      },
      promotionEvidence: {
        focusedTests: 'focused tests passed',
        cheapestCompileTypeOrBuild: 'typecheck passed',
        criticalPathBehavior: 'critical path passed',
        materialRiskChecks: [],
        broaderValidation: {
          triggers: [],
          repositoryPolicyRequires: false,
          performed: false,
        },
        review: { level: 'focused', passed: true },
        blockerFindings: 0,
      },
    };
    const sourceHead = execFileSync('/usr/bin/git', ['rev-parse', 'HEAD'], {
      cwd: repoPath,
      encoding: 'utf8',
      env: { ...process.env, GIT_CONFIG_GLOBAL: '/dev/null' },
    }).trim();
    const review = {
      status: 'active',
      summary: 'exact draft passed independent review',
      independentReview: {
        purpose: 'independent_completion_review',
        goalId,
        sourceHead,
        verdict: 'pass',
        evidence: JSON.stringify({
          writingDraftSha256: draftSha256,
          assessment: 'The draft accurately preserves the supplied study statement.',
          checks: [
            {
              dimension: 'source fidelity',
              draftExcerpt: 'The study reports a measured improvement.',
              evidence: 'The traced claim matches study-1.',
            },
          ],
          findings: [],
          sourceCoverage: { sourcesSha256, verdict: 'pass' },
        }),
      },
    };
    const genericReview = structuredClone(review);
    genericReview.summary = 'generic review attempted';
    genericReview.independentReview.evidence = JSON.stringify({
      writingDraftSha256: draftSha256,
      assessment: 'The draft appears acceptable after a general quality review.',
      checks: [
        {
          dimension: 'quality',
          draftExcerpt: 'This excerpt does not occur in the draft.',
          evidence: 'A generic quality check was asserted.',
        },
      ],
      findings: [],
      sourceCoverage: { sourcesSha256, verdict: 'pass' },
    });
    runWorkerMock
      .mockResolvedValueOnce({
        host: 'codex',
        status: 'succeeded',
        exitCode: 0,
        stdout: JSON.stringify({
          type: 'result',
          result: `MAJOR_RESULT: ${JSON.stringify(implementation)}`,
        }),
        stderr: '',
        durationMs: 5,
        rateLimited: false,
        exhausted: false,
        sessionRef: 'writing-implementation-session',
      })
      .mockResolvedValueOnce({
        host: 'codex',
        status: 'succeeded',
        exitCode: 0,
        stdout: JSON.stringify({
          type: 'result',
          result: `MAJOR_RESULT: ${JSON.stringify(genericReview)}`,
        }),
        stderr: '',
        durationMs: 5,
        rateLimited: false,
        exhausted: false,
        sessionRef: 'generic-writing-review-session',
      })
      .mockResolvedValueOnce({
        host: 'codex',
        status: 'succeeded',
        exitCode: 0,
        stdout: JSON.stringify({
          type: 'result',
          result: `MAJOR_RESULT: ${JSON.stringify(review)}`,
        }),
        stderr: '',
        durationMs: 5,
        rateLimited: false,
        exhausted: false,
        sessionRef: 'writing-review-session',
      });

    await runSupervisorCli(['run', 'reviewed-writing-tool', '--goal-id', goalId, '--foreground']);
    const pending = getGoal(goalId)?.pendingCompletion;
    expect({ writing: pending?.writing }).toMatchObject({
      writing: {
        draft,
        draftSha256,
        sourceCoverageRequired: true,
        evidence: { sourcePreservation: { sources, sourcesSha256 } },
      },
    });

    await runSupervisorCli(['run', 'reviewed-writing-tool', '--goal-id', goalId, '--foreground']);

    expect(runWorkerMock.mock.calls[1]?.[0]).toMatchObject({ readOnly: true });
    expect(String((runWorkerMock.mock.calls[1]?.[0] as { prompt: string }).prompt)).toContain(
      JSON.stringify(draft),
    );
    expect(getGoal(goalId)?.pendingCompletion).toBeDefined();
    expect(getGoal(goalId)?.lastSummary).toMatch(/not bound/);

    await runSupervisorCli(['run', 'reviewed-writing-tool', '--goal-id', goalId, '--foreground']);

    expect(runValeMock).toHaveBeenCalledTimes(2);
    expect(getGoal(goalId)?.status).toBe('done');
    expect(getGoal(goalId)?.pendingCompletion).toBeUndefined();
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
        sessionRef: 'reviewer-session-success-2',
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
    expect(goal.pendingCompletion).toMatchObject({
      summary: 'shipped',
      sourceHead: goal.candidate?.sourceHead,
      sourceTreeDigest: goal.candidate?.sourceTreeDigest,
    });
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

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const runWorkerMock = vi.fn();

// Only the provider/process boundary is mocked. Goal admission, routing, the
// supervisor cycle, claims, worktrees and the merge queue are real; git runs
// for real in a temp repository.
vi.mock('../src/supervisor/worker.js', () => ({
  hostAvailable: () => true,
  workerCommand: () => ({ command: 'fake-provider', args: [] }),
  runWorker: (input: unknown) => runWorkerMock(input),
  runGatewayCommand: async (input: { executable: string; args: string[]; cwd: string }) => {
    const result = spawnSync(input.executable, input.args, { cwd: input.cwd, encoding: 'utf8' });
    return {
      status: result.status === 0 ? 'succeeded' : 'failed',
      exitCode: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: 1,
      rateLimited: false,
      exhausted: false,
    };
  },
}));

// Pin worker capacity so the batch size does not depend on host memory.
vi.mock('../src/supervisor/resources.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/supervisor/resources.js')>();
  return {
    ...actual,
    currentResourceLimits: () => ({ ...actual.GLOBAL_RESOURCE_LIMITS, workers: 4 }),
  };
});

import { projectConfigSchema } from '../src/config/project-config.js';
import { getOrAddProject } from '../src/config/project-service.js';
import { eq } from 'drizzle-orm';
import { openDb } from '../src/db/client.js';
import { agentRuns } from '../src/db/schema.js';
import { addTask, getTask, transitionTask } from '../src/domain/task-service.js';
import {
  persistProviderDiscovery,
  recordBillingObservation,
} from '../src/providers/discovery-store.js';
import { runSupervisorCli } from '../src/supervisor/cli.js';
import { configureProjectPolicy } from '../src/supervisor/policy.js';
import { getGoal } from '../src/supervisor/state.js';
import { model } from './helpers.js';

const ENV = ['MAJOR_STATE_PATH', 'MAJOR_POLICY_PATH', 'MAJOR_DB_PATH', 'MAJOR_HOME'] as const;
let root = '';
let prior: Record<string, string | undefined> = {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-parallel-runtime-'));
  prior = Object.fromEntries(ENV.map((key) => [key, process.env[key]]));
  process.env.MAJOR_STATE_PATH = join(root, 'state.json');
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
  process.env.MAJOR_HOME = join(root, '.major');
  runWorkerMock.mockReset();
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
  for (const key of ENV) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
  rmSync(root, { recursive: true, force: true });
});

async function admittedGoal(parallelWorkers: boolean, names = ['alpha', 'beta']) {
  const repoPath = join(root, 'app');
  mkdirSync(repoPath);
  const git = (...args: string[]) => execFileSync('git', args, { cwd: repoPath });
  git('init', '-q', '-b', 'main');
  git('remote', 'add', 'origin', 'https://github.com/chukadele/app.git');
  git('config', 'user.email', 'major@example.test');
  git('config', 'user.name', 'Major Test');
  writeFileSync(join(repoPath, 'README.md'), 'app\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  configureProjectPolicy({
    project: 'app',
    repoPath,
    projectClass: 'workshop',
    trust: 'build',
    ownerApprovedBuild: true,
    parallelWorkers,
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
  const project = getOrAddProject(
    db,
    projectConfigSchema.parse({ name: 'app', repoPath, verificationCommands: ['git status'] }),
  );
  const taskIds = names.map((name) => {
    const task = addTask(db, { projectId: project.id, title: name, paths: [`${name}/**`] });
    transitionTask(db, task.id, 'ready');
    transitionTask(db, task.id, 'queued');
    return task.id;
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
    'Ship alpha and beta',
    '--session-id',
    'thread-parallel',
  ]);
  const goalId = (JSON.parse(logs.at(-1)!) as { goalId: string }).goalId;
  return { repoPath, goalId, taskIds };
}

function taskStatuses(taskIds: string[]) {
  const { db, sqlite } = openDb(process.env.MAJOR_DB_PATH);
  try {
    return taskIds.map((id) => getTask(db, id).status);
  } finally {
    sqlite.close();
  }
}

const succeeded = {
  host: 'codex',
  status: 'succeeded',
  exitCode: 0,
  stdout: '',
  stderr: '',
  durationMs: 5,
  rateLimited: false,
  exhausted: false,
  sessionRef: 'codex-session',
};

describe('parallel workers through the real supervisor cycle', { timeout: 30_000 }, () => {
  it('flag off: one worker on the goal checkout, declared tasks untouched', async () => {
    const { repoPath, goalId, taskIds } = await admittedGoal(false);
    runWorkerMock.mockResolvedValue(succeeded);

    await runSupervisorCli(['run', 'app', '--goal-id', goalId, '--foreground']);

    expect(runWorkerMock).toHaveBeenCalledTimes(1);
    expect(runWorkerMock.mock.calls[0]![0]).toMatchObject({ cwd: repoPath });
    expect(taskStatuses(taskIds)).toEqual(['queued', 'queued']);
    expect(getGoal(goalId)?.lastSummary).not.toContain('Parallel cycle');
  });

  it('flag on: disjoint tasks run in separate worktrees and both land on the goal checkout', async () => {
    const { repoPath, goalId, taskIds } = await admittedGoal(true);
    runWorkerMock.mockImplementation(async (input: { cwd: string; prompt: string }) => {
      const name =
        input.prompt.includes('Work only on task') && input.prompt.match(/: (alpha|beta)\n/)?.[1];
      if (name) {
        mkdirSync(join(input.cwd, name));
        writeFileSync(join(input.cwd, name, 'done.txt'), `${name}\n`);
      }
      return succeeded;
    });

    await runSupervisorCli(['run', 'app', '--goal-id', goalId, '--foreground']);

    expect(runWorkerMock).toHaveBeenCalledTimes(2);
    const cwds = runWorkerMock.mock.calls.map((call) => (call[0] as { cwd: string }).cwd);
    expect(new Set(cwds).size).toBe(2);
    for (const cwd of cwds) expect(cwd.startsWith(join(root, '.major', 'worktrees'))).toBe(true);
    expect(taskStatuses(taskIds)).toEqual(['verifying', 'verifying']);
    expect(existsSync(join(repoPath, 'alpha', 'done.txt'))).toBe(true);
    expect(existsSync(join(repoPath, 'beta', 'done.txt'))).toBe(true);
    expect(getGoal(goalId)?.lastSummary).toContain('Parallel cycle');
  });

  it('a landed task reaches completed through the independent completion review', async () => {
    const { repoPath, goalId, taskIds } = await admittedGoal(true, ['alpha']);
    const [alpha] = taskIds as [string];
    const head = () =>
      execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repoPath }).toString().trim();
    const result = (report: object, sessionRef: string) => ({
      ...succeeded,
      stdout: JSON.stringify({ type: 'result', result: `MAJOR_RESULT: ${JSON.stringify(report)}` }),
      sessionRef,
    });
    runWorkerMock.mockImplementation(
      async (input: { cwd: string; prompt: string; readOnly?: boolean }) => {
        if (input.prompt.includes('Work only on task')) {
          mkdirSync(join(input.cwd, 'alpha'));
          writeFileSync(join(input.cwd, 'alpha', 'done.txt'), 'alpha\n');
          return succeeded;
        }
        if (input.readOnly) {
          return result(
            {
              status: 'active',
              summary: 'landed alpha reviewed',
              independentReview: {
                purpose: 'independent_completion_review',
                goalId,
                sourceHead: head(),
                verdict: 'pass',
                evidence: 'alpha/done.txt exists at the exact head',
              },
            },
            'review-session',
          );
        }
        return result(
          { status: 'done', summary: 'alpha shipped', taskId: alpha },
          'coordinator-session',
        );
      },
    );

    // Cycle 1: the merge queue lands alpha with a canonical implementation run.
    await runSupervisorCli(['run', 'app', '--goal-id', goalId, '--foreground']);
    expect(taskStatuses(taskIds)).toEqual(['verifying']);
    const { db, sqlite } = openDb(process.env.MAJOR_DB_PATH);
    try {
      expect(db.select().from(agentRuns).where(eq(agentRuns.taskId, alpha)).all()).toEqual([
        expect.objectContaining({
          purpose: 'implementation',
          status: 'succeeded',
          sourceHead: head(),
          sessionRef: 'codex-session',
        }),
      ]);
    } finally {
      sqlite.close();
    }

    // Cycle 2: alpha enters the gate; the coordinator claims done for it.
    await runSupervisorCli(['run', 'app', '--goal-id', goalId, '--foreground']);
    expect(taskStatuses(taskIds)).toEqual(['ready_to_merge']);
    expect(getGoal(goalId)?.pendingCompletion?.taskId).toBe(alpha);

    // Cycle 3: the independent review passes and its grade completes alpha.
    await runSupervisorCli(['run', 'app', '--goal-id', goalId, '--foreground']);
    expect(runWorkerMock.mock.calls.at(-1)?.[0]).toMatchObject({ readOnly: true });
    expect(taskStatuses(taskIds)).toEqual(['completed']);
    expect(getGoal(goalId)?.status).toBe('done');
  });
});

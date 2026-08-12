import { mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { platform, tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/security/capabilities.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/security/capabilities.js')>();
  return {
    ...actual,
    isCapabilityAvailable: () => true,
    assertCapabilityAvailable: () => undefined,
  };
});

import { agentProviders, roadmapItems } from '../src/db/schema.js';
import { claimNextTask, completeClaim, heartbeatClaim } from '../src/domain/claim-service.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import { appendRunEvent, createRun, setRunStatus } from '../src/domain/run-service.js';
import { addTask, getTask, transitionTask } from '../src/domain/task-service.js';
import { MockSheetsAdapter } from '../src/roadmap/mock-sheets.js';
import { applyRoadmapUpdate, proposeRoadmapUpdate } from '../src/roadmap/proposal-service.js';
import { darwinSeatbeltContainment } from '../src/security/containment.js';
import { ExecutionGateway } from '../src/security/gateway.js';
import { executeMajorCommand } from '../src/security/major-gateway.js';
import { TrustedExecutableRegistry } from '../src/security/trusted-executables.js';
import { gatewayAllowedRoots } from '../src/supervisor/worker.js';
import {
  ensureObservedModel,
  recordQualifyingVerification,
  seedProject,
  testDb,
} from './helpers.js';

describe.runIf(platform() === 'darwin')('M1 enabled execution path', () => {
  it('executes a trusted binary inside Seatbelt and writes only inside the project root', async () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'major-enabled-exec-')));
    const marker = join(root, 'marker.txt');
    const registry = new TrustedExecutableRegistry();
    registry.pin(process.execPath);
    const decisions: { allowed: boolean }[] = [];
    const gateway = new ExecutionGateway({
      allowedRoots: [root],
      commandPolicy: { allowedExecutables: ['node'] },
      trustedExecutables: registry,
      containment: darwinSeatbeltContainment(),
      baseEnv: { PATH: process.env.PATH ?? '/usr/bin:/bin' },
      recordDecision: (decision) => decisions.push(decision),
    });
    const handle = gateway.execute({
      executable: process.execPath,
      args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'contained')`],
      cwd: root,
    });
    for await (const _event of handle.events) void _event;
    expect(await handle.outcome).toMatchObject({ status: 'succeeded', exitCode: 0 });
    expect(readFileSync(marker, 'utf8')).toBe('contained');
    expect(decisions.map((decision) => decision.allowed)).toEqual([true]);
  });

  it('runs real Git through the production gateway with isolated HOME and TMPDIR', async () => {
    const parent = realpathSync(mkdtempSync(join(tmpdir(), 'major-enabled-git-')));
    const main = join(parent, 'main');
    const worktree = join(parent, 'worktree');
    for (const args of [
      ['init', '--initial-branch=main', main],
      ['-C', main, 'config', 'user.name', 'Major Test'],
      ['-C', main, 'config', 'user.email', 'major@example.invalid'],
    ]) {
      const result = spawnSync('git', args, { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    }
    writeFileSync(join(main, 'seed.txt'), 'seed\n');
    for (const args of [
      ['-C', main, 'add', 'seed.txt'],
      ['-C', main, 'commit', '-m', 'seed'],
      ['-C', main, 'worktree', 'add', '-b', 'test-worktree', worktree],
    ]) {
      const result = spawnSync('git', args, { encoding: 'utf8' });
      expect(result.status, result.stderr).toBe(0);
    }
    writeFileSync(join(worktree, 'marker.txt'), 'contained\n');
    const priorMajorHome = process.env.MAJOR_HOME;
    process.env.MAJOR_HOME = join(parent, 'major-home');
    try {
      const handle = executeMajorCommand({
        executable: 'git',
        args: ['add', 'marker.txt'],
        cwd: worktree,
        allowedRoots: gatewayAllowedRoots(worktree),
      });
      for await (const _event of handle.events) void _event;
      expect(await handle.outcome).toMatchObject({ status: 'succeeded', exitCode: 0 });
    } finally {
      if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
      else process.env.MAJOR_HOME = priorMajorHome;
    }
    const status = spawnSync('git', ['-C', worktree, 'status', '--porcelain'], {
      encoding: 'utf8',
    });
    expect(status.stdout).toContain('A  marker.txt');
  }, 30_000);
});

describe('enabled v1 capability paths retained until successor proof', () => {
  it('M2 consumes one exact paid approval while creating the authorised run', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'paid task' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'claude-code' }).run();
    ensureObservedModel(db, providerId, 'opus', 'api_billing');
    const decision = createDecisionRequest(db, {
      projectId: project.id,
      taskId: task.id,
      category: 'paid_usage',
      question: 'Use paid Claude for this exact run?',
      contextJson: JSON.stringify({
        scope: { provider: 'claude-code', modelRef: 'opus', purpose: 'implementation' },
      }),
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    resolveDecision(db, decision.id, 'approved', 'owner approved this exact run');
    const run = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'opus',
      purpose: 'implementation',
      billingMode: 'api_billing',
      routingReason: 'exact paid approval',
      paidUsageDecisionId: decision.id,
    });
    expect(run.paidUsageDecisionId).toBe(decision.id);
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        modelRef: 'opus',
        purpose: 'implementation',
        billingMode: 'api_billing',
        routingReason: 'replay',
        paidUsageDecisionId: decision.id,
      }),
    ).toThrow(/unconsumed|exactly once/);
  });

  it('M3 completes only through the service after qualifying immutable proof', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'verified task' });
    for (const status of [
      'ready',
      'queued',
      'running',
      'verifying',
      'reviewing',
      'ready_to_merge',
    ] as const) {
      transitionTask(db, task.id, status);
    }
    expect(() => transitionTask(db, task.id, 'completed')).toThrow(/completion proof/);
    recordQualifyingVerification(db, task.id);
    expect(transitionTask(db, task.id, 'completed').status).toBe('completed');
  });

  it('M4 carries one live claim fence across run events and task mutation', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'claimed task' });
    transitionTask(db, task.id, 'ready');
    transitionTask(db, task.id, 'queued');
    const claimed = claimNextTask(db, { workerId: 'worker-1', leaseMs: 60_000 });
    expect(claimed?.task.status).toBe('running');
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'codex' }).run();
    ensureObservedModel(db, providerId, 'auto');
    const run = createRun(db, {
      taskId: task.id,
      providerId,
      claimId: claimed!.claim.id,
      claimWorkerId: 'worker-1',
      modelRef: 'auto',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'live fenced run',
    });
    expect(heartbeatClaim(db, claimed!.claim.id, 'worker-1').status).toBe('active');
    expect(setRunStatus(db, run.id, 'running').status).toBe('running');
    expect(appendRunEvent(db, run.id, 'progress', { ok: true }).duplicate).toBe(false);
    expect(
      transitionTask(db, task.id, 'verifying', {
        fence: { claimId: claimed!.claim.id, workerId: 'worker-1' },
      }).status,
    ).toBe('verifying');
    expect(completeClaim(db, claimed!.claim.id, 'worker-1').status).toBe('completed');
    expect(getTask(db, task.id).mutationClaimId).toBe(claimed!.claim.id);
  });

  it('M5 applies an idempotent dry-run-bound roadmap update', async () => {
    const db = testDb();
    const project = seedProject(db);
    const itemId = newId('ritem');
    db.insert(roadmapItems)
      .values({ id: itemId, projectId: project.id, stableRef: 'RM-1', title: 'Release' })
      .run();
    addTask(db, { projectId: project.id, roadmapItemId: itemId, title: 'release task' });
    const adapter = new MockSheetsAdapter([
      { stableId: 'RM-1', values: { Title: 'Release', Status: 'In Progress' } },
    ]);
    const update = await proposeRoadmapUpdate(db, adapter, {
      roadmapItemId: itemId,
      baseKey: 'release-review',
      changes: [{ stableId: 'RM-1', columns: { Status: 'Review' } }],
      rationale: 'validated and ready for review',
    });
    expect((await applyRoadmapUpdate(db, adapter, update.id)).status).toBe('applied');
    expect((await applyRoadmapUpdate(db, adapter, update.id)).status).toBe('already_applied');
    expect((await adapter.readRow('RM-1'))?.values.Status).toBe('Review');
  });
});

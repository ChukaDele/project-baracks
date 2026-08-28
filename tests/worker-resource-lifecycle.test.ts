import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let finish: ((value: unknown) => void) | undefined;
let gatewayStarted: Promise<void>;
let signalGatewayStarted: (() => void) | undefined;

function resetGatewaySynchronization(): void {
  gatewayStarted = new Promise((resolve) => {
    signalGatewayStarted = resolve;
  });
}

resetGatewaySynchronization();

vi.mock('../src/security/major-gateway.js', () => ({
  readSystemMemoryAvailablePercent: () => undefined,
  executeMajorCommand: () => ({
    events: (async function* () {})(),
    outcome: new Promise((resolve) => {
      finish = resolve;
      signalGatewayStarted?.();
    }),
    cancel: vi.fn(),
  }),
}));

import { resourceSnapshot } from '../src/supervisor/resources.js';
import { isMissingCodexResumeFailure, runWorker } from '../src/supervisor/worker.js';

let root = '';
let priorResourcePath: string | undefined;
let priorMemory: string | undefined;
let priorParentLeaseId: string | undefined;
let priorMajorHome: string | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  resetGatewaySynchronization();
  root = mkdtempSync(join(tmpdir(), 'major-worker-resource-'));
  priorResourcePath = process.env.MAJOR_RESOURCE_PATH;
  priorMemory = process.env.MAJOR_MEMORY_AVAILABLE_PERCENT;
  priorParentLeaseId = process.env.MAJOR_RESOURCE_LEASE_ID;
  priorMajorHome = process.env.MAJOR_HOME;
  delete process.env.MAJOR_RESOURCE_LEASE_ID;
  process.env.MAJOR_RESOURCE_PATH = join(root, 'resources.json');
  process.env.MAJOR_HOME = join(root, 'major-home');
  process.env.MAJOR_MEMORY_AVAILABLE_PERCENT = '100';
});

afterEach(() => {
  vi.useRealTimers();
  if (priorResourcePath === undefined) delete process.env.MAJOR_RESOURCE_PATH;
  else process.env.MAJOR_RESOURCE_PATH = priorResourcePath;
  if (priorMemory === undefined) delete process.env.MAJOR_MEMORY_AVAILABLE_PERCENT;
  else process.env.MAJOR_MEMORY_AVAILABLE_PERCENT = priorMemory;
  if (priorParentLeaseId === undefined) delete process.env.MAJOR_RESOURCE_LEASE_ID;
  else process.env.MAJOR_RESOURCE_LEASE_ID = priorParentLeaseId;
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  rmSync(root, { recursive: true, force: true });
  finish = undefined;
});

describe('worker resource lifecycle', () => {
  it('only treats a missing Codex rollout as a recoverable resume failure', () => {
    expect(
      isMissingCodexResumeFailure({
        status: 'failed',
        stdout: '',
        stderr: 'thread/resume failed: no rollout found',
      }),
    ).toBe(true);
    expect(
      isMissingCodexResumeFailure({
        status: 'failed',
        stdout: '',
        stderr: 'provider authentication failed',
      }),
    ).toBe(false);
  });

  it('propagates returned-tree evidence from the gateway outcome to the worker outcome', async () => {
    vi.useRealTimers();
    const running = runWorker({ host: 'codex', cwd: root, prompt: 'read only' });
    await gatewayStarted;
    if (!finish) throw new Error('gateway propagation mock was not initialized');
    finish({
      status: 'succeeded',
      exitCode: 0,
      rateLimited: false,
      exhausted: false,
      cleanup: 'complete',
      workspaceMutated: false,
    });
    await expect(running).resolves.toMatchObject({
      host: 'codex',
      status: 'succeeded',
      workspaceMutated: false,
    });
  });

  it('keeps omitted returned-tree evidence omitted', async () => {
    vi.useRealTimers();
    const running = runWorker({ host: 'codex', cwd: root, prompt: 'read only' });
    await gatewayStarted;
    if (!finish) throw new Error('gateway propagation mock was not initialized');
    finish({
      status: 'succeeded',
      exitCode: 0,
      rateLimited: false,
      exhausted: false,
      cleanup: 'complete',
    });
    const outcome = await running;
    expect(Object.hasOwn(outcome, 'workspaceMutated')).toBe(false);
  });

  it('keeps a two-hour worker lease alive until execution is terminal', async () => {
    const running = runWorker({
      host: 'claude',
      cwd: root,
      prompt: 'read only',
      taskId: 'goal_worker_lifecycle',
      resourceId: 'worker:test-project',
      timeoutMs: 120 * 60 * 1000,
    });
    await Promise.resolve();
    const initial = resourceSnapshot().leases[0]!;
    expect(initial).toMatchObject({
      taskId: 'goal_worker_lifecycle',
      resourceId: 'worker:test-project',
    });
    expect(Date.parse(initial.expiresAt) - Date.now()).toBeGreaterThan(120 * 60 * 1000);

    await vi.advanceTimersByTimeAsync(6 * 60 * 1000);
    const renewed = resourceSnapshot().leases[0]!;
    expect(Date.parse(renewed.heartbeatAt)).toBeGreaterThan(Date.parse(initial.heartbeatAt));
    expect(Date.parse(renewed.expiresAt) - Date.now()).toBeGreaterThan(120 * 60 * 1000);

    await vi.advanceTimersByTimeAsync(31 * 60 * 1000);
    expect(resourceSnapshot().leases).toHaveLength(1);

    finish?.({
      status: 'succeeded',
      exitCode: 0,
      rateLimited: false,
      exhausted: false,
      cleanup: 'complete',
    });
    await running;
    expect(resourceSnapshot().leases).toHaveLength(0);
  });
});

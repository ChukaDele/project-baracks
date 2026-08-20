import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let finish: ((value: unknown) => void) | undefined;

vi.mock('../src/security/major-gateway.js', () => ({
  readSystemMemoryAvailablePercent: () => undefined,
  executeMajorCommand: () => ({
    events: (async function* () {})(),
    outcome: new Promise((resolve) => {
      finish = resolve;
    }),
    cancel: vi.fn(),
  }),
}));

import { resourceSnapshot } from '../src/supervisor/resources.js';
import { runWorker } from '../src/supervisor/worker.js';

let root = '';
let priorResourcePath: string | undefined;
let priorMemory: string | undefined;

beforeEach(() => {
  vi.useFakeTimers();
  root = mkdtempSync(join(tmpdir(), 'major-worker-resource-'));
  priorResourcePath = process.env.MAJOR_RESOURCE_PATH;
  priorMemory = process.env.MAJOR_MEMORY_AVAILABLE_PERCENT;
  process.env.MAJOR_RESOURCE_PATH = join(root, 'resources.json');
  process.env.MAJOR_MEMORY_AVAILABLE_PERCENT = '100';
});

afterEach(() => {
  vi.useRealTimers();
  if (priorResourcePath === undefined) delete process.env.MAJOR_RESOURCE_PATH;
  else process.env.MAJOR_RESOURCE_PATH = priorResourcePath;
  if (priorMemory === undefined) delete process.env.MAJOR_MEMORY_AVAILABLE_PERCENT;
  else process.env.MAJOR_MEMORY_AVAILABLE_PERCENT = priorMemory;
  rmSync(root, { recursive: true, force: true });
  finish = undefined;
});

describe('worker resource lifecycle', () => {
  it('propagates returned-tree evidence from the gateway outcome to the worker outcome', async () => {
    const running = runWorker({ host: 'codex', cwd: root, prompt: 'read only' });
    await Promise.resolve();
    finish?.({
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

  it('keeps a two-hour worker lease alive until execution is terminal', async () => {
    const running = runWorker({
      host: 'claude',
      cwd: root,
      prompt: 'read only',
      timeoutMs: 120 * 60 * 1000,
    });
    await Promise.resolve();
    const initial = resourceSnapshot().leases[0]!;
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

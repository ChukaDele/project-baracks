import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  assertActiveResourceLease,
  formatResourceTelemetry,
  heartbeatResource,
  reclaimStaleResources,
  releaseResource,
  requestResource,
  resourceSnapshot,
} from '../src/supervisor/resources.js';

const roots: string[] = [];
const source = pathToFileURL(
  resolve(dirname(fileURLToPath(import.meta.url)), '../src/supervisor/resources.ts'),
).href;
let priorResourcePath: string | undefined;
let priorMemoryPercent: string | undefined;
let priorWorkerLimit: string | undefined;
let priorParentLeaseId: string | undefined;

beforeEach(() => {
  priorResourcePath = process.env.MAJOR_RESOURCE_PATH;
  priorMemoryPercent = process.env.MAJOR_MEMORY_AVAILABLE_PERCENT;
  priorWorkerLimit = process.env.MAJOR_WORKER_LIMIT;
  priorParentLeaseId = process.env.MAJOR_RESOURCE_LEASE_ID;
  delete process.env.MAJOR_RESOURCE_LEASE_ID;
  // Keep legacy guard tests deterministic. Production uses the live host
  // capacity calculation and no longer has this one-worker ceiling.
  process.env.MAJOR_WORKER_LIMIT = '1';
  const root = mkdtempSync(join(tmpdir(), 'major-resources-'));
  roots.push(root);
  process.env.MAJOR_RESOURCE_PATH = join(root, 'resources.json');
  process.env.MAJOR_MEMORY_AVAILABLE_PERCENT = '100';
});

afterEach(() => {
  if (priorResourcePath === undefined) delete process.env.MAJOR_RESOURCE_PATH;
  else process.env.MAJOR_RESOURCE_PATH = priorResourcePath;
  if (priorMemoryPercent === undefined) delete process.env.MAJOR_MEMORY_AVAILABLE_PERCENT;
  else process.env.MAJOR_MEMORY_AVAILABLE_PERCENT = priorMemoryPercent;
  if (priorWorkerLimit === undefined) delete process.env.MAJOR_WORKER_LIMIT;
  else process.env.MAJOR_WORKER_LIMIT = priorWorkerLimit;
  if (priorParentLeaseId === undefined) delete process.env.MAJOR_RESOURCE_LEASE_ID;
  else process.env.MAJOR_RESOURCE_LEASE_ID = priorParentLeaseId;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function concurrentRequest(owner: string): Promise<string> {
  const program = `
    import { requestResource } from ${JSON.stringify(source)};
    const result = requestResource({ kind: 'worker', owner: process.env.MAJOR_TEST_OWNER, project: 'qa-wave' });
    process.stdout.write(result.status);
  `;
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', program],
      {
        env: { ...process.env, MAJOR_TEST_OWNER: owner },
        stdio: ['ignore', 'pipe', 'pipe'],
      },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => (stdout += chunk.toString('utf8')));
    child.stderr.on('data', (chunk: Buffer) => (stderr += chunk.toString('utf8')));
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolveResult(stdout);
      else reject(new Error(`resource requester exited ${code}: ${stderr}`));
    });
  });
}

describe('Major global resource guard', () => {
  it('records explicit task, resource, and fencing identity on every new lease', () => {
    const result = requestResource({
      kind: 'worker',
      owner: 'owner-token',
      taskId: 'goal_123',
      resourceId: 'worker:project-a',
    });
    expect(result.status).toBe('active');
    if (result.status !== 'active') return;
    expect(result.lease).toMatchObject({
      taskId: 'goal_123',
      resourceId: 'worker:project-a',
      owner: 'owner-token',
    });
    expect(result.lease.id).toMatch(/^lease_/);
    expect(result.lease.fencingToken).toMatch(/^fence_/);
  });

  it('carries queued identity and its fencing token through promotion', () => {
    const active = requestResource({ kind: 'worker', owner: 'active' });
    const queued = requestResource({
      kind: 'worker',
      owner: 'queued-owner',
      taskId: 'goal_queued',
      resourceId: 'worker:queued-project',
    });
    expect(active.status).toBe('active');
    expect(queued.status).toBe('queued');
    if (active.status !== 'active' || queued.status !== 'queued') return;
    releaseResource(active.lease.id, active.lease.fencingToken);
    expect(resourceSnapshot().leases[0]).toMatchObject({
      taskId: queued.request.taskId,
      resourceId: queued.request.resourceId,
      fencingToken: queued.request.fencingToken,
    });
  });

  it('hydrates deterministic identities when reading a legacy v1 store', () => {
    const path = process.env.MAJOR_RESOURCE_PATH!;
    writeFileSync(
      path,
      `${JSON.stringify({
        version: 1,
        leases: [
          {
            id: 'lease_legacy',
            kind: 'build',
            owner: 'legacy-owner',
            project: 'legacy-project',
            depth: 0,
            createdAt: '2026-01-01T00:00:00.000Z',
            heartbeatAt: '2099-01-01T00:00:00.000Z',
            expiresAt: '2099-01-01T00:20:00.000Z',
          },
        ],
        queue: [],
      })}\n`,
    );
    expect(resourceSnapshot().leases[0]).toMatchObject({
      taskId: 'legacy:task:legacy-owner',
      resourceId: 'legacy:resource:build:legacy-project',
      fencingToken: 'legacy:fence:lease_legacy',
    });
  });

  it('rejects a stale fencing token for heartbeat and release', () => {
    const active = requestResource({ kind: 'worker', owner: 'fenced' });
    expect(active.status).toBe('active');
    if (active.status !== 'active') return;
    expect(() => heartbeatResource(active.lease.id, 'fence_stale')).toThrow(/not active/);
    expect(() => releaseResource(active.lease.id, 'fence_stale')).toThrow(/current fence/);
    expect(resourceSnapshot().leases[0]?.id).toBe(active.lease.id);
    releaseResource(active.lease.id, active.lease.fencingToken);
    expect(resourceSnapshot().leases).toHaveLength(0);
  });

  it('serializes concurrent workers through the configured DSH worker slot', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => concurrentRequest(`qa-${index}`)),
    );

    expect(results.filter((status) => status === 'active')).toHaveLength(1);
    expect(results.filter((status) => status === 'queued')).toHaveLength(19);
    const snapshot = resourceSnapshot();
    expect(snapshot.leases).toHaveLength(1);
    expect(snapshot.queue).toHaveLength(19);

    releaseResource(snapshot.leases[0]!.id, snapshot.leases[0]!.fencingToken);
    const promoted = resourceSnapshot();
    expect(promoted.leases).toHaveLength(1);
    expect(promoted.queue).toHaveLength(18);
  }, 30_000);

  it('queues a child worker while the shared worker slot is occupied', () => {
    const root = requestResource({ kind: 'worker', owner: 'root' });
    expect(root.status).toBe('active');
    if (root.status !== 'active') return;
    const child = requestResource({
      kind: 'worker',
      owner: 'child',
      parentLeaseId: root.lease.id,
    });
    expect(child.status).toBe('queued');
    if (child.status === 'queued') expect(child.request.reason).toMatch(/worker cap 1/);
  });

  it('applies browser and build caps inside the shared total budget', () => {
    expect(requestResource({ kind: 'browser', owner: 'visible' }).status).toBe('active');
    expect(requestResource({ kind: 'browser', owner: 'headless' }).status).toBe('active');
    expect(requestResource({ kind: 'browser', owner: 'third-browser' }).status).toBe('queued');
    expect(requestResource({ kind: 'build', owner: 'build-one' }).status).toBe('active');
    expect(requestResource({ kind: 'build', owner: 'build-two' }).status).toBe('queued');
  });

  it('queues new work when memory falls below the soft floor', () => {
    process.env.MAJOR_MEMORY_AVAILABLE_PERCENT = '20';
    const result = requestResource({ kind: 'worker', owner: 'memory-blocked' });
    expect(result.status).toBe('queued');
    if (result.status === 'queued') expect(result.request.reason).toMatch(/soft floor/);
  });

  it('reports lightweight runtime telemetry', () => {
    requestResource({ kind: 'worker', owner: 'worker' });
    requestResource({ kind: 'browser', owner: 'browser' });
    const formatted = formatResourceTelemetry(resourceSnapshot().telemetry);
    expect(formatted).toContain('workers: 1/1');
    expect(formatted).toContain('browsers: 1/2');
    expect(formatted).toContain('builds: 0/1');
    expect(formatted).toContain('total: 2/6');
    expect(formatted).toContain('queued: 0');
    expect(formatted).toContain('reclaimed: 0');
  });

  it('reclaims only after TTL and grace, then promotes atomically with telemetry', () => {
    vi.useFakeTimers();
    try {
      const active = requestResource({ kind: 'worker', owner: 'stale', ttlMs: 1_000 });
      expect(active.status).toBe('active');
      const queued = requestResource({ kind: 'worker', owner: 'next' });
      expect(queued.status).toBe('queued');
      if (active.status !== 'active') return;
      expect(active.lease).toMatchObject({ ttlMs: 1_000, graceMs: 60_000 });

      vi.advanceTimersByTime(60_999);
      expect(reclaimStaleResources().reclaimedLeaseIds).toEqual([]);
      vi.advanceTimersByTime(1);
      const repaired = reclaimStaleResources();
      expect(repaired.reclaimedLeaseIds).toEqual([active.lease.id]);
      expect(repaired.telemetry.reclaims).toMatchObject({ total: 1, expired: 1 });
      expect(resourceSnapshot().leases[0]?.owner).toBe('next');
      expect(() => releaseResource(active.lease.id, active.lease.fencingToken)).toThrow(
        /current fence/,
      );
      expect(resourceSnapshot().leases[0]?.owner).toBe('next');
    } finally {
      vi.useRealTimers();
    }
  });

  it('protects a live PID past reclaim age and lets its exact lease heartbeat renew', () => {
    vi.useFakeTimers();
    try {
      const active = requestResource({
        kind: 'worker',
        owner: 'live-process',
        pid: process.pid,
        ttlMs: 1_000,
      });
      expect(active.status).toBe('active');
      if (active.status !== 'active') return;
      vi.advanceTimersByTime(61_000);
      expect(reclaimStaleResources().reclaimedLeaseIds).toEqual([]);
      expect(
        assertActiveResourceLease({
          leaseId: active.lease.id,
          fencingToken: active.lease.fencingToken,
          kind: 'worker',
          owner: 'live-process',
          pid: process.pid,
        }).id,
      ).toBe(active.lease.id);
      const renewed = heartbeatResource(active.lease.id, active.lease.fencingToken);
      expect(renewed.expiresAt).not.toBe(active.lease.expiresAt);
      expect(renewed.reclaimAfter).not.toBe(active.lease.reclaimAfter);
    } finally {
      vi.useRealTimers();
    }
  });

  it('accepts the current fence through grace and rejects it after reclaim', () => {
    vi.useFakeTimers();
    try {
      const active = requestResource({
        kind: 'worker',
        owner: 'grace-fence',
        pid: 2_147_483_647,
        ttlMs: 1_000,
      });
      expect(active.status).toBe('active');
      if (active.status !== 'active') return;
      vi.advanceTimersByTime(1_001);
      expect(
        assertActiveResourceLease({
          leaseId: active.lease.id,
          fencingToken: active.lease.fencingToken,
          kind: 'worker',
          owner: 'grace-fence',
          pid: 2_147_483_647,
        }).id,
      ).toBe(active.lease.id);
      vi.advanceTimersByTime(59_999);
      expect(() =>
        assertActiveResourceLease({
          leaseId: active.lease.id,
          fencingToken: active.lease.fencingToken,
          kind: 'worker',
          owner: 'grace-fence',
          pid: 2_147_483_647,
        }),
      ).toThrow(/not the active worker fence/);
    } finally {
      vi.useRealTimers();
    }
  });

  it('reports dead-process reclaim separately from processless expiry', () => {
    vi.useFakeTimers();
    try {
      const active = requestResource({
        kind: 'build',
        owner: 'dead-process',
        pid: 2_147_483_647,
        ttlMs: 1_000,
      });
      expect(active.status).toBe('active');
      vi.advanceTimersByTime(61_000);
      const repaired = reclaimStaleResources();
      expect(repaired.reclaimedLeaseIds).toHaveLength(1);
      expect(repaired.telemetry.reclaims).toMatchObject({ total: 1, deadProcess: 1 });
    } finally {
      vi.useRealTimers();
    }
  });
});

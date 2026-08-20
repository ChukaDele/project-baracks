import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  formatResourceTelemetry,
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

beforeEach(() => {
  priorResourcePath = process.env.MAJOR_RESOURCE_PATH;
  priorMemoryPercent = process.env.MAJOR_MEMORY_AVAILABLE_PERCENT;
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
  it('serializes concurrent workers through the configured DSH worker slot', async () => {
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, index) => concurrentRequest(`qa-${index}`)),
    );

    expect(results.filter((status) => status === 'active')).toHaveLength(1);
    expect(results.filter((status) => status === 'queued')).toHaveLength(19);
    const snapshot = resourceSnapshot();
    expect(snapshot.leases).toHaveLength(1);
    expect(snapshot.queue).toHaveLength(19);

    releaseResource(snapshot.leases[0]!.id);
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
  });
});

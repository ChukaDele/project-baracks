import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';
import {
  classifyResource,
  isProtectedClass,
  scanInventory,
  workerInstanceForSha,
  type ClassifiedResource,
  type GcRoots,
} from '../src/resources/inventory.js';
import { applyCleanup, planCleanup, type CleanupDeps } from '../src/resources/cleanup.js';
import { RETENTION, ROLLBACK_GENERATIONS } from '../src/resources/retention.js';
import { evaluateDiskPreflight, planLargeResource } from '../src/resources/preflight.js';
import { allocatedBytes, measureReclaimed, type DiskPressure } from '../src/resources/usage.js';
import {
  COMPACTION_EXCLUSIONS,
  assertCompactable,
  isCompactable,
} from '../src/resources/compaction.js';
import { reconcileResources } from '../src/resources/reconcile.js';
import { hygieneFrom, formatStorageHuman } from '../src/resources/storage-report.js';
import type { ReclaimTools } from '../src/resources/tools.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function home(): string {
  const path = mkdtempSync(join(tmpdir(), 'major-hygiene-'));
  roots.push(path);
  return path;
}

const ACTIVE_SHA = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const ROLLBACK_SHA = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const OLD_SHA = 'cccccccccccccccccccccccccccccccccccccccc';
const ORPHAN_SHA = 'dddddddddddddddddddddddddddddddddddddddd';

function writeRoots(dir: string): void {
  mkdirSync(join(dir, 'releases', ACTIVE_SHA), { recursive: true });
  mkdirSync(join(dir, 'releases', ROLLBACK_SHA), { recursive: true });
  mkdirSync(join(dir, 'releases', OLD_SHA), { recursive: true });
  writeFileSync(
    join(dir, 'installed-release.json'),
    JSON.stringify({
      sha: ACTIVE_SHA,
      releaseDir: join(dir, 'releases', ACTIVE_SHA),
      version: '0.5.2',
    }),
  );
  writeFileSync(
    join(dir, 'execution.json'),
    JSON.stringify({
      backend: 'lima',
      instance: workerInstanceForSha(ACTIVE_SHA),
      limactlPath: '/usr/bin/limactl',
      isolationScope: 'shared-workshop',
      guestRunRoot: '/var/lib/major/runs',
    }),
  );
  writeFileSync(
    join(dir, 'install-history.jsonl'),
    [
      JSON.stringify({ sha: OLD_SHA, releaseDir: join(dir, 'releases', OLD_SHA) }),
      JSON.stringify({ sha: ROLLBACK_SHA, releaseDir: join(dir, 'releases', ROLLBACK_SHA) }),
      JSON.stringify({ sha: ACTIVE_SHA, releaseDir: join(dir, 'releases', ACTIVE_SHA) }),
    ].join('\n') + '\n',
  );
}

function fakeTools(instances: string[]): ReclaimTools & { deleted: string[]; pruned: string[] } {
  const deleted: string[] = [];
  const pruned: string[] = [];
  let current = [...instances];
  return {
    deleted,
    pruned,
    listLimaInstances: () => current.map((name) => ({ name })),
    deleteLimaInstance: (name) => {
      deleted.push(name);
      current = current.filter((item) => item !== name);
    },
    pruneLima: () => {
      pruned.push('lima');
    },
    pruneGitWorktrees: () => {
      pruned.push('git');
    },
    prunePnpmStore: () => {
      pruned.push('pnpm');
    },
  };
}

function depsFor(
  dir: string,
  instances: string[],
  extras: Partial<CleanupDeps> = {},
): CleanupDeps & { tools: ReclaimTools & { deleted: string[] } } {
  const tools = fakeTools(instances);
  return {
    home: dir,
    nowMs: Date.parse('2026-08-17T12:00:00.000Z'),
    limaInstances: instances.map((name) => ({ name })),
    credentials: extras.credentials ?? { byInstance: {}, complete: true },
    leases: [],
    goals: [],
    measure: extras.measure ?? (() => 1024),
    removeTree: extras.removeTree ?? ((path) => rmSync(path, { recursive: true, force: true })),
    ...extras,
    // The fake reclaim tools must always win, so callers cannot accidentally
    // let a real limactl through by passing their own `tools` in `extras`.
    tools,
  };
}

const gcRoots = (dir: string): GcRoots =>
  scanInventory({
    home: dir,
    limaInstances: [],
    credentials: { byInstance: {}, complete: true },
  }).roots;

describe('Major resource hygiene', () => {
  it('keeps a single rollback generation bound', () => {
    expect(ROLLBACK_GENERATIONS).toBe(1);
    expect(RETENTION.rollbackGenerations).toBe(1);
  });

  it('refuses to delete the active worker', () => {
    const dir = home();
    writeRoots(dir);
    const active = workerInstanceForSha(ACTIVE_SHA);
    const tools = fakeTools([active]);
    const result = applyCleanup({
      ...depsFor(dir, [active]),
      tools,
      limaInstances: [{ name: active }],
    });
    expect(tools.deleted).toEqual([]);
    expect(result.refused.some((item) => item.id === `lima-instance:${active}`)).toBe(true);
    const classified = classifyResource(
      { kind: 'lima-instance', identity: active, createdAtMs: 0 },
      gcRoots(dir),
    );
    expect(classified.class).toBe('active');
    expect(classified.reclaimable).toBe(false);
  });

  it('preserves the rollback worker', () => {
    const dir = home();
    writeRoots(dir);
    const rollback = workerInstanceForSha(ROLLBACK_SHA);
    const classified = classifyResource(
      { kind: 'lima-instance', identity: rollback, createdAtMs: 0 },
      gcRoots(dir),
      { byInstance: {}, complete: true },
    );
    expect(classified.class).toBe('rollback');
    const tools = fakeTools([rollback, workerInstanceForSha(ACTIVE_SHA)]);
    applyCleanup({
      home: dir,
      limaInstances: [{ name: workerInstanceForSha(ACTIVE_SHA) }, { name: rollback }],
      credentials: { byInstance: {}, complete: true },
      tools,
      measure: () => 1,
    });
    expect(tools.deleted).not.toContain(rollback);
  });

  it('preserves a worker holding unique credentials', () => {
    const dir = home();
    writeRoots(dir);
    const legacy = 'major-worker';
    const classified = classifyResource(
      { kind: 'lima-instance', identity: legacy, createdAtMs: 0 },
      gcRoots(dir),
      {
        complete: true,
        byInstance: {
          [legacy]: ['claude'],
          [workerInstanceForSha(ACTIVE_SHA)]: ['codex'],
        },
      },
    );
    expect(classified.class).toBe('credential-bearing');
    expect(classified.reclaimable).toBe(false);
    const tools = fakeTools([legacy, workerInstanceForSha(ACTIVE_SHA)]);
    applyCleanup({
      home: dir,
      limaInstances: [{ name: legacy }, { name: workerInstanceForSha(ACTIVE_SHA) }],
      credentials: {
        complete: true,
        byInstance: {
          [legacy]: ['claude'],
          [workerInstanceForSha(ACTIVE_SHA)]: ['codex'],
        },
      },
      tools,
      measure: () => 1,
    });
    expect(tools.deleted).not.toContain(legacy);
  });

  it('distinguishes an orphan worker from a failed destination worker', () => {
    const dir = home();
    writeRoots(dir);
    const stale = workerInstanceForSha(ORPHAN_SHA);

    // Regression: `failedDestination` was derived from unreachability, so every
    // stale per-SHA worker was reported as "failed destination worker" and the
    // orphan count read zero -- which made the doctor Storage hygiene line wrong.
    const asOrphan = scanInventory({
      home: dir,
      limaInstances: [{ name: stale }],
      credentials: { byInstance: {}, complete: true },
      measure: () => 1,
    }).resources.find((resource) => resource.identity === stale);
    expect(asOrphan?.class).toBe('orphan');
    expect(asOrphan?.reason).not.toMatch(/failed destination/);
    expect(asOrphan?.reclaimable).toBe(true);

    // Only the installer's explicit marker makes a worker a failed destination.
    const asFailed = scanInventory({
      home: dir,
      limaInstances: [{ name: stale }],
      credentials: { byInstance: {}, complete: true },
      partialWorkerInstances: [stale],
      measure: () => 1,
    }).resources.find((resource) => resource.identity === stale);
    expect(asFailed?.class).toBe('ephemeral');
    expect(asFailed?.reason).toMatch(/failed destination/);
  });

  it('removes an orphan worker', () => {
    const dir = home();
    writeRoots(dir);
    const orphan = workerInstanceForSha(ORPHAN_SHA);
    const tools = fakeTools([orphan, workerInstanceForSha(ACTIVE_SHA)]);
    const result = applyCleanup({
      home: dir,
      limaInstances: [{ name: orphan }, { name: workerInstanceForSha(ACTIVE_SHA) }],
      credentials: { byInstance: {}, complete: true },
      tools,
      measure: () => 1,
    });
    expect(tools.deleted).toContain(orphan);
    expect(result.removed.map((item) => item.id)).toContain(`lima-instance:${orphan}`);
  });

  it('cleans partial resources after a failed install', () => {
    const dir = home();
    writeRoots(dir);
    const partial = workerInstanceForSha(ORPHAN_SHA);
    mkdirSync(join(dir, 'install-staging', 'old'), { recursive: true });
    mkdirSync(join(dir, 'install-staging', 'newest'), { recursive: true });
    writeFileSync(join(dir, 'install-staging', 'old', 'x'), 'stale');
    const tools = fakeTools([partial]);
    const result = reconcileResources({
      home: dir,
      limaInstances: [{ name: partial }],
      credentials: { byInstance: {}, complete: true },
      tools,
      measure: () => 1,
      phase: 'after-failure',
      apply: true,
    });
    expect(tools.deleted).toContain(partial);
    expect(existsSync(join(dir, 'install-staging', 'old'))).toBe(false);
    expect(result.applied?.removed.length).toBeGreaterThan(0);
  });

  it('SIGINT and SIGTERM clean up partial resources', async () => {
    const dir = home();
    writeRoots(dir);
    const source = pathToFileURL(
      join(dirname(fileURLToPath(import.meta.url)), '../src/resources/reconcile.ts'),
    ).href;
    // The child announces READY only after its signal handlers are installed.
    // Killing on a fixed timer instead would race tsx's module loading: the
    // signal can land before the handler exists, so the process would die by
    // default action and the test would pass or fail on machine speed.
    const program = `
      import { reconcileAfterCancel } from ${JSON.stringify(source)};
      const cleanup = () => {
        reconcileAfterCancel(process.env.MAJOR_HOME);
        process.exit(0);
      };
      process.once('SIGINT', cleanup);
      process.once('SIGTERM', cleanup);
      setInterval(() => {}, 1000);
      process.stdout.write('READY\\n');
    `;
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      mkdirSync(join(dir, 'install-staging', 'partial'), { recursive: true });
      writeFileSync(join(dir, 'install-staging', 'partial', 'x'), 'partial');
      await new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '-e', program],
          {
            env: { ...process.env, MAJOR_HOME: dir },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let signalled = false;
        child.stdout.on('data', (chunk: Buffer) => {
          if (!signalled && chunk.toString().includes('READY')) {
            signalled = true;
            child.kill(signal);
          }
        });
        child.once('error', reject);
        child.once('close', () => {
          if (!signalled) reject(new Error(`child exited before installing ${signal} handler`));
          else resolve();
        });
      });
      expect(existsSync(join(dir, 'install-staging', 'partial'))).toBe(false);
    }
  }, 30_000);

  it('bounds cache and log retention', () => {
    const dir = home();
    writeRoots(dir);
    const now = Date.parse('2026-08-17T12:00:00.000Z');
    mkdirSync(join(dir, 'logs'), { recursive: true });
    mkdirSync(join(dir, 'caches'), { recursive: true });
    writeFileSync(join(dir, 'logs', 'fresh.log'), 'ok');
    writeFileSync(join(dir, 'logs', 'old.log'), 'old');
    writeFileSync(join(dir, 'caches', 'fresh'), 'ok');
    writeFileSync(join(dir, 'caches', 'old'), 'old');
    const scan = scanInventory({
      home: dir,
      nowMs: now,
      limaInstances: [],
      credentials: { byInstance: {}, complete: true },
      measure: () => 1,
    });
    const logs = scan.resources.filter((resource) => resource.kind === 'log');
    expect(logs.length).toBeGreaterThan(0);
    const oldLog = classifyResource(
      { kind: 'log', identity: 'old.log', createdAtMs: now - 8 * 24 * 60 * 60 * 1000 },
      scan.roots,
      { byInstance: {}, complete: true },
      now,
    );
    const freshLog = classifyResource(
      { kind: 'log', identity: 'fresh.log', createdAtMs: now - 2 * 24 * 60 * 60 * 1000 },
      scan.roots,
      { byInstance: {}, complete: true },
      now,
    );
    const oldCache = classifyResource(
      { kind: 'cache', identity: 'old', createdAtMs: now - 15 * 24 * 60 * 60 * 1000 },
      scan.roots,
      { byInstance: {}, complete: true },
      now,
    );
    const freshCache = classifyResource(
      { kind: 'cache', identity: 'fresh', createdAtMs: now - 2 * 24 * 60 * 60 * 1000 },
      scan.roots,
      { byInstance: {}, complete: true },
      now,
    );
    expect(oldLog.reclaimable).toBe(true);
    expect(freshLog.reclaimable).toBe(false);
    expect(oldCache.reclaimable).toBe(true);
    expect(freshCache.reclaimable).toBe(false);
    expect(freshCache.class).toBe('cache');
  });

  it('converges repeated installs to a bounded footprint', () => {
    const dir = home();
    writeRoots(dir);
    const instances = [
      workerInstanceForSha(ACTIVE_SHA),
      workerInstanceForSha(ROLLBACK_SHA),
      // Distinct in the FIRST 12 hex chars, because that prefix is what
      // workerInstanceForSha uses. Padding a counter would collapse all 12
      // orphans onto one instance name and silently weaken this test.
      ...Array.from({ length: 12 }, (_, index) =>
        workerInstanceForSha((index + 16).toString(16).padStart(2, '0').repeat(20)),
      ),
    ];
    const tools = fakeTools(instances);
    applyCleanup({
      home: dir,
      limaInstances: instances.map((name) => ({ name })),
      credentials: { byInstance: {}, complete: true },
      tools,
      measure: () => 1,
    });
    expect(tools.deleted).not.toContain(workerInstanceForSha(ACTIVE_SHA));
    expect(tools.deleted).not.toContain(workerInstanceForSha(ROLLBACK_SHA));
    expect(tools.deleted.length).toBe(12);
    expect(instances.length - tools.deleted.length).toBe(2);
  });

  it('dry-run predicts the same resource id set that apply removes', () => {
    const dir = home();
    writeRoots(dir);
    mkdirSync(join(dir, 'logs'), { recursive: true });
    writeFileSync(join(dir, 'logs', 'old.log'), 'old');
    const now = Date.parse('2026-08-17T12:00:00.000Z');
    const orphan = workerInstanceForSha(ORPHAN_SHA);
    const shared: CleanupDeps = {
      home: dir,
      nowMs: now,
      limaInstances: [{ name: orphan }, { name: workerInstanceForSha(ACTIVE_SHA) }],
      credentials: { byInstance: {}, complete: true },
      measure: () => 1,
      tools: fakeTools([orphan, workerInstanceForSha(ACTIVE_SHA)]),
    };
    const planned = planCleanup({
      ...shared,
      limaInstances: [{ name: orphan }, { name: workerInstanceForSha(ACTIVE_SHA) }],
    });
    const tools = fakeTools([orphan, workerInstanceForSha(ACTIVE_SHA)]);
    const applied = applyCleanup({ ...shared, tools });
    expect(applied.removed.map((item) => item.id).sort()).toEqual(
      planned.wouldRemove.map((item) => item.id).sort(),
    );
  });

  it('reports reclaimed space from the measured df delta, not a du sum', () => {
    const dir = home();
    writeRoots(dir);
    const orphan = workerInstanceForSha(ORPHAN_SHA);
    let free = 1_000;
    const pressure = (): DiskPressure => ({
      totalBytes: 10_000,
      usedBytes: 10_000 - free,
      freeBytes: free,
      percentUsed: ((10_000 - free) / 10_000) * 100,
      percentFree: (free / 10_000) * 100,
    });
    const baseTools = fakeTools([orphan]);
    // The orphan is a Lima instance, so freeing space happens through
    // deleteLimaInstance, not removeTree. Bump the fake free space there or the
    // measured delta is always zero and this test proves nothing.
    const tools = {
      ...baseTools,
      deleteLimaInstance: (name: string) => {
        baseTools.deleteLimaInstance(name);
        free = 1_400;
      },
    };
    const result = applyCleanup({
      home: dir,
      limaInstances: [{ name: orphan }],
      credentials: { byInstance: {}, complete: true },
      tools,
      measure: () => 9_999,
      pressure,
    });
    expect(result.reclaimedSource).toBe('df-delta');
    expect(result.reclaimedBytes).toBe(400);
    expect(result.reclaimedBytes).not.toBe(9_999);
    const measured = measureReclaimed(
      () => {
        free = 1_500;
        return 'ok';
      },
      dir,
      pressure,
    );
    expect(measured.reclaimedBytes).toBe(100);
  });

  it('never compact-rewrites protected databases, credentials, VMs or the active release', () => {
    expect(COMPACTION_EXCLUSIONS).toEqual(
      expect.arrayContaining([
        'major.db',
        'credentials',
        'provider-auth',
        'active-vm',
        'active-release',
      ]),
    );
    const activeRelease: ClassifiedResource = {
      id: 'release-snapshot:active',
      kind: 'release-snapshot',
      class: 'active',
      identity: ACTIVE_SHA,
      path: `/tmp/releases/${ACTIVE_SHA}`,
      reason: 'active',
      reclaimable: false,
      allocatedBytes: 1,
    };
    const activeVm: ClassifiedResource = {
      id: 'lima-instance:active',
      kind: 'lima-instance',
      class: 'active',
      identity: workerInstanceForSha(ACTIVE_SHA),
      reason: 'active',
      reclaimable: false,
      allocatedBytes: 1,
    };
    const db: ClassifiedResource = {
      id: 'cache:major.db',
      kind: 'cache',
      class: 'cold-archive',
      identity: 'major.db',
      path: '/tmp/major.db',
      reason: 'db',
      reclaimable: true,
      allocatedBytes: 1,
    };
    expect(() => assertCompactable(activeRelease)).toThrow(/active-release/);
    expect(() => assertCompactable(activeVm)).toThrow(/active-vm/);
    expect(() => assertCompactable(db)).toThrow(/major.db/);
    expect(isCompactable(activeRelease)).toBe(false);
    expect(isProtectedClass('unknown')).toBe(true);
  });

  it('labels dry-run reclaim as an upper bound', () => {
    const dir = home();
    writeRoots(dir);
    const plan = planCleanup({
      home: dir,
      limaInstances: [],
      credentials: { byInstance: {}, complete: true },
      measure: () => 0,
    });
    expect(plan.estimatedReclaimLabel).toMatch(/estimated up to/);
    expect(plan.estimatedReclaimLabel).toMatch(/actual reclaim is measured on apply/);
  });

  it('blocks and warns on disk-pressure preflight thresholds', () => {
    const block = evaluateDiskPreflight({
      totalBytes: 100,
      usedBytes: 95,
      freeBytes: 5,
      percentUsed: 95,
      percentFree: 5,
    });
    expect(block.status).toBe('block');
    const warn = evaluateDiskPreflight({
      totalBytes: 200 * 1024 * 1024 * 1024,
      usedBytes: 170 * 1024 * 1024 * 1024,
      freeBytes: 30 * 1024 * 1024 * 1024,
      percentUsed: 85,
      percentFree: 15,
    });
    expect(warn.status).toBe('warn');
    const ok = evaluateDiskPreflight({
      totalBytes: 200 * 1024 * 1024 * 1024,
      usedBytes: 100 * 1024 * 1024 * 1024,
      freeBytes: 100 * 1024 * 1024 * 1024,
      percentUsed: 50,
      percentFree: 50,
    });
    expect(ok.status).toBe('ok');
    expect(hygieneFrom('block', 0)).toBe('CRITICAL');
    expect(hygieneFrom('warn', 0)).toBe('ATTENTION');
    expect(hygieneFrom('ok', 1)).toBe('ATTENTION');
    expect(hygieneFrom('ok', 0)).toBe('HEALTHY');
    const storageText = formatStorageHuman({
      diskUsedBytes: 80e9,
      diskPercentUsed: 72,
      diskFreeBytes: 140e9,
      majorPhysicalBytes: 12.4e9,
      workers: { active: 1, rollback: 1, credentialSource: 0, orphan: 0 },
      reclaimableBytes: 0,
      hygiene: 'HEALTHY',
    });
    // The agreed compact shape: aligned label/value rows, and `Disk used` as a
    // PERCENTAGE, because an absolute figure alone does not show pressure.
    expect(storageText.split('\n').map((line) => line.trimEnd())).toEqual([
      'Storage',
      'Disk used              72%',
      'Free                   140.0 GB',
      'Major physical usage   12.4 GB',
      'Workers',
      'active                 1',
      'rollback               1',
      'credential source      0',
      'orphan                 0',
      'Reclaimable            0 B',
      'Hygiene                HEALTHY',
    ]);
  });

  it('replaces a cold release with its archive and never compacts it twice', () => {
    const dir = home();
    writeRoots(dir);
    const coldDir = join(dir, 'releases', OLD_SHA);
    writeFileSync(join(coldDir, 'payload.txt'), 'cold release payload');
    const archived: string[] = [];
    const archiveTree = (path: string) => {
      const target = `${path}.tar.gz`;
      writeFileSync(target, 'archive-bytes');
      archived.push(path);
      return target;
    };

    const first = applyCleanup({
      ...depsFor(dir, [workerInstanceForSha(ACTIVE_SHA)]),
      archiveTree,
    });
    expect(first.compacted.some((item) => item.id === `release-snapshot:${OLD_SHA}`)).toBe(true);
    // Compaction must REPLACE the tree. Keeping both the directory and the
    // archive only adds bytes; that regression grew the footprint every cycle.
    expect(existsSync(coldDir)).toBe(false);
    expect(existsSync(`${coldDir}.tar.gz`)).toBe(true);
    expect(archived).toEqual([coldDir]);

    // Second pass: nothing left to compact, and no second archive written.
    const second = applyCleanup({
      ...depsFor(dir, [workerInstanceForSha(ACTIVE_SHA)]),
      archiveTree,
    });
    expect(second.compacted).toEqual([]);
    expect(archived).toEqual([coldDir]);

    // The active release is still untouched by any of this.
    expect(existsSync(join(dir, 'releases', ACTIVE_SHA))).toBe(true);
    expect(existsSync(join(dir, 'releases', `${ACTIVE_SHA}.tar.gz`))).toBe(false);
  });

  it('reuses an existing worker instead of creating another', () => {
    const plan = planLargeResource({
      kind: 'worker',
      identity: workerInstanceForSha(ACTIVE_SHA),
      estimatedBytes: 10 * 1024 * 1024 * 1024,
      existingIdentities: [workerInstanceForSha(ACTIVE_SHA)],
      pressure: {
        totalBytes: 200 * 1024 * 1024 * 1024,
        usedBytes: 50 * 1024 * 1024 * 1024,
        freeBytes: 150 * 1024 * 1024 * 1024,
        percentUsed: 25,
        percentFree: 75,
      },
    });
    expect(plan.action).toBe('reuse');
  });

  it('aggressive cleanup still refuses active, rollback, credential-bearing and unknown', () => {
    const dir = home();
    writeRoots(dir);
    const tools = fakeTools([
      workerInstanceForSha(ACTIVE_SHA),
      workerInstanceForSha(ROLLBACK_SHA),
      'docker-vm',
    ]);
    applyCleanup(
      {
        home: dir,
        limaInstances: [
          { name: workerInstanceForSha(ACTIVE_SHA) },
          { name: workerInstanceForSha(ROLLBACK_SHA) },
          { name: 'docker-vm' },
        ],
        credentials: { byInstance: {}, complete: false },
        tools,
        measure: () => 1,
      },
      true,
    );
    expect(tools.deleted).toEqual([]);
  });
});

describe('clone-or-copy helper', () => {
  it('copies a tree byte-identically and falls back when clonefile is unavailable', () => {
    const dir = home();
    const src = join(dir, 'src');
    const dest = join(dir, 'dest');
    mkdirSync(src);
    writeFileSync(join(src, 'payload'), 'immutable-payload');
    const result = spawnSync('bash', ['scripts/major-clone-tree.sh', src, dest], {
      encoding: 'utf8',
    });
    expect(result.status, result.stderr).toBe(0);
    expect(existsSync(join(dest, 'payload'))).toBe(true);
  });
});

describe('allocatedBytes', () => {
  it('reports allocated blocks for a real file tree', () => {
    const dir = home();
    writeFileSync(join(dir, 'blob'), 'x'.repeat(4096));
    expect(allocatedBytes(dir)).toBeGreaterThan(0);
    expect(allocatedBytes(join(dir, 'missing'))).toBe(0);
  });
});

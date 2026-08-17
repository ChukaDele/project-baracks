import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { majorHome } from '../supervisor/state.js';
import { evaluateDiskPreflight, type PreflightStatus } from './preflight.js';
import { planCleanup } from './cleanup.js';
import { productionCleanupDeps } from './reconcile.js';
import { allocatedBytes, clearUsageCache, diskPressure, formatBytes } from './usage.js';
import type { ResourceClass } from './inventory.js';

export type HygieneStatus = 'HEALTHY' | 'ATTENTION' | 'CRITICAL';

export interface StorageReport {
  diskUsedBytes: number;
  diskPercentUsed: number;
  diskFreeBytes: number;
  majorPhysicalBytes: number;
  workers: {
    active: number;
    rollback: number;
    credentialSource: number;
    orphan: number;
  };
  reclaimableBytes: number;
  hygiene: HygieneStatus;
}

function countClass(
  resources: { kind: string; class: ResourceClass }[],
  kind: string,
  value: ResourceClass,
): number {
  return resources.filter((resource) => resource.kind === kind && resource.class === value).length;
}

export function hygieneFrom(preflight: PreflightStatus, orphanCount: number): HygieneStatus {
  if (preflight === 'block') return 'CRITICAL';
  if (preflight === 'warn' || orphanCount > 0) return 'ATTENTION';
  return 'HEALTHY';
}

/**
 * Major's own footprint is `~/.major` PLUS the Lima instances Major created.
 * Excluding the workers under-reports the real cost by an order of magnitude
 * (measured 3.6 GB vs 33 GB on a live machine), and the worker images are only
 * a handful of sparse files, so adding them costs single-digit milliseconds.
 */
function majorPhysicalUsage(home: string, workerPaths: string[]): number {
  return workerPaths.reduce((total, path) => total + allocatedBytes(path), allocatedBytes(home));
}

export function buildStorageReport(home = majorHome()): StorageReport {
  // Start from a clean memo so the report reflects the tree as it is now, then
  // let the inventory and the total share one walk instead of two.
  clearUsageCache();
  const pressure = diskPressure(home);
  const plan = planCleanup(productionCleanupDeps(home));
  const workers = plan.inventory.filter((resource) => resource.kind === 'lima-instance');
  const orphanCount = plan.inventory.filter((resource) => resource.class === 'orphan').length;
  const preflight = evaluateDiskPreflight(pressure);
  const hasRelease = existsSync(join(home, 'installed-release.json'));
  return {
    diskUsedBytes: pressure.usedBytes,
    diskPercentUsed: pressure.percentUsed,
    diskFreeBytes: pressure.freeBytes,
    majorPhysicalBytes: hasRelease
      ? majorPhysicalUsage(
          home,
          workers.map((worker) => worker.path).filter((path): path is string => Boolean(path)),
        )
      : 0,
    workers: {
      active: countClass(workers, 'lima-instance', 'active'),
      rollback: countClass(workers, 'lima-instance', 'rollback'),
      credentialSource: countClass(workers, 'lima-instance', 'credential-bearing'),
      orphan: countClass(workers, 'lima-instance', 'orphan'),
    },
    reclaimableBytes: plan.estimatedReclaimBytes,
    hygiene: hygieneFrom(preflight.status, orphanCount),
  };
}

/** Compact, aligned Storage section. `Disk used` is a percentage: an absolute
 * figure alone does not say whether the volume is under pressure. */
export function formatStorageHuman(report: StorageReport): string {
  const row = (label: string, value: string) => `${label.padEnd(22)} ${value}`;
  return [
    'Storage',
    row('Disk used', `${Math.round(report.diskPercentUsed)}%`),
    row('Free', formatBytes(report.diskFreeBytes)),
    row('Major physical usage', formatBytes(report.majorPhysicalBytes)),
    'Workers',
    row('active', String(report.workers.active)),
    row('rollback', String(report.workers.rollback)),
    row('credential source', String(report.workers.credentialSource)),
    row('orphan', String(report.workers.orphan)),
    row('Reclaimable', formatBytes(report.reclaimableBytes)),
    row('Hygiene', report.hygiene),
  ].join('\n');
}

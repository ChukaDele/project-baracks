import { existsSync, lstatSync, readdirSync, realpathSync, statfsSync, type Stats } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

/** Unix st_blocks unit. Node reports allocated blocks in 512-byte units. */
const BLOCK_BYTES = 512;

export interface DiskPressure {
  totalBytes: number;
  usedBytes: number;
  freeBytes: number;
  percentUsed: number;
  percentFree: number;
}

/**
 * Sum of allocated blocks under `path`.
 *
 * This is an UPPER BOUND of physical usage: APFS clonefile / shared extents
 * make the same blocks visible from multiple trees, so two cloned copies can
 * each report their full logical size here while `df` shows ~0 additional
 * used space. Never present this sum as actual reclaimed space.
 */
export function allocatedBytes(path: string): number {
  const root = resolve(path);
  if (!existsSync(root)) return 0;
  const cached = directorySizeCache.get(root);
  if (cached !== undefined) return cached;
  return walkAllocated(root, new Set<string>());
}

/**
 * Per-process memo of measured directory subtrees.
 *
 * A single `major doctor` needs both per-resource sizes and a total for
 * `~/.major`; without this memo it walks the same ~100k files twice, which
 * measured 0.5s -> 3.95s on a live machine. Sizes are only valid until
 * something is removed, so every mutating path calls `clearUsageCache()`.
 */
const directorySizeCache = new Map<string, number>();

export function clearUsageCache(): void {
  directorySizeCache.clear();
}

function walkAllocated(path: string, seenInodes: Set<string>): number {
  let stats: Stats;
  try {
    stats = lstatSync(path);
  } catch {
    return 0;
  }
  if (stats.isSymbolicLink()) return (stats.blocks ?? 0) * BLOCK_BYTES;
  const inodeKey = `${stats.dev}:${stats.ino}`;
  if (seenInodes.has(inodeKey)) return 0;
  seenInodes.add(inodeKey);
  let total = (stats.blocks ?? 0) * BLOCK_BYTES;
  if (!stats.isDirectory()) return total;
  // Reuse a subtree measured earlier in this process (e.g. the inventory
  // measured `releases/<sha>` and we are now totalling all of `~/.major`).
  // A reused subtree does not contribute its inodes to `seenInodes`, so a file
  // hardlinked both inside and outside it can be counted twice -- an
  // over-count in a figure that is already documented as an upper bound.
  const cached = directorySizeCache.get(path);
  if (cached !== undefined) return cached;
  let entries: string[] = [];
  try {
    entries = readdirSync(path);
  } catch {
    return total;
  }
  for (const name of entries) {
    total += walkAllocated(join(path, name), seenInodes);
  }
  directorySizeCache.set(path, total);
  return total;
}

/** Disk pressure on the data volume that contains `path` (defaults to the home volume). */
export function diskPressure(path: string = homedir()): DiskPressure {
  const target = existsSync(path) ? path : homedir();
  const fs = statfsSync(target);
  const blockSize = Number(fs.bsize);
  const totalBytes = Number(fs.blocks) * blockSize;
  const freeBytes = Number(fs.bavail) * blockSize;
  const usedBytes = Math.max(0, totalBytes - Number(fs.bfree) * blockSize);
  const percentUsed = totalBytes === 0 ? 0 : (usedBytes / totalBytes) * 100;
  const percentFree = totalBytes === 0 ? 0 : (freeBytes / totalBytes) * 100;
  return { totalBytes, usedBytes, freeBytes, percentUsed, percentFree };
}

export interface ReclaimedMeasurement<T> {
  result: T;
  reclaimedBytes: number;
}

/**
 * Capture free bytes before and after `fn` and return the MEASURED delta.
 * Apply-path reclaim MUST come from this helper, never from summing allocatedBytes.
 */
export function measureReclaimed<T>(
  fn: () => T,
  volumePath?: string,
  pressure: (path?: string) => DiskPressure = diskPressure,
): ReclaimedMeasurement<T> {
  const before = pressure(volumePath).freeBytes;
  const result = fn();
  const after = pressure(volumePath).freeBytes;
  return { result, reclaimedBytes: Math.max(0, after - before) };
}

export function formatBytes(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= 1e12) return `${(bytes / 1e12).toFixed(1)} TB`;
  if (abs >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (abs >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (abs >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

/** Canonical data-volume path for Major's home, following one symlink hop when present. */
export function volumePathFor(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

/**
 * Single source of truth for Major resource retention windows.
 * Every cleanup, reconcile and doctor path must read from this object.
 */
export const ROLLBACK_GENERATIONS = 1;

export const RETENTION = {
  rollbackGenerations: ROLLBACK_GENERATIONS,
  executionRuns: {
    keepNewest: 10,
    maxAgeMs: 48 * 60 * 60 * 1000,
  },
  logs: { maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
  caches: { maxAgeMs: 14 * 24 * 60 * 60 * 1000 },
  tempWorktrees: { maxAgeMs: 7 * 24 * 60 * 60 * 1000 },
  installStaging: { keepNewest: 1, removeOnSuccess: true },
  stagedValidation: { keepNewest: 1 },
  stagedReleases: { keepNewest: 1 },
  testWorkers: { maxAgeMs: 0 },
  provisionalCapabilities: { maxAgeMs: 24 * 60 * 60 * 1000 },
  diagnosticArtifacts: { maxAgeMs: 14 * 24 * 60 * 60 * 1000 },
  failedDestinationWorkers: { maxAgeMs: 0 },
} as const;

export type RetentionPolicy = typeof RETENTION;

export const retentionPolicy: RetentionPolicy = RETENTION;

export function withinAgeWindow(createdAtMs: number, maxAgeMs: number, nowMs: number): boolean {
  if (maxAgeMs <= 0) return false;
  return nowMs - createdAtMs < maxAgeMs;
}

/** True when this item is one of the newest `keepNewest` by recency (index 0 = newest). */
export function withinNewestWindow(newestIndex: number, keepNewest: number): boolean {
  return newestIndex >= 0 && newestIndex < keepNewest;
}

import { diskPressure, formatBytes, type DiskPressure } from './usage.js';

export const PREFLIGHT_BLOCK_PERCENT_FREE = 10;
export const PREFLIGHT_BLOCK_FREE_BYTES = 20 * 1024 * 1024 * 1024;
export const PREFLIGHT_WARN_PERCENT_FREE = 20;
export const PREFLIGHT_WARN_FREE_BYTES = 40 * 1024 * 1024 * 1024;

export type PreflightStatus = 'ok' | 'warn' | 'block';

export interface PreflightResult {
  status: PreflightStatus;
  reason: string;
  pressure: DiskPressure;
}

export function evaluateDiskPreflight(pressure: DiskPressure = diskPressure()): PreflightResult {
  if (
    pressure.percentFree < PREFLIGHT_BLOCK_PERCENT_FREE ||
    pressure.freeBytes < PREFLIGHT_BLOCK_FREE_BYTES
  ) {
    return {
      status: 'block',
      reason:
        `disk preflight blocked: ${pressure.percentFree.toFixed(1)}% free ` +
        `(${formatBytes(pressure.freeBytes)}); need at least ` +
        `${PREFLIGHT_BLOCK_PERCENT_FREE}% free ` +
        `and ${formatBytes(PREFLIGHT_BLOCK_FREE_BYTES)}`,
      pressure,
    };
  }
  if (
    pressure.percentFree < PREFLIGHT_WARN_PERCENT_FREE ||
    pressure.freeBytes < PREFLIGHT_WARN_FREE_BYTES
  ) {
    return {
      status: 'warn',
      reason:
        `disk preflight warning: ${pressure.percentFree.toFixed(1)}% free ` +
        `(${formatBytes(pressure.freeBytes)}); below ${PREFLIGHT_WARN_PERCENT_FREE}% or ` +
        `${formatBytes(PREFLIGHT_WARN_FREE_BYTES)}`,
      pressure,
    };
  }
  return {
    status: 'ok',
    reason:
      `disk preflight ok: ${pressure.percentFree.toFixed(1)}% free ` +
      `(${formatBytes(pressure.freeBytes)})`,
    pressure,
  };
}

export interface LargeResourcePlan {
  action: 'reuse' | 'create' | 'block';
  preflight: PreflightResult;
  existingIdentity?: string;
  estimatedBytes: number;
  reason: string;
}

/**
 * Before creating a large resource: evaluate pressure, prefer reuse, and
 * refuse when the estimated physical cost would cross the block threshold.
 */
export function planLargeResource(input: {
  kind: 'worker' | 'release';
  identity: string;
  estimatedBytes: number;
  existingIdentities?: string[];
  pressure?: DiskPressure;
}): LargeResourcePlan {
  const preflight = evaluateDiskPreflight(input.pressure ?? diskPressure());
  const existing = (input.existingIdentities ?? []).find((name) => name === input.identity);
  if (existing) {
    return {
      action: 'reuse',
      preflight,
      existingIdentity: existing,
      estimatedBytes: 0,
      reason: `reuse existing ${input.kind} ${existing} rather than creating a new copy`,
    };
  }
  if (preflight.status === 'block') {
    return {
      action: 'block',
      preflight,
      estimatedBytes: input.estimatedBytes,
      reason: preflight.reason,
    };
  }
  const remaining = preflight.pressure.freeBytes - input.estimatedBytes;
  const remainingPercent =
    preflight.pressure.totalBytes === 0 ? 0 : (remaining / preflight.pressure.totalBytes) * 100;
  if (remaining < PREFLIGHT_BLOCK_FREE_BYTES || remainingPercent < PREFLIGHT_BLOCK_PERCENT_FREE) {
    return {
      action: 'block',
      preflight,
      estimatedBytes: input.estimatedBytes,
      reason:
        `estimated ${formatBytes(input.estimatedBytes)} ${input.kind} would leave ` +
        `${formatBytes(Math.max(0, remaining))} free`,
    };
  }
  return {
    action: 'create',
    preflight,
    estimatedBytes: input.estimatedBytes,
    reason: `create ${input.kind} ${input.identity} after hygiene (${preflight.status})`,
  };
}

/** Default physical cost used when a caller has not measured a prior worker/release. */
export const DEFAULT_WORKER_COST_BYTES = 10 * 1024 * 1024 * 1024;
export const DEFAULT_RELEASE_COST_BYTES = 50 * 1024 * 1024;

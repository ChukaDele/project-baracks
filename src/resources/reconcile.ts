import { existsSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { activeGoals, majorHome } from '../supervisor/state.js';
import { loadLimaExecutionConfig } from '../execution/lima-config.js';
import { openDb } from '../db/client.js';
import { deprecateCapability, listAllCapabilities } from '../capabilities/registry.js';
import {
  applyCleanup,
  planCleanup,
  type CleanupApplyResult,
  type CleanupDeps,
  type CleanupPlan,
} from './cleanup.js';
import {
  DEFAULT_WORKER_COST_BYTES,
  evaluateDiskPreflight,
  planLargeResource,
  type LargeResourcePlan,
  type PreflightResult,
} from './preflight.js';
import { createReclaimTools, parseLimaList, type ReclaimTools } from './tools.js';
import type { CredentialInventory } from './inventory.js';

export type ReconcilePhase = 'before-create' | 'after-success' | 'after-failure';

export interface ReconcileDeps extends CleanupDeps {
  phase: ReconcilePhase;
  apply?: boolean;
  aggressive?: boolean;
  guestReconcile?: () => void;
}

export interface ReconcileResult {
  phase: ReconcilePhase;
  preflight: PreflightResult;
  plan: CleanupPlan;
  applied?: CleanupApplyResult;
}

function loadLimactlPath(home: string): string | undefined {
  const path = join(home, 'execution.json');
  if (!existsSync(path)) return undefined;
  try {
    return loadLimaExecutionConfig(path).limactlPath;
  } catch {
    return undefined;
  }
}

export function productionCleanupDeps(home = majorHome(), tools?: ReclaimTools): CleanupDeps {
  const limactlPath = loadLimactlPath(home);
  const reclaim = tools ?? createReclaimTools({ ...(limactlPath ? { limactlPath } : {}) });
  let limaInstances: { name: string }[] = [];
  let limaListError: string | undefined;
  try {
    limaInstances = reclaim.listLimaInstances();
  } catch (error) {
    limaListError = error instanceof Error ? error.message : String(error);
  }
  let leases: CleanupDeps['leases'] = [];
  const leasePath = process.env.MAJOR_RESOURCE_PATH ?? join(home, 'resource-state.json');
  if (existsSync(leasePath)) {
    try {
      const parsed = JSON.parse(readFileSync(leasePath, 'utf8')) as { leases?: { id: string }[] };
      leases = (parsed.leases ?? []).map((lease) => ({ id: lease.id }));
    } catch {
      leases = [];
    }
  }
  let goals: CleanupDeps['goals'] = [];
  try {
    goals = activeGoals().map((goal) => ({ id: goal.id, status: goal.status }));
  } catch {
    goals = [];
  }
  const credentials: CredentialInventory = { byInstance: {}, complete: false };
  let provisionalCapabilities: CleanupDeps['provisionalCapabilities'] = [];
  let expireCapability: CleanupDeps['expireCapability'];
  const dbPath = process.env.MAJOR_DB_PATH ?? join(home, 'major.db');
  if (existsSync(dbPath)) {
    try {
      const { db } = openDb(dbPath);
      provisionalCapabilities = listAllCapabilities(db)
        .filter((row) => row.status === 'provisional')
        .map((row) => ({
          id: row.id,
          createdAtMs: Date.parse(row.createdAt),
          validated: false,
        }));
      expireCapability = (id) => {
        deprecateCapability(db, id, 'retention: unvalidated provisional older than 24h');
      };
    } catch {
      provisionalCapabilities = [];
    }
  }
  // The installer records a crashed destination worker here; that marker, not
  // reachability, is what makes a worker a "failed destination".
  let partialWorkerInstances: string[] = [];
  const partialMarker = join(home, '.partial-worker');
  if (existsSync(partialMarker)) {
    try {
      const name = readFileSync(partialMarker, 'utf8').trim();
      if (name) partialWorkerInstances = [name];
    } catch {
      partialWorkerInstances = [];
    }
  }
  return {
    home,
    limaInstances,
    ...(limaListError ? { limaListError } : {}),
    credentials,
    leases,
    goals,
    partialWorkerInstances,
    ...(expireCapability ? { expireCapability } : {}),
    provisionalCapabilities,
    tools: reclaim,
    tmpDir: process.env.TMPDIR ?? join(homedir(), 'tmp'),
  };
}

/**
 * Single reconcile entry point. Call this before a large create, after a
 * successful create, and after failure/cancellation. Guest run cleanup is
 * injected by lima-backend so there is no second run reaper.
 */
export function reconcileResources(input: ReconcileDeps): ReconcileResult {
  const preflight = evaluateDiskPreflight(input.pressure?.(input.home));
  input.guestReconcile?.();
  if (input.phase === 'after-success' || input.phase === 'after-failure') {
    removeInstallStaging(input);
  }
  if (input.phase === 'after-failure') {
    removePartialDestinationMarker(input);
  }
  const plan = planCleanup(input, input.aggressive === true);
  if (input.apply === false) {
    return { phase: input.phase, preflight, plan };
  }
  const applied = applyCleanup(input, input.aggressive === true);
  return { phase: input.phase, preflight, plan, applied };
}

function removeInstallStaging(input: ReconcileDeps): void {
  const staging = join(input.home, 'install-staging');
  if (!existsSync(staging)) return;
  (input.removeTree ?? ((path: string) => rmSync(path, { recursive: true, force: true })))(staging);
}

function removePartialDestinationMarker(input: ReconcileDeps): void {
  const marker = join(input.home, '.partial-worker');
  if (!existsSync(marker)) return;
  try {
    const name = readFileSync(marker, 'utf8').trim();
    if (name) input.tools?.deleteLimaInstance(name);
  } catch {
    // best-effort; applyCleanup still classifies leftover destination workers
  }
  try {
    rmSync(marker, { force: true });
  } catch {
    // ignore
  }
}

export function prepareForLargeResource(input: {
  kind: 'worker' | 'release';
  identity: string;
  estimatedBytes?: number;
  home?: string;
  tools?: ReclaimTools;
}): LargeResourcePlan {
  const home = input.home ?? majorHome();
  const deps = productionCleanupDeps(home, input.tools);
  reconcileResources({ ...deps, phase: 'before-create', apply: true });
  const refreshed = productionCleanupDeps(home, input.tools);
  const existing = (refreshed.limaInstances ?? []).map((row) => row.name);
  return planLargeResource({
    kind: input.kind,
    identity: input.identity,
    estimatedBytes: input.estimatedBytes ?? DEFAULT_WORKER_COST_BYTES,
    existingIdentities: existing,
  });
}

/** Host-side cancellation cleanup used by existing SIGINT/SIGTERM handlers. */
export function reconcileAfterCancel(home = majorHome(), tools?: ReclaimTools): ReconcileResult {
  const deps = productionCleanupDeps(home, tools);
  return reconcileResources({ ...deps, phase: 'after-failure', apply: true });
}

export function formatCleanupHuman(plan: CleanupPlan, applied?: CleanupApplyResult): string {
  const lines: string[] = ['MAJOR CLEANUP', ''];
  lines.push('Inventory');
  for (const resource of plan.inventory) {
    lines.push(
      `  ${resource.class.padEnd(20)} ${resource.kind} ${resource.identity}  ${resource.reason}`,
    );
  }
  lines.push('');
  if (applied) {
    lines.push(`Removed ${applied.removed.length} resource(s)`);
    for (const item of applied.removed) {
      lines.push(`  ${item.class} ${item.id}  ${item.reason}`);
    }
    lines.push(`Reclaimed ${formatBytesSafe(applied.reclaimedBytes)} (measured df delta)`);
  } else {
    lines.push('Would remove');
    for (const resource of plan.wouldRemove) {
      lines.push(`  ${resource.class} ${resource.id}  ${resource.reason}`);
    }
    if (plan.wouldRemove.length === 0) lines.push('  (nothing)');
    lines.push(plan.estimatedReclaimLabel);
  }
  return lines.join('\n');
}

function formatBytesSafe(bytes: number): string {
  const abs = Math.abs(bytes);
  if (abs >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (abs >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (abs >= 1e3) return `${(bytes / 1e3).toFixed(1)} KB`;
  return `${Math.round(bytes)} B`;
}

export function resolveMajorHome(override?: string): string {
  return override ? resolve(override) : majorHome();
}

export { parseLimaList };

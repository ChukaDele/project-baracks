import { existsSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createLogger } from '../logging/logger.js';
import {
  isProtectedClass,
  reclaimableResources,
  scanInventory,
  type ClassifiedResource,
  type CredentialInventory,
  type GoalRoot,
  type InventoryDeps,
  type LeaseRoot,
} from './inventory.js';
import { archiveColdResource, isCompactable } from './compaction.js';
import { createReclaimTools, tarGzDirectory, type ReclaimTools } from './tools.js';
import { clearUsageCache, formatBytes, measureReclaimed, type DiskPressure } from './usage.js';

const logger = createLogger({ bindings: { component: 'major-cleanup' } });

export const ESTIMATED_RECLAIM_CAVEAT = 'actual reclaim is measured on apply';

export interface CleanupRemoval {
  id: string;
  class: ClassifiedResource['class'];
  reason: string;
}

export interface CleanupPlan {
  inventory: ClassifiedResource[];
  wouldRemove: ClassifiedResource[];
  wouldCompact: ClassifiedResource[];
  estimatedReclaimBytes: number;
  estimatedReclaimLabel: string;
}

export interface CleanupApplyResult {
  removed: CleanupRemoval[];
  compacted: CleanupRemoval[];
  refused: CleanupRemoval[];
  reclaimedBytes: number;
  reclaimedSource: 'df-delta';
}

export interface CleanupDeps extends InventoryDeps {
  tools?: ReclaimTools;
  removeTree?: (path: string) => void;
  archiveTree?: (path: string) => string;
  expireCapability?: (id: string) => void;
  pressure?: (path?: string) => DiskPressure;
  compact?: boolean;
}

export function estimatedReclaimLabel(bytes: number): string {
  return `estimated up to ${formatBytes(bytes)}; ${ESTIMATED_RECLAIM_CAVEAT}`;
}

export function planCleanup(deps: CleanupDeps, aggressive = false): CleanupPlan {
  const scan = scanInventory(deps);
  const wouldRemove = reclaimableResources(scan.resources).filter((resource) => {
    if (resource.kind === 'lima-instance' && resource.identity === 'major-worker' && !aggressive) {
      return resource.class === 'orphan' || resource.class === 'ephemeral';
    }
    return true;
  });
  const extraAggressive = aggressive
    ? scan.resources.filter(
        (resource) =>
          (resource.kind === 'lima-instance' &&
            resource.identity === 'major-worker' &&
            !isProtectedClass(resource.class) &&
            resource.class !== 'unknown') ||
          (resource.kind === 'release-snapshot' && resource.class === 'cold-archive'),
      )
    : [];
  const compactable = scan.resources.filter(isCompactable);
  const removeSet = new Map<string, ClassifiedResource>();
  for (const resource of [...wouldRemove, ...extraAggressive]) {
    if (resource.kind === 'release-snapshot' && resource.class === 'cold-archive' && !aggressive) {
      continue;
    }
    removeSet.set(resource.id, resource);
  }
  const removeList = [...removeSet.values()];
  const estimatedReclaimBytes = [...removeList, ...compactable]
    .filter((resource, index, all) => all.findIndex((item) => item.id === resource.id) === index)
    .reduce((sum, resource) => sum + resource.allocatedBytes, 0);
  return {
    inventory: scan.resources,
    wouldRemove: removeList,
    wouldCompact: compactable.filter((resource) => !removeSet.has(resource.id) || !aggressive),
    estimatedReclaimBytes,
    estimatedReclaimLabel: estimatedReclaimLabel(estimatedReclaimBytes),
  };
}

function refuseRemoval(resource: ClassifiedResource): CleanupRemoval | undefined {
  if (isProtectedClass(resource.class)) {
    return {
      id: resource.id,
      class: resource.class,
      reason: `refusing to remove ${resource.class} resource ${resource.id}`,
    };
  }
  return undefined;
}

function defaultRemoveTree(path: string): void {
  const resolved = resolve(path);
  if (!existsSync(resolved)) return;
  rmSync(resolved, { recursive: true, force: true });
}

export function applyCleanup(deps: CleanupDeps, aggressive = false): CleanupApplyResult {
  const plan = planCleanup(deps, aggressive);
  const tools = deps.tools ?? createReclaimTools();
  const removeTree = deps.removeTree ?? defaultRemoveTree;
  const archiveTree = deps.archiveTree ?? tarGzDirectory;
  const removed: CleanupRemoval[] = [];
  const compacted: CleanupRemoval[] = [];
  // Record every protected resource explicitly. "The active worker was not
  // deleted" must be auditable in its own right, not merely inferred from its
  // absence in `removed`.
  const refused: CleanupRemoval[] = plan.inventory
    .filter((resource) => isProtectedClass(resource.class))
    .map((resource) => ({
      id: resource.id,
      class: resource.class,
      reason: `refusing to remove ${resource.class} resource ${resource.id}`,
    }));

  const mutate = () => {
    for (const resource of plan.wouldRemove) {
      const blocked = refuseRemoval(resource);
      if (blocked) {
        if (!refused.some((item) => item.id === blocked.id)) refused.push(blocked);
        logger.warn('cleanup refused', { ...blocked });
        continue;
      }
      try {
        if (resource.kind === 'lima-instance') {
          tools.deleteLimaInstance(resource.identity);
        } else if (resource.kind === 'provisional-capability') {
          deps.expireCapability?.(resource.identity);
        } else if (resource.path) {
          removeTree(resource.path);
        }
        const record = { id: resource.id, class: resource.class, reason: resource.reason };
        removed.push(record);
        logger.info('cleanup removed', record);
      } catch (error) {
        logger.error('cleanup removal failed', {
          id: resource.id,
          class: resource.class,
          reason: error instanceof Error ? error.message : String(error),
        });
      }
    }
    if (deps.compact !== false) {
      for (const resource of plan.wouldCompact) {
        try {
          archiveColdResource(resource, archiveTree);
          if (resource.path && aggressive) removeTree(resource.path);
          const record = { id: resource.id, class: resource.class, reason: resource.reason };
          compacted.push(record);
          logger.info('cleanup compacted', record);
        } catch (error) {
          logger.warn('cleanup compaction skipped', {
            id: resource.id,
            reason: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    tools.pruneLima();
    tools.pruneGitWorktrees(join(deps.home, 'worktrees'));
    tools.prunePnpmStore();
  };

  const { reclaimedBytes } = measureReclaimed(mutate, deps.home, deps.pressure);
  // Sizes memoised before the removals are now stale.
  clearUsageCache();
  return { removed, compacted, refused, reclaimedBytes, reclaimedSource: 'df-delta' };
}

export function emptyCredentialInventory(): CredentialInventory {
  return { byInstance: {}, complete: false };
}

export function defaultInventoryExtras(
  home: string,
): Pick<InventoryDeps, 'leases' | 'goals' | 'home'> {
  return { home, leases: [] as LeaseRoot[], goals: [] as GoalRoot[] };
}

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { RETENTION, withinAgeWindow, withinNewestWindow } from './retention.js';
import { allocatedBytes } from './usage.js';

export const RESOURCE_CLASSES = [
  'active',
  'rollback',
  'credential-bearing',
  'cache',
  'ephemeral',
  'orphan',
  'cold-archive',
  'unknown',
] as const;
export type ResourceClass = (typeof RESOURCE_CLASSES)[number];

export const PROTECTED_CLASSES: readonly ResourceClass[] = [
  'active',
  'rollback',
  'credential-bearing',
  'unknown',
];

export const RESOURCE_KINDS = [
  'lima-instance',
  'release-snapshot',
  'staged-release',
  'staged-validation',
  'execution-run',
  'log',
  'temp-worktree',
  'install-staging',
  'provisional-capability',
  'diagnostic-artifact',
  'cache',
] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface GcRoots {
  activeReleaseSha?: string;
  activeReleaseDir?: string;
  activeWorkerInstance?: string;
  rollbackReleaseShas: string[];
  rollbackWorkerInstances: string[];
  historyWorkerInstances: string[];
  liveGoalIds: string[];
  activeLeaseIds: string[];
}

export interface CredentialInventory {
  /** instance name -> provider keys present inside that worker */
  byInstance: Record<string, string[]>;
  /** false: Major could not inspect credentials; remaining workers stay unknown */
  complete: boolean;
}

export interface ResourceCandidate {
  kind: ResourceKind;
  identity: string;
  path?: string;
  createdAtMs: number;
  /** Recency rank among siblings of the same kind (0 = newest). */
  newestIndex?: number;
  metadata?: {
    testWorker?: boolean;
    failedDestination?: boolean;
    directoryGone?: boolean;
    capabilityValidated?: boolean;
  };
}

export interface ClassifiedResource {
  id: string;
  kind: ResourceKind;
  class: ResourceClass;
  identity: string;
  path?: string;
  reason: string;
  reclaimable: boolean;
  allocatedBytes: number;
  createdAt?: string;
}

export interface InventoryScan {
  roots: GcRoots;
  resources: ClassifiedResource[];
}

export interface LeaseRoot {
  id: string;
}

export interface GoalRoot {
  id: string;
  status: string;
}

export interface InstalledReleaseRecord {
  sha?: string;
  releaseDir?: string;
}

export interface InstallHistoryEntry {
  sha?: string;
  releaseDir?: string;
}

export interface InventoryDeps {
  home: string;
  executionConfigPath?: string;
  nowMs?: number;
  limaInstances?: { name: string }[];
  limaListError?: string;
  credentials?: CredentialInventory;
  leases?: LeaseRoot[];
  goals?: GoalRoot[];
  /** Workers a crashed install left behind, recorded by the installer. */
  partialWorkerInstances?: string[];
  /** Root holding Lima instance directories. Defaults to `~/.lima`. */
  limaHome?: string;
  provisionalCapabilities?: {
    id: string;
    createdAtMs: number;
    validated: boolean;
  }[];
  tmpDir?: string;
  measure?: (path: string) => number;
}

const SHA_WORKER = /^major-worker-([0-9a-f]{12})$/;
const TEST_WORKER = /^major-test-/;
const SHA40 = /^[0-9a-f]{40}$/;

export function workerInstanceForSha(sha: string): string {
  return `major-worker-${sha.slice(0, 12)}`;
}

export function isProtectedClass(value: ResourceClass): boolean {
  return PROTECTED_CLASSES.includes(value);
}

function readJson(path: string): unknown {
  if (!existsSync(path)) return undefined;
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

function readHistory(path: string): InstallHistoryEntry[] {
  if (!existsSync(path)) return [];
  const entries: InstallHistoryEntry[] = [];
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line) as InstallHistoryEntry);
    } catch {
      // Corrupt lines are ignored; roots are read, never guessed from mtimes.
    }
  }
  return entries;
}

export function rollbackShas(
  history: InstallHistoryEntry[],
  currentSha: string | undefined,
  generations = RETENTION.rollbackGenerations,
): string[] {
  const distinct: string[] = [];
  for (let index = history.length - 1; index >= 0; index -= 1) {
    const sha = history[index]?.sha;
    if (!sha || !SHA40.test(sha) || sha === currentSha || distinct.includes(sha)) continue;
    distinct.push(sha);
    if (distinct.length >= generations) break;
  }
  return distinct;
}

export function readGcRoots(
  home: string,
  extras: { leases?: LeaseRoot[]; goals?: GoalRoot[]; executionConfigPath?: string } = {},
): GcRoots {
  const installed = readJson(join(home, 'installed-release.json')) as
    InstalledReleaseRecord | undefined;
  const history = readHistory(join(home, 'install-history.jsonl'));
  const execution = readJson(extras.executionConfigPath ?? join(home, 'execution.json')) as
    { instance?: string } | undefined;
  const activeSha =
    typeof installed?.sha === 'string' && SHA40.test(installed.sha) ? installed.sha : undefined;
  const rollbacks = rollbackShas(history, activeSha);
  const historyWorkers = [
    ...new Set(
      history
        .map((entry) => entry.sha)
        .filter((sha): sha is string => typeof sha === 'string' && SHA40.test(sha))
        .map(workerInstanceForSha),
    ),
  ];
  const liveGoalIds = (extras.goals ?? [])
    .filter((goal) => goal.status === 'active' || goal.status === 'running')
    .map((goal) => goal.id);
  return {
    ...(activeSha ? { activeReleaseSha: activeSha } : {}),
    ...(typeof installed?.releaseDir === 'string'
      ? { activeReleaseDir: installed.releaseDir }
      : {}),
    ...(typeof execution?.instance === 'string'
      ? { activeWorkerInstance: execution.instance }
      : {}),
    rollbackReleaseShas: rollbacks,
    rollbackWorkerInstances: rollbacks.map(workerInstanceForSha),
    historyWorkerInstances: historyWorkers,
    liveGoalIds,
    activeLeaseIds: (extras.leases ?? []).map((lease) => lease.id),
  };
}

function uniqueCredentialSource(
  instance: string,
  activeWorker: string | undefined,
  credentials: CredentialInventory,
): boolean {
  const providers = credentials.byInstance[instance] ?? [];
  if (providers.length === 0) return false;
  const activeProviders = new Set(credentials.byInstance[activeWorker ?? ''] ?? []);
  return providers.some((provider) => {
    if (activeProviders.has(provider)) return false;
    return !Object.entries(credentials.byInstance).some(
      ([name, held]) => name !== instance && held.includes(provider),
    );
  });
}

function looksLikeMajorWorker(name: string): boolean {
  return name === 'major-worker' || SHA_WORKER.test(name) || TEST_WORKER.test(name);
}

/**
 * Pure classifier. Roots are supplied, never guessed. `unknown` is the safe
 * default and is never reclaimable.
 */
export function classifyResource(
  candidate: ResourceCandidate,
  roots: GcRoots,
  credentials: CredentialInventory = { byInstance: {}, complete: true },
  nowMs = Date.now(),
): Pick<ClassifiedResource, 'class' | 'reason' | 'reclaimable'> {
  const { kind, identity, createdAtMs, newestIndex, metadata } = candidate;

  if (kind === 'lima-instance') {
    if (identity === roots.activeWorkerInstance) {
      return {
        class: 'active',
        reason: 'active worker from execution.json',
        reclaimable: false,
      };
    }
    if (roots.rollbackWorkerInstances.includes(identity)) {
      return {
        class: 'rollback',
        reason: 'rollback generation worker from install-history.jsonl',
        reclaimable: false,
      };
    }
    if (uniqueCredentialSource(identity, roots.activeWorkerInstance, credentials)) {
      return {
        class: 'credential-bearing',
        reason: 'only remaining source of a provider credential absent from the active worker',
        reclaimable: false,
      };
    }
    if (metadata?.testWorker || TEST_WORKER.test(identity)) {
      return {
        class: 'ephemeral',
        reason: 'test worker; remove immediately after the test run',
        reclaimable: true,
      };
    }
    if (metadata?.failedDestination) {
      return {
        class: 'ephemeral',
        reason: 'failed destination worker; remove immediately',
        reclaimable: true,
      };
    }
    const shaMatch = SHA_WORKER.exec(identity);
    if (
      shaMatch &&
      roots.activeReleaseSha &&
      identity === workerInstanceForSha(roots.activeReleaseSha)
    ) {
      return {
        class: 'active',
        reason: 'active release worker from installed-release.json',
        reclaimable: false,
      };
    }
    if (!looksLikeMajorWorker(identity)) {
      return {
        class: 'unknown',
        reason: 'instance is not a Major worker; never deleted',
        reclaimable: false,
      };
    }
    // A per-SHA worker that is neither active nor a retained rollback
    // generation is reclaimable. Appearing SOMEWHERE in install-history must
    // not protect it: history grows forever, so treating every historical
    // worker as unclassifiable kept one VM per install SHA indefinitely -- the
    // exact accumulation this policy exists to stop.
    //
    // This is only safe once an active worker exists, because the install that
    // created it migrated provider credentials forward from its predecessor.
    // With no active worker recorded we cannot make that claim, so we fall
    // through to `unknown` and keep the worker.
    if (shaMatch && roots.activeWorkerInstance) {
      return {
        class: 'orphan',
        reason: roots.historyWorkerInstances.includes(identity)
          ? 'per-SHA worker superseded beyond the retained rollback generations'
          : 'per-SHA worker reachable from no install-history generation',
        reclaimable: true,
      };
    }
    if (!credentials.complete && looksLikeMajorWorker(identity)) {
      return {
        class: 'unknown',
        reason: 'worker credentials could not be inspected; unknown is never deleted',
        reclaimable: false,
      };
    }
    if (looksLikeMajorWorker(identity)) {
      return {
        class: 'orphan',
        reason: 'worker is not reachable from declared GC roots',
        reclaimable: true,
      };
    }
    return {
      class: 'unknown',
      reason: 'lima instance could not be classified confidently',
      reclaimable: false,
    };
  }

  if (kind === 'release-snapshot') {
    if (identity === roots.activeReleaseSha || candidate.path === roots.activeReleaseDir) {
      return {
        class: 'active',
        reason: 'active release from installed-release.json',
        reclaimable: false,
      };
    }
    if (roots.rollbackReleaseShas.includes(identity)) {
      return {
        class: 'rollback',
        reason: 'rollback generation release from install-history.jsonl',
        reclaimable: false,
      };
    }
    if (SHA40.test(identity)) {
      return {
        class: 'cold-archive',
        reason:
          'release snapshot beyond the rollback window; compact only, ' +
          'never rewrite the active release',
        reclaimable: false,
      };
    }
    return {
      class: 'unknown',
      reason: 'release snapshot identity is not a git sha',
      reclaimable: false,
    };
  }

  if (kind === 'staged-release') {
    if (
      withinNewestWindow(
        newestIndex ?? Number.POSITIVE_INFINITY,
        RETENTION.stagedReleases.keepNewest,
      )
    ) {
      return {
        class: 'ephemeral',
        reason: 'newest staged release retained',
        reclaimable: false,
      };
    }
    return {
      class: 'orphan',
      reason: 'staged release outside the newest-1 retention window',
      reclaimable: true,
    };
  }

  if (kind === 'staged-validation') {
    if (
      withinNewestWindow(
        newestIndex ?? Number.POSITIVE_INFINITY,
        RETENTION.stagedValidation.keepNewest,
      )
    ) {
      return {
        class: 'ephemeral',
        reason: 'newest staged-validation directory retained',
        reclaimable: false,
      };
    }
    return {
      class: 'orphan',
      reason: 'staged-validation directory outside the newest-1 retention window',
      reclaimable: true,
    };
  }

  if (kind === 'execution-run') {
    const newest = withinNewestWindow(
      newestIndex ?? Number.POSITIVE_INFINITY,
      RETENTION.executionRuns.keepNewest,
    );
    const fresh = withinAgeWindow(createdAtMs, RETENTION.executionRuns.maxAgeMs, nowMs);
    if (newest || fresh) {
      return {
        class: 'ephemeral',
        reason: 'execution run-state within newest-10 or 48h window',
        reclaimable: false,
      };
    }
    return {
      class: 'orphan',
      reason: 'execution run-state outside newest-10 and older than 48h',
      reclaimable: true,
    };
  }

  if (kind === 'log') {
    if (withinAgeWindow(createdAtMs, RETENTION.logs.maxAgeMs, nowMs)) {
      return { class: 'ephemeral', reason: 'log within 7-day retention', reclaimable: false };
    }
    return { class: 'cold-archive', reason: 'log older than 7 days', reclaimable: true };
  }

  if (kind === 'cache') {
    if (withinAgeWindow(createdAtMs, RETENTION.caches.maxAgeMs, nowMs)) {
      return { class: 'cache', reason: 'cache within 14-day retention', reclaimable: false };
    }
    return { class: 'cache', reason: 'cache older than 14 days', reclaimable: true };
  }

  if (kind === 'temp-worktree') {
    if (metadata?.directoryGone) {
      return {
        class: 'ephemeral',
        reason: 'worktree directory is gone; prune the git registration',
        reclaimable: true,
      };
    }
    if (withinAgeWindow(createdAtMs, RETENTION.tempWorktrees.maxAgeMs, nowMs)) {
      return {
        class: 'ephemeral',
        reason: 'temp worktree within 7-day retention',
        reclaimable: false,
      };
    }
    return {
      class: 'orphan',
      reason: 'temp worktree older than 7 days',
      reclaimable: true,
    };
  }

  if (kind === 'install-staging') {
    if (
      withinNewestWindow(
        newestIndex ?? Number.POSITIVE_INFINITY,
        RETENTION.installStaging.keepNewest,
      )
    ) {
      return {
        class: 'ephemeral',
        reason: 'newest install staging retained until success',
        reclaimable: false,
      };
    }
    return {
      class: 'orphan',
      reason: 'install staging outside newest-1 window',
      reclaimable: true,
    };
  }

  if (kind === 'provisional-capability') {
    if (metadata?.capabilityValidated) {
      return {
        class: 'active',
        reason: 'validated Toolsmith capability is not ephemeral',
        reclaimable: false,
      };
    }
    if (withinAgeWindow(createdAtMs, RETENTION.provisionalCapabilities.maxAgeMs, nowMs)) {
      return {
        class: 'ephemeral',
        reason: 'unvalidated provisional capability within 24h',
        reclaimable: false,
      };
    }
    return {
      class: 'orphan',
      reason: 'provisional capability older than 24h and never validated',
      reclaimable: true,
    };
  }

  if (kind === 'diagnostic-artifact') {
    if (withinAgeWindow(createdAtMs, RETENTION.diagnosticArtifacts.maxAgeMs, nowMs)) {
      return {
        class: 'ephemeral',
        reason: 'diagnostic artifact within 14-day retention',
        reclaimable: false,
      };
    }
    return {
      class: 'cold-archive',
      reason: 'diagnostic artifact older than 14 days',
      reclaimable: true,
    };
  }

  return {
    class: 'unknown',
    reason: 'resource kind could not be classified confidently',
    reclaimable: false,
  };
}

function listDirs(path: string): { name: string; path: string; createdAtMs: number }[] {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const full = join(path, entry.name);
        let createdAtMs = 0;
        try {
          createdAtMs = statSync(full).mtimeMs;
        } catch {
          createdAtMs = 0;
        }
        return { name: entry.name, path: full, createdAtMs };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  } catch {
    return [];
  }
}

function listFiles(path: string): { name: string; path: string; createdAtMs: number }[] {
  if (!existsSync(path)) return [];
  try {
    return readdirSync(path, { withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const full = join(path, entry.name);
        let createdAtMs = 0;
        try {
          createdAtMs = statSync(full).mtimeMs;
        } catch {
          createdAtMs = 0;
        }
        return { name: entry.name, path: full, createdAtMs };
      })
      .sort((a, b) => b.createdAtMs - a.createdAtMs);
  } catch {
    return [];
  }
}

function classified(
  candidate: ResourceCandidate,
  roots: GcRoots,
  credentials: CredentialInventory,
  nowMs: number,
  measure: (path: string) => number,
): ClassifiedResource {
  const result = classifyResource(candidate, roots, credentials, nowMs);
  const id = `${candidate.kind}:${candidate.identity}`;
  return {
    id,
    kind: candidate.kind,
    class: result.class,
    identity: candidate.identity,
    reason: result.reason,
    reclaimable: result.reclaimable && !isProtectedClass(result.class),
    allocatedBytes: candidate.path ? measure(candidate.path) : 0,
    ...(candidate.path ? { path: candidate.path } : {}),
    ...(candidate.createdAtMs ? { createdAt: new Date(candidate.createdAtMs).toISOString() } : {}),
  };
}

export function scanInventory(deps: InventoryDeps): InventoryScan {
  const home = resolve(deps.home);
  const nowMs = deps.nowMs ?? Date.now();
  const measure = deps.measure ?? allocatedBytes;
  const credentials = deps.credentials ?? { byInstance: {}, complete: false };
  const roots = readGcRoots(home, {
    ...(deps.leases ? { leases: deps.leases } : {}),
    ...(deps.goals ? { goals: deps.goals } : {}),
    ...(deps.executionConfigPath ? { executionConfigPath: deps.executionConfigPath } : {}),
  });
  const resources: ClassifiedResource[] = [];
  const push = (candidate: ResourceCandidate) => {
    resources.push(classified(candidate, roots, credentials, nowMs, measure));
  };

  if (deps.limaListError) {
    resources.push({
      id: 'lima-instance:inventory',
      kind: 'lima-instance',
      class: 'unknown',
      identity: 'inventory',
      reason: `lima list failed: ${deps.limaListError}`,
      reclaimable: false,
      allocatedBytes: 0,
    });
  } else {
    for (const instance of deps.limaInstances ?? []) {
      push({
        kind: 'lima-instance',
        identity: instance.name,
        // Worker images are Major-created bytes, so they must be measurable.
        // Injectable so tests never read the developer's real ~/.lima.
        path: join(deps.limaHome ?? join(homedir(), '.lima'), instance.name),
        createdAtMs: nowMs,
        metadata: {
          testWorker: TEST_WORKER.test(instance.name),
          // A failed destination is a worker a crashed install left behind, which
          // the installer records explicitly. Being unreachable from the roots
          // does NOT make a worker a failed destination -- that is an orphan, and
          // conflating the two produced a misleading "failed destination worker"
          // reason for every stale release worker and reported zero orphans.
          failedDestination: (deps.partialWorkerInstances ?? []).includes(instance.name),
        },
      });
    }
  }

  listDirs(join(home, 'releases')).forEach((entry, newestIndex) => {
    push({
      kind: 'release-snapshot',
      identity: entry.name,
      path: entry.path,
      createdAtMs: entry.createdAtMs,
      newestIndex,
    });
  });
  listDirs(join(home, 'staged-releases')).forEach((entry, newestIndex) => {
    push({
      kind: 'staged-release',
      identity: entry.name,
      path: entry.path,
      createdAtMs: entry.createdAtMs,
      newestIndex,
    });
  });
  listDirs(join(home, 'staged-validation', 'workspaces')).forEach((entry, newestIndex) => {
    push({
      kind: 'staged-validation',
      identity: entry.name,
      path: entry.path,
      createdAtMs: entry.createdAtMs,
      newestIndex,
    });
  });
  listDirs(join(home, 'execution', 'lima', 'runs')).forEach((entry, newestIndex) => {
    push({
      kind: 'execution-run',
      identity: entry.name,
      path: entry.path,
      createdAtMs: entry.createdAtMs,
      newestIndex,
    });
  });
  for (const entry of [...listFiles(join(home, 'logs')), ...listDirs(join(home, 'logs'))]) {
    push({ kind: 'log', identity: entry.name, path: entry.path, createdAtMs: entry.createdAtMs });
  }
  for (const entry of [...listFiles(join(home, 'caches')), ...listDirs(join(home, 'caches'))]) {
    push({ kind: 'cache', identity: entry.name, path: entry.path, createdAtMs: entry.createdAtMs });
  }
  for (const project of listDirs(join(home, 'worktrees'))) {
    listDirs(project.path).forEach((entry) => {
      push({
        kind: 'temp-worktree',
        identity: `${project.name}/${entry.name}`,
        path: entry.path,
        createdAtMs: entry.createdAtMs,
        metadata: { directoryGone: !existsSync(entry.path) },
      });
    });
  }
  const tmpDir = deps.tmpDir ?? join(home, 'tmp');
  const staging = [
    ...listDirs(tmpDir).filter((entry) => entry.name.startsWith('major-runtime-install.')),
    ...listDirs(join(home, 'install-staging')),
  ].sort((a, b) => b.createdAtMs - a.createdAtMs);
  staging.forEach((entry, newestIndex) => {
    push({
      kind: 'install-staging',
      identity: entry.name,
      path: entry.path,
      createdAtMs: entry.createdAtMs,
      newestIndex,
    });
  });
  for (const entry of [
    ...listFiles(join(home, 'diagnostics')),
    ...listDirs(join(home, 'diagnostics')),
  ]) {
    push({
      kind: 'diagnostic-artifact',
      identity: entry.name,
      path: entry.path,
      createdAtMs: entry.createdAtMs,
    });
  }
  (deps.provisionalCapabilities ?? []).forEach((capability) => {
    push({
      kind: 'provisional-capability',
      identity: capability.id,
      createdAtMs: capability.createdAtMs,
      metadata: { capabilityValidated: capability.validated },
    });
  });

  return { roots, resources };
}

export function reclaimableResources(resources: ClassifiedResource[]): ClassifiedResource[] {
  return resources.filter((resource) => resource.reclaimable && !isProtectedClass(resource.class));
}

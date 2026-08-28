import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { randomUUID } from 'node:crypto';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { majorHome } from './state.js';
import { readSystemMemoryAvailablePercent } from '../security/system-memory.js';

export const RESOURCE_KINDS = ['worker', 'browser', 'build'] as const;
export type ResourceKind = (typeof RESOURCE_KINDS)[number];

export interface ResourceLimits {
  total: number;
  workers: number;
  browsers: number;
  builds: number;
  maxSubagentDepth: number;
  softMemoryAvailablePercent: number;
}

export const GLOBAL_RESOURCE_LIMITS: ResourceLimits = {
  total: 6,
  // Hard ceiling only. The active worker limit is derived from live host
  // capacity by currentResourceLimits(); it is not a fixed governance count.
  workers: 4,
  browsers: 2,
  builds: 1,
  maxSubagentDepth: 1,
  softMemoryAvailablePercent: 25,
};

export interface ResourceLease {
  id: string;
  taskId: string;
  resourceId: string;
  fencingToken: string;
  kind: ResourceKind;
  owner: string;
  project?: string | undefined;
  parentLeaseId?: string | undefined;
  depth: number;
  pid?: number | undefined;
  createdAt: string;
  heartbeatAt: string;
  ttlMs: number;
  expiresAt: string;
  graceMs: number;
  reclaimAfter: string;
}

export interface QueuedResourceRequest {
  id: string;
  taskId: string;
  resourceId: string;
  fencingToken: string;
  kind: ResourceKind;
  owner: string;
  project?: string | undefined;
  parentLeaseId?: string | undefined;
  depth: number;
  pid?: number | undefined;
  ttlMs: number;
  requestedAt: string;
  reason: string;
}

interface ResourceStore {
  version: 1;
  leases: ResourceLease[];
  queue: QueuedResourceRequest[];
  reclaimTelemetry?: ResourceReclaimTelemetry;
}

export interface ResourceReclaimTelemetry {
  total: number;
  expired: number;
  deadProcess: number;
  lastReclaimedAt?: string | undefined;
  lastReclaimedLeaseIds: string[];
}

export interface ResourceTelemetry {
  workers: { active: number; limit: number };
  browsers: { active: number; limit: number };
  builds: { active: number; limit: number };
  total: { active: number; limit: number };
  queued: number;
  memoryAvailablePercent: number;
  memorySoftFloorPercent: number;
  reclaims: ResourceReclaimTelemetry;
}

export type ResourceRequestResult =
  | { status: 'active'; lease: ResourceLease; telemetry: ResourceTelemetry }
  | { status: 'queued'; request: QueuedResourceRequest; telemetry: ResourceTelemetry }
  | { status: 'rejected'; reason: string; telemetry: ResourceTelemetry };

const DEFAULT_TTL_MS: Record<ResourceKind, number> = {
  worker: 30 * 60 * 1000,
  browser: 15 * 60 * 1000,
  build: 20 * 60 * 1000,
};
export const RESOURCE_RECLAIM_GRACE_MS = 60_000;
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const sleepArray = new Int32Array(new SharedArrayBuffer(4));

function storePath(): string {
  return process.env.MAJOR_RESOURCE_PATH
    ? resolve(process.env.MAJOR_RESOURCE_PATH)
    : join(majorHome(), 'resource-state.json');
}

function emptyStore(): ResourceStore {
  return { version: 1, leases: [], queue: [], reclaimTelemetry: emptyReclaimTelemetry() };
}

function emptyReclaimTelemetry(): ResourceReclaimTelemetry {
  return { total: 0, expired: 0, deadProcess: 0, lastReclaimedLeaseIds: [] };
}

/** Stable compatibility identities for callers and v1 records created before
 * task/resource/fencing identity became explicit. They derive only from
 * existing persisted identity and do not introduce another authority. */
function fallbackTaskId(owner: string): string {
  return `legacy:task:${owner}`;
}

function fallbackResourceId(kind: ResourceKind, project?: string): string {
  return `legacy:resource:${kind}:${project ?? 'global'}`;
}

function fallbackFencingToken(id: string): string {
  return `legacy:fence:${id}`;
}

/** The only compatibility path for pre-fencing persisted v1 records. It
 * assigns deterministic migration tokens while loading the legacy store; all
 * public authorization boundaries still require the resulting token. */
function migrateLegacyResourceStore(parsed: ResourceStore): ResourceStore {
  parsed.leases = parsed.leases.map((lease) => {
    const derivedTtlCandidate = Date.parse(lease.expiresAt) - Date.parse(lease.heartbeatAt);
    const derivedTtlMs = Number.isFinite(derivedTtlCandidate)
      ? Math.max(1, derivedTtlCandidate)
      : DEFAULT_TTL_MS[lease.kind];
    const ttlMs = Number.isFinite(lease.ttlMs) && lease.ttlMs > 0 ? lease.ttlMs : derivedTtlMs;
    const graceMs =
      Number.isFinite(lease.graceMs) && lease.graceMs >= 0
        ? lease.graceMs
        : RESOURCE_RECLAIM_GRACE_MS;
    return {
      ...lease,
      taskId: lease.taskId ?? fallbackTaskId(lease.owner),
      resourceId: lease.resourceId ?? fallbackResourceId(lease.kind, lease.project),
      fencingToken: lease.fencingToken ?? fallbackFencingToken(lease.id),
      ttlMs,
      graceMs,
      reclaimAfter: Number.isFinite(Date.parse(lease.reclaimAfter))
        ? lease.reclaimAfter
        : new Date(Date.parse(lease.expiresAt) + graceMs).toISOString(),
    };
  });
  parsed.queue = parsed.queue.map((request) => ({
    ...request,
    taskId: request.taskId ?? fallbackTaskId(request.owner),
    resourceId: request.resourceId ?? fallbackResourceId(request.kind, request.project),
    fencingToken: request.fencingToken ?? fallbackFencingToken(request.id),
  }));
  return parsed;
}

function readStore(): ResourceStore {
  const path = storePath();
  if (!existsSync(path)) return emptyStore();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ResourceStore;
  if (parsed.version !== 1 || !Array.isArray(parsed.leases) || !Array.isArray(parsed.queue)) {
    throw new Error(`invalid Major resource store: ${path}`);
  }
  // In-place schema extension: old v1 stores remain readable and acquire the
  // explicit freshness contract on their next supported store operation.
  return migrateLegacyResourceStore(parsed);
}

function writeStore(store: ResourceStore): void {
  const path = storePath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function withStoreLock<T>(operation: (store: ResourceStore) => T): T {
  const path = `${storePath()}.lock`;
  mkdirSync(dirname(path), { recursive: true });
  const deadline = Date.now() + LOCK_TIMEOUT_MS;
  let fd: number | undefined;
  while (fd === undefined) {
    try {
      fd = openSync(path, 'wx', 0o600);
      writeFileSync(fd, `${process.pid} ${new Date().toISOString()}\n`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS) unlinkSync(path);
      } catch {
        // Another process released the lock between the existence check and stat.
      }
      if (Date.now() >= deadline) throw new Error(`Major resource lock timed out: ${path}`);
      Atomics.wait(sleepArray, 0, 0, 10);
    }
  }

  try {
    const store = readStore();
    const result = operation(store);
    writeStore(store);
    return result;
  } finally {
    closeSync(fd);
    try {
      unlinkSync(path);
    } catch {
      // Exact lock already removed; no broader cleanup is attempted.
    }
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

export function availableMemoryPercent(): number {
  const override = Number.parseFloat(process.env.MAJOR_MEMORY_AVAILABLE_PERCENT ?? '');
  if (Number.isFinite(override)) return Math.max(0, Math.min(100, override));
  const system = readSystemMemoryAvailablePercent();
  if (system !== undefined) return system;
  return Math.round((freemem() / totalmem()) * 100);
}

/**
 * Derive the active resource ceiling from the current host instead of the
 * retired DSH one-worker limit. The optional override is deliberately narrow:
 * it is useful for deterministic validation and an owner-controlled
 * workstation cap, but it can never exceed Major's hard ceiling.
 */
export function currentResourceLimits(): ResourceLimits {
  const override = Number.parseInt(process.env.MAJOR_WORKER_LIMIT ?? '', 10);
  const cpuLimit = Math.max(1, Math.min(GLOBAL_RESOURCE_LIMITS.workers, availableParallelism()));
  const memory = availableMemoryPercent();
  const memoryLimit = memory < 40 ? 1 : memory < 60 ? 2 : GLOBAL_RESOURCE_LIMITS.workers;
  const workers =
    Number.isInteger(override) && override > 0
      ? Math.min(GLOBAL_RESOURCE_LIMITS.workers, override)
      : Math.min(cpuLimit, memoryLimit);
  return { ...GLOBAL_RESOURCE_LIMITS, workers };
}

function leaseReclaimAfter(lease: ResourceLease): number {
  const explicit = Date.parse(lease.reclaimAfter);
  return Number.isFinite(explicit)
    ? explicit
    : Date.parse(lease.expiresAt) + RESOURCE_RECLAIM_GRACE_MS;
}

function leaseIsActive(lease: ResourceLease, now = Date.now()): boolean {
  return now < leaseReclaimAfter(lease) || (lease.pid !== undefined && pidAlive(lease.pid));
}

/** Reclaim is decided and committed while holding the resource-store lock.
 * A live process always wins over wall-clock staleness, and the grace window
 * gives an active owner time to renew after a delayed heartbeat. */
function prune(store: ResourceStore, now = Date.now()): ResourceReclaimTelemetry {
  const reclaimed: { id: string; reason: 'expired' | 'deadProcess' }[] = [];
  store.leases = store.leases.filter((lease) => {
    if (leaseIsActive(lease, now)) return true;
    reclaimed.push({ id: lease.id, reason: lease.pid === undefined ? 'expired' : 'deadProcess' });
    return false;
  });
  if (reclaimed.length > 0) {
    const prior = store.reclaimTelemetry ?? emptyReclaimTelemetry();
    store.reclaimTelemetry = {
      total: prior.total + reclaimed.length,
      expired: prior.expired + reclaimed.filter((item) => item.reason === 'expired').length,
      deadProcess:
        prior.deadProcess + reclaimed.filter((item) => item.reason === 'deadProcess').length,
      lastReclaimedAt: new Date(now).toISOString(),
      lastReclaimedLeaseIds: reclaimed.map((item) => item.id),
    };
  }
  return store.reclaimTelemetry ?? emptyReclaimTelemetry();
}

function countKind(store: ResourceStore, kind: ResourceKind): number {
  return store.leases.filter((lease) => lease.kind === kind).length;
}

function telemetry(
  store: ResourceStore,
  memoryAvailable = availableMemoryPercent(),
  limits = currentResourceLimits(),
): ResourceTelemetry {
  return {
    workers: { active: countKind(store, 'worker'), limit: limits.workers },
    browsers: { active: countKind(store, 'browser'), limit: limits.browsers },
    builds: { active: countKind(store, 'build'), limit: limits.builds },
    total: { active: store.leases.length, limit: limits.total },
    queued: store.queue.length,
    memoryAvailablePercent: memoryAvailable,
    memorySoftFloorPercent: limits.softMemoryAvailablePercent,
    reclaims: { ...(store.reclaimTelemetry ?? emptyReclaimTelemetry()) },
  };
}

function capacityReason(
  store: ResourceStore,
  kind: ResourceKind,
  memoryAvailable: number,
  limits = currentResourceLimits(),
): string | undefined {
  if (memoryAvailable < limits.softMemoryAvailablePercent) {
    return `memory available ${memoryAvailable}% is below the ${limits.softMemoryAvailablePercent}% soft floor`;
  }
  if (store.leases.length >= limits.total)
    return `global active resource cap ${limits.total} reached`;
  const kindLimit =
    kind === 'worker' ? limits.workers : kind === 'browser' ? limits.browsers : limits.builds;
  if (countKind(store, kind) >= kindLimit) return `${kind} cap ${kindLimit} reached`;
  return undefined;
}

function leaseFrom(request: QueuedResourceRequest, now = Date.now()): ResourceLease {
  return {
    id: `lease_${randomUUID()}`,
    taskId: request.taskId,
    resourceId: request.resourceId,
    fencingToken: request.fencingToken,
    kind: request.kind,
    owner: request.owner,
    depth: request.depth,
    createdAt: new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
    ttlMs: request.ttlMs,
    expiresAt: new Date(now + request.ttlMs).toISOString(),
    graceMs: RESOURCE_RECLAIM_GRACE_MS,
    reclaimAfter: new Date(now + request.ttlMs + RESOURCE_RECLAIM_GRACE_MS).toISOString(),
    ...(request.project ? { project: request.project } : {}),
    ...(request.parentLeaseId ? { parentLeaseId: request.parentLeaseId } : {}),
    ...(request.pid !== undefined ? { pid: request.pid } : {}),
  };
}

function promoteQueued(
  store: ResourceStore,
  memoryAvailable: number,
  limits = currentResourceLimits(),
): void {
  for (let index = 0; index < store.queue.length;) {
    const request = store.queue[index]!;
    if (
      request.parentLeaseId &&
      !store.leases.some((lease) => lease.id === request.parentLeaseId)
    ) {
      store.queue.splice(index, 1);
      continue;
    }
    if (capacityReason(store, request.kind, memoryAvailable, limits)) break;
    store.queue.splice(index, 1);
    store.leases.push(leaseFrom(request));
  }
}

function requestDepth(
  store: ResourceStore,
  kind: ResourceKind,
  parentLeaseId: string | undefined,
  limits = currentResourceLimits(),
): { depth: number; rejection?: string } {
  if (!parentLeaseId) return { depth: 0 };
  if (kind !== 'worker')
    return { depth: 0, rejection: 'only worker leases may have a parent lease' };
  const parent = store.leases.find((lease) => lease.id === parentLeaseId);
  if (!parent || parent.kind !== 'worker') {
    return { depth: 0, rejection: `parent worker lease is not active: ${parentLeaseId}` };
  }
  const depth = parent.depth + 1;
  if (depth > limits.maxSubagentDepth) {
    return {
      depth,
      rejection: `subagent depth ${depth} exceeds hard cap ${limits.maxSubagentDepth}; leaf workers cannot delegate`,
    };
  }
  return { depth };
}

export function requestResource(input: {
  kind: ResourceKind;
  owner: string;
  taskId?: string;
  resourceId?: string;
  project?: string;
  parentLeaseId?: string;
  pid?: number;
  ttlMs?: number;
}): ResourceRequestResult {
  if (input.ttlMs !== undefined && (!Number.isFinite(input.ttlMs) || input.ttlMs <= 0)) {
    throw new Error('resource lease TTL must be greater than zero');
  }
  return withStoreLock((store) => {
    const memoryAvailable = availableMemoryPercent();
    const limits = currentResourceLimits();
    prune(store);
    promoteQueued(store, memoryAvailable, limits);
    const existing = store.leases.find(
      (lease) => lease.kind === input.kind && lease.owner === input.owner,
    );
    if (existing)
      return {
        status: 'active',
        lease: existing,
        telemetry: telemetry(store, memoryAvailable, limits),
      };
    const queued = store.queue.find(
      (request) => request.kind === input.kind && request.owner === input.owner,
    );
    if (queued)
      return {
        status: 'queued',
        request: queued,
        telemetry: telemetry(store, memoryAvailable, limits),
      };

    const parentLeaseId = input.parentLeaseId ?? process.env.MAJOR_RESOURCE_LEASE_ID;
    const depth = requestDepth(store, input.kind, parentLeaseId);
    if (depth.rejection) {
      return {
        status: 'rejected',
        reason: depth.rejection,
        telemetry: telemetry(store, memoryAvailable, limits),
      };
    }
    const request: QueuedResourceRequest = {
      id: `request_${randomUUID()}`,
      taskId: input.taskId ?? fallbackTaskId(input.owner),
      resourceId: input.resourceId ?? fallbackResourceId(input.kind, input.project),
      fencingToken: `fence_${randomUUID()}`,
      kind: input.kind,
      owner: input.owner,
      depth: depth.depth,
      ttlMs: input.ttlMs ?? DEFAULT_TTL_MS[input.kind],
      requestedAt: new Date().toISOString(),
      reason: '',
      ...(input.project ? { project: input.project } : {}),
      ...(parentLeaseId ? { parentLeaseId } : {}),
      ...(input.pid !== undefined ? { pid: input.pid } : {}),
    };
    const reason = capacityReason(store, input.kind, memoryAvailable, limits);
    if (reason) {
      request.reason = reason;
      store.queue.push(request);
      return {
        status: 'queued',
        request,
        telemetry: telemetry(store, memoryAvailable, limits),
      };
    }
    const lease = leaseFrom(request);
    store.leases.push(lease);
    return { status: 'active', lease, telemetry: telemetry(store, memoryAvailable, limits) };
  });
}

export function resourceSnapshot(): {
  leases: ResourceLease[];
  queue: QueuedResourceRequest[];
  telemetry: ResourceTelemetry;
} {
  return withStoreLock((store) => {
    const memoryAvailable = availableMemoryPercent();
    const limits = currentResourceLimits();
    prune(store);
    promoteQueued(store, memoryAvailable, limits);
    return {
      leases: [...store.leases],
      queue: [...store.queue],
      telemetry: telemetry(store, memoryAvailable, limits),
    };
  });
}

/** Explicit supported repair path. Reclamation and queue promotion are one
 * locked transaction, so a concurrent heartbeat cannot lose its lease between
 * classification and removal. */
export function reclaimStaleResources(): {
  reclaimedLeaseIds: string[];
  telemetry: ResourceTelemetry;
} {
  return withStoreLock((store) => {
    const before = store.reclaimTelemetry?.total ?? 0;
    const memoryAvailable = availableMemoryPercent();
    const limits = currentResourceLimits();
    const reclaims = prune(store);
    promoteQueued(store, memoryAvailable, limits);
    return {
      reclaimedLeaseIds: reclaims.total > before ? [...reclaims.lastReclaimedLeaseIds] : [],
      telemetry: telemetry(store, memoryAvailable, limits),
    };
  });
}

/** Exact active capacity fence used by staged validation admission. */
export function assertActiveResourceLease(input: {
  leaseId: string;
  fencingToken: string;
  kind: ResourceKind;
  owner: string;
  pid: number;
}): ResourceLease {
  return withStoreLock((store) => {
    prune(store);
    const lease = store.leases.find((candidate) => candidate.id === input.leaseId);
    if (
      !lease ||
      !leaseIsActive(lease) ||
      lease.fencingToken !== input.fencingToken ||
      lease.kind !== input.kind ||
      lease.owner !== input.owner ||
      lease.pid !== input.pid
    ) {
      throw new Error(`resource lease is not the active ${input.kind} fence: ${input.leaseId}`);
    }
    return { ...lease };
  });
}

/** Active process fence for a supervised Workshop run whose random owner is not authority. */
export function assertActiveResourceLeaseForProcess(input: {
  leaseId: string;
  fencingToken: string;
  kind: ResourceKind;
  pid: number;
}): ResourceLease {
  return withStoreLock((store) => {
    prune(store);
    const lease = store.leases.find((candidate) => candidate.id === input.leaseId);
    if (
      !lease ||
      !leaseIsActive(lease) ||
      lease.fencingToken !== input.fencingToken ||
      lease.kind !== input.kind ||
      lease.pid !== input.pid
    ) {
      throw new Error(
        `resource lease is not the active ${input.kind} process fence: ${input.leaseId}`,
      );
    }
    return { ...lease };
  });
}

export function heartbeatResource(
  leaseId: string,
  fencingToken: string,
  ttlMs?: number,
): ResourceLease {
  return withStoreLock((store) => {
    prune(store);
    const lease = store.leases.find((candidate) => candidate.id === leaseId);
    if (!lease || lease.fencingToken !== fencingToken) {
      throw new Error(`resource lease is not active: ${leaseId}`);
    }
    const now = Date.now();
    const nextTtlMs = ttlMs ?? lease.ttlMs ?? DEFAULT_TTL_MS[lease.kind];
    lease.heartbeatAt = new Date(now).toISOString();
    lease.ttlMs = nextTtlMs;
    lease.expiresAt = new Date(now + nextTtlMs).toISOString();
    lease.graceMs = lease.graceMs ?? RESOURCE_RECLAIM_GRACE_MS;
    lease.reclaimAfter = new Date(now + nextTtlMs + lease.graceMs).toISOString();
    return { ...lease };
  });
}

export function releaseResource(leaseId: string, fencingToken: string): ResourceTelemetry {
  return withStoreLock((store) => {
    prune(store);
    const lease = store.leases.find((candidate) => candidate.id === leaseId);
    if (!lease || lease.fencingToken !== fencingToken) {
      throw new Error(`resource lease is not the current fence: ${leaseId}`);
    }
    if (store.leases.some((lease) => lease.parentLeaseId === leaseId)) {
      throw new Error(`resource lease ${leaseId} still owns an active child worker`);
    }
    store.leases = store.leases.filter((lease) => lease.id !== leaseId);
    const memoryAvailable = availableMemoryPercent();
    const limits = currentResourceLimits();
    promoteQueued(store, memoryAvailable, limits);
    return telemetry(store, memoryAvailable, limits);
  });
}

export function cancelResourceRequest(requestId: string): ResourceTelemetry {
  return withStoreLock((store) => {
    prune(store);
    store.queue = store.queue.filter((request) => request.id !== requestId);
    const memoryAvailable = availableMemoryPercent();
    const limits = currentResourceLimits();
    promoteQueued(store, memoryAvailable, limits);
    return telemetry(store, memoryAvailable, limits);
  });
}

export async function waitForResource(
  request: QueuedResourceRequest,
  timeoutMs = 30 * 60 * 1000,
): Promise<ResourceLease> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = resourceSnapshot();
    const lease = snapshot.leases.find(
      (candidate) =>
        candidate.fencingToken === request.fencingToken &&
        candidate.owner === request.owner &&
        candidate.kind === request.kind,
    );
    if (lease) return lease;
    if (!snapshot.queue.some((candidate) => candidate.id === request.id)) {
      throw new Error(`queued resource request is no longer active: ${request.id}`);
    }
    if (Date.now() >= deadline) {
      cancelResourceRequest(request.id);
      throw new Error(`timed out waiting for Major resource capacity: ${request.id}`);
    }
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 250));
  }
}

export function formatResourceTelemetry(value: ResourceTelemetry): string {
  return [
    `workers: ${value.workers.active}/${value.workers.limit}`,
    `browsers: ${value.browsers.active}/${value.browsers.limit}`,
    `builds: ${value.builds.active}/${value.builds.limit}`,
    `total: ${value.total.active}/${value.total.limit}`,
    `queued: ${value.queued}`,
    `memory available: ${value.memoryAvailablePercent}% (soft floor ${value.memorySoftFloorPercent}%)`,
    `reclaimed: ${value.reclaims.total} (expired ${value.reclaims.expired}, dead process ${value.reclaims.deadProcess})`,
  ].join('\n');
}

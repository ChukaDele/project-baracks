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
import { freemem, totalmem } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { readSystemMemoryAvailablePercent } from '../security/major-gateway.js';
import { majorHome } from './state.js';

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
  // v0.5.1 has one shared Lima instance and therefore one safe worker slot.
  workers: 1,
  browsers: 2,
  builds: 1,
  maxSubagentDepth: 1,
  softMemoryAvailablePercent: 25,
};

export interface ResourceLease {
  id: string;
  kind: ResourceKind;
  owner: string;
  project?: string | undefined;
  parentLeaseId?: string | undefined;
  depth: number;
  pid?: number | undefined;
  createdAt: string;
  heartbeatAt: string;
  expiresAt: string;
}

export interface QueuedResourceRequest {
  id: string;
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
}

export interface ResourceTelemetry {
  workers: { active: number; limit: number };
  browsers: { active: number; limit: number };
  builds: { active: number; limit: number };
  total: { active: number; limit: number };
  queued: number;
  memoryAvailablePercent: number;
  memorySoftFloorPercent: number;
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
const LOCK_TIMEOUT_MS = 5_000;
const STALE_LOCK_MS = 30_000;
const sleepArray = new Int32Array(new SharedArrayBuffer(4));

function storePath(): string {
  return process.env.MAJOR_RESOURCE_PATH
    ? resolve(process.env.MAJOR_RESOURCE_PATH)
    : join(majorHome(), 'resource-state.json');
}

function emptyStore(): ResourceStore {
  return { version: 1, leases: [], queue: [] };
}

function readStore(): ResourceStore {
  const path = storePath();
  if (!existsSync(path)) return emptyStore();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as ResourceStore;
  if (parsed.version !== 1 || !Array.isArray(parsed.leases) || !Array.isArray(parsed.queue)) {
    throw new Error(`invalid Major resource store: ${path}`);
  }
  return parsed;
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
  } catch {
    return false;
  }
}

export function availableMemoryPercent(): number {
  const override = Number.parseFloat(process.env.MAJOR_MEMORY_AVAILABLE_PERCENT ?? '');
  if (Number.isFinite(override)) return Math.max(0, Math.min(100, override));
  const system = readSystemMemoryAvailablePercent();
  if (system !== undefined) return system;
  return Math.round((freemem() / totalmem()) * 100);
}

function prune(store: ResourceStore, now = Date.now()): void {
  store.leases = store.leases.filter((lease) => {
    if (Date.parse(lease.expiresAt) <= now) return false;
    return lease.pid === undefined || pidAlive(lease.pid);
  });
}

function countKind(store: ResourceStore, kind: ResourceKind): number {
  return store.leases.filter((lease) => lease.kind === kind).length;
}

function telemetry(
  store: ResourceStore,
  memoryAvailable = availableMemoryPercent(),
  limits = GLOBAL_RESOURCE_LIMITS,
): ResourceTelemetry {
  return {
    workers: { active: countKind(store, 'worker'), limit: limits.workers },
    browsers: { active: countKind(store, 'browser'), limit: limits.browsers },
    builds: { active: countKind(store, 'build'), limit: limits.builds },
    total: { active: store.leases.length, limit: limits.total },
    queued: store.queue.length,
    memoryAvailablePercent: memoryAvailable,
    memorySoftFloorPercent: limits.softMemoryAvailablePercent,
  };
}

function capacityReason(
  store: ResourceStore,
  kind: ResourceKind,
  memoryAvailable: number,
  limits = GLOBAL_RESOURCE_LIMITS,
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
    kind: request.kind,
    owner: request.owner,
    depth: request.depth,
    createdAt: new Date(now).toISOString(),
    heartbeatAt: new Date(now).toISOString(),
    expiresAt: new Date(now + request.ttlMs).toISOString(),
    ...(request.project ? { project: request.project } : {}),
    ...(request.parentLeaseId ? { parentLeaseId: request.parentLeaseId } : {}),
    ...(request.pid !== undefined ? { pid: request.pid } : {}),
  };
}

function promoteQueued(
  store: ResourceStore,
  memoryAvailable: number,
  limits = GLOBAL_RESOURCE_LIMITS,
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
  limits = GLOBAL_RESOURCE_LIMITS,
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
  project?: string;
  parentLeaseId?: string;
  pid?: number;
  ttlMs?: number;
}): ResourceRequestResult {
  return withStoreLock((store) => {
    const memoryAvailable = availableMemoryPercent();
    prune(store);
    promoteQueued(store, memoryAvailable);
    const existing = store.leases.find(
      (lease) => lease.kind === input.kind && lease.owner === input.owner,
    );
    if (existing)
      return { status: 'active', lease: existing, telemetry: telemetry(store, memoryAvailable) };
    const queued = store.queue.find(
      (request) => request.kind === input.kind && request.owner === input.owner,
    );
    if (queued)
      return { status: 'queued', request: queued, telemetry: telemetry(store, memoryAvailable) };

    const parentLeaseId = input.parentLeaseId ?? process.env.MAJOR_RESOURCE_LEASE_ID;
    const depth = requestDepth(store, input.kind, parentLeaseId);
    if (depth.rejection) {
      return {
        status: 'rejected',
        reason: depth.rejection,
        telemetry: telemetry(store, memoryAvailable),
      };
    }
    const request: QueuedResourceRequest = {
      id: `request_${randomUUID()}`,
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
    const reason = capacityReason(store, input.kind, memoryAvailable);
    if (reason) {
      request.reason = reason;
      store.queue.push(request);
      return { status: 'queued', request, telemetry: telemetry(store, memoryAvailable) };
    }
    const lease = leaseFrom(request);
    store.leases.push(lease);
    return { status: 'active', lease, telemetry: telemetry(store, memoryAvailable) };
  });
}

export function resourceSnapshot(): {
  leases: ResourceLease[];
  queue: QueuedResourceRequest[];
  telemetry: ResourceTelemetry;
} {
  return withStoreLock((store) => {
    const memoryAvailable = availableMemoryPercent();
    prune(store);
    promoteQueued(store, memoryAvailable);
    return {
      leases: [...store.leases],
      queue: [...store.queue],
      telemetry: telemetry(store, memoryAvailable),
    };
  });
}

export function heartbeatResource(leaseId: string, ttlMs?: number): ResourceLease {
  return withStoreLock((store) => {
    prune(store);
    const lease = store.leases.find((candidate) => candidate.id === leaseId);
    if (!lease) throw new Error(`resource lease is not active: ${leaseId}`);
    const now = Date.now();
    lease.heartbeatAt = new Date(now).toISOString();
    lease.expiresAt = new Date(now + (ttlMs ?? DEFAULT_TTL_MS[lease.kind])).toISOString();
    return { ...lease };
  });
}

export function releaseResource(leaseId: string): ResourceTelemetry {
  return withStoreLock((store) => {
    prune(store);
    if (store.leases.some((lease) => lease.parentLeaseId === leaseId)) {
      throw new Error(`resource lease ${leaseId} still owns an active child worker`);
    }
    store.leases = store.leases.filter((lease) => lease.id !== leaseId);
    const memoryAvailable = availableMemoryPercent();
    promoteQueued(store, memoryAvailable);
    return telemetry(store, memoryAvailable);
  });
}

export function cancelResourceRequest(requestId: string): ResourceTelemetry {
  return withStoreLock((store) => {
    prune(store);
    store.queue = store.queue.filter((request) => request.id !== requestId);
    const memoryAvailable = availableMemoryPercent();
    promoteQueued(store, memoryAvailable);
    return telemetry(store, memoryAvailable);
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
      (candidate) => candidate.owner === request.owner && candidate.kind === request.kind,
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
  ].join('\n');
}

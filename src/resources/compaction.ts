import { existsSync, statSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import type { ClassifiedResource } from './inventory.js';

/**
 * Paths and kinds that must never be compacted, compressed or rewritten.
 * major.db, credentials, provider auth, the active VM and the active release
 * stay untouched even under aggressive cleanup.
 */
export const COMPACTION_EXCLUSIONS = [
  'major.db',
  'credentials',
  'provider-auth',
  'active-vm',
  'active-release',
] as const;

export type CompactionExclusion = (typeof COMPACTION_EXCLUSIONS)[number];

const EXCLUDED_BASENAMES = new Set(['major.db', 'credentials', 'provider-auth']);

export function compactionExclusionFor(
  resource: ClassifiedResource,
): CompactionExclusion | undefined {
  if (resource.class === 'active') {
    return resource.kind === 'lima-instance' ? 'active-vm' : 'active-release';
  }
  const base = resource.path ? basename(resource.path) : resource.identity;
  if (base === 'major.db' || resource.identity === 'major.db') return 'major.db';
  if (base === 'credentials' || resource.identity.includes('credential')) return 'credentials';
  if (base === 'provider-auth' || resource.identity.includes('provider-auth')) {
    return 'provider-auth';
  }
  if (EXCLUDED_BASENAMES.has(base)) return base as CompactionExclusion;
  return undefined;
}

export function assertCompactable(resource: ClassifiedResource): void {
  const exclusion = compactionExclusionFor(resource);
  if (exclusion) {
    throw new Error(`refusing to compact protected resource (${exclusion}): ${resource.id}`);
  }
  if (
    resource.class === 'rollback' ||
    resource.class === 'credential-bearing' ||
    resource.class === 'unknown'
  ) {
    throw new Error(`refusing to compact protected class ${resource.class}: ${resource.id}`);
  }
  if (resource.class !== 'cold-archive') {
    throw new Error(`compaction is only for cold-archive resources: ${resource.id}`);
  }
  const allowed =
    resource.kind === 'release-snapshot' ||
    resource.kind === 'log' ||
    resource.kind === 'cache' ||
    resource.kind === 'diagnostic-artifact';
  if (!allowed) {
    throw new Error(`compaction is not allowed for kind ${resource.kind}: ${resource.id}`);
  }
}

/** True when this resource already has a non-empty archive beside it. */
export function alreadyCompacted(resource: ClassifiedResource): boolean {
  if (!resource.path) return false;
  const archive = compactionArchivePath(resource.path);
  try {
    return existsSync(archive) && statSync(archive).size > 0;
  } catch {
    return false;
  }
}

export function isCompactable(resource: ClassifiedResource): boolean {
  try {
    assertCompactable(resource);
  } catch {
    return false;
  }
  // Work remains while the original tree is still on disk, even if an archive
  // already exists beside it: that is a half-finished compaction and the
  // reclaim step still has to run. Idempotence belongs to the ARCHIVE step
  // (see alreadyCompacted), not to compaction as a whole -- gating the whole
  // operation on archive presence left archive+original pairs forever.
  return Boolean(resource.path) && existsSync(resource.path!);
}

/** Archive a cold immutable tree with tar.gz. Original stays until the caller removes it. */
export function archiveColdResource(
  resource: ClassifiedResource,
  archive: (path: string) => string,
): string {
  assertCompactable(resource);
  if (!resource.path) throw new Error(`cold archive has no path: ${resource.id}`);
  return archive(resource.path);
}

export function compactionArchivePath(path: string): string {
  return join(dirname(path), `${basename(path)}.tar.gz`);
}

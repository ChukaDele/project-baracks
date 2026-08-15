import { createHash } from 'node:crypto';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalize } from '../security/paths.js';
import type { CapabilityCandidate, CapabilityVerificationArtifact } from './registry.js';

export const LOCAL_CATALOG_VALIDATOR = 'toolsmith-internal-verifier-v1';
export const RUNTIME_ADAPTER_REFERENCE = 'src/security/paths.ts#canonicalize';

function runtimeAdapterPath(): string {
  const compiled = fileURLToPath(new URL('../security/paths.js', import.meta.url));
  if (existsSync(compiled)) return compiled;
  return fileURLToPath(new URL('../security/paths.ts', import.meta.url));
}

export function runtimeAdapterRevision(): string {
  return createHash('sha256').update(readFileSync(runtimeAdapterPath())).digest('hex');
}

/** Independent deterministic verifier for the small, process-free local
 * catalogue. It accepts one exact source contract and no dynamic command. */
export function verifyRuntimeAdapter(repoPath: string): CapabilityVerificationArtifact {
  const fixture = resolve(repoPath);
  let expected = '';
  let actual = '';
  let error = '';
  try {
    expected = realpathSync(fixture);
    actual = canonicalize(repoPath);
  } catch (cause) {
    error = cause instanceof Error ? cause.message : String(cause);
  }
  return {
    operation: 'canonicalize-local-path',
    fixture: { repository: fixture },
    expected: { canonicalPath: expected, mutatesWorktree: false },
    actual: { canonicalPath: actual || null, error: error || null },
    validator: LOCAL_CATALOG_VALIDATOR,
    environment: { platform: process.platform },
    security: { permissions: ['read local filesystem metadata'], mutationsObserved: false },
    passed: actual === expected,
  };
}

export function isCapabilitySourceCurrent(
  capability: { source: CapabilityCandidate['source'] },
  repoPath: string,
): boolean {
  void repoPath;
  if (capability.source.kind !== 'internal_adapter' || !capability.source.revision) return true;
  return (
    capability.source.reference === RUNTIME_ADAPTER_REFERENCE &&
    existsSync(runtimeAdapterPath()) &&
    capability.source.revision === runtimeAdapterRevision()
  );
}

import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

/** True when `target` resolves inside one of the configured project roots. */
export function isWithinRoots(target: string, roots: readonly string[]): boolean {
  const resolved = resolve(target);
  return roots.some((root) => {
    const rel = relative(resolve(root), resolved);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  });
}

export class PathViolationError extends Error {
  constructor(
    readonly target: string,
    detail?: string,
  ) {
    super(detail ?? `path outside configured project roots: ${target}`);
    this.name = 'PathViolationError';
  }
}

/** Subprocesses and file operations must stay inside configured project roots. */
export function assertWithinRoots(target: string, roots: readonly string[]): void {
  if (!isWithinRoots(target, roots)) throw new PathViolationError(target);
}

/**
 * Resolve a path to its canonical form (symlinks followed, `..` collapsed).
 * The path must exist: containment decisions are only made about real
 * filesystem locations, never about strings.
 */
export function canonicalize(target: string): string {
  try {
    return realpathSync(resolve(target));
  } catch {
    throw new PathViolationError(target, `path does not exist or cannot be resolved: ${target}`);
  }
}

/**
 * Canonical containment check: both the target and every root are resolved
 * with realpath before comparison, so symlinks inside a root that point
 * outside it, and `..` traversal, cannot escape.
 */
export function assertWithinRootsCanonical(target: string, roots: readonly string[]): string {
  if (roots.length === 0) {
    throw new PathViolationError(target, 'no allowed project roots configured');
  }
  const canonicalTarget = canonicalize(target);
  const canonicalRoots = roots.map((root) => canonicalize(root));
  if (!isWithinRoots(canonicalTarget, canonicalRoots)) {
    throw new PathViolationError(target, `path escapes configured project roots: ${target}`);
  }
  return canonicalTarget;
}

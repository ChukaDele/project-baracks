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
  constructor(readonly target: string) {
    super(`path outside configured project roots: ${target}`);
    this.name = 'PathViolationError';
  }
}

/** Subprocesses and file operations must stay inside configured project roots. */
export function assertWithinRoots(target: string, roots: readonly string[]): void {
  if (!isWithinRoots(target, roots)) throw new PathViolationError(target);
}

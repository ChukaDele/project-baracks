import { accessSync, constants, statSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { canonicalize, PathViolationError } from './paths.js';

/**
 * Trusted canonical executable registry. The execution gateway only ever
 * spawns executables whose identity was bound here first: a registration
 * resolves the path to its canonical (realpath) form and verifies it is a
 * real, executable regular file. At spawn time the gateway resolves the
 * requested executable through this registry, so a same-basename binary at
 * any other location can never be executed.
 *
 * Trust enters the registry in exactly two ways:
 *  - `pin()`    — an explicitly configured installation path (user/project
 *                 configuration), canonicalised and validated;
 *  - `discover()` — a PATH lookup performed by the supervisor itself over a
 *                 supervisor-controlled PATH value (never a child's).
 */

export type TrustSource = 'pinned' | 'discovered';

export interface TrustedExecutable {
  /** Policy identity: the allowlist name (basename) this binding answers for. */
  name: string;
  /** The path to spawn (may be an npm shim/symlink; kept spawnable as-is). */
  spawnPath: string;
  /** Canonical realpath identity used for verification. */
  canonicalPath: string;
  source: TrustSource;
}

export class ExecutableTrustError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ExecutableTrustError';
  }
}

function basename(path: string): string {
  return path.split('/').at(-1) ?? path;
}

/** True when the path names an existing regular file this process may execute. */
function isExecutableFile(path: string): boolean {
  try {
    if (!statSync(path).isFile()) return false;
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export class TrustedExecutableRegistry {
  private readonly byName = new Map<string, TrustedExecutable>();

  /** Bind `name` to a validated installation path. Idempotent for the same
   * canonical identity; re-binding a name to a DIFFERENT binary is refused. */
  trust(name: string, path: string, source: TrustSource): TrustedExecutable {
    let canonicalPath: string;
    try {
      canonicalPath = canonicalize(path);
    } catch (error) {
      throw new ExecutableTrustError(
        error instanceof PathViolationError
          ? `cannot trust ${name}: ${error.message}`
          : `cannot trust ${name}: ${path} is not resolvable`,
      );
    }
    if (!isExecutableFile(canonicalPath)) {
      throw new ExecutableTrustError(
        `cannot trust ${name}: ${path} is not an executable regular file`,
      );
    }
    const existing = this.byName.get(name);
    if (existing && existing.canonicalPath !== canonicalPath) {
      throw new ExecutableTrustError(
        `refusing to re-bind ${name}: already trusted at ${existing.canonicalPath}, ` +
          `not ${canonicalPath}`,
      );
    }
    const entry: TrustedExecutable = { name, spawnPath: path, canonicalPath, source };
    this.byName.set(name, entry);
    return entry;
  }

  /** Explicitly configured installation path (the name is its basename). */
  pin(path: string): TrustedExecutable {
    return this.trust(basename(path), path, 'pinned');
  }

  /**
   * Supervisor-side PATH lookup (replaces spawning `which`): scan the given
   * PATH value for an executable regular file named `name` and trust the
   * first hit. Returns undefined when the executable is not installed.
   */
  discover(name: string, pathValue: string | undefined): TrustedExecutable | undefined {
    const existing = this.byName.get(name);
    if (existing) return existing;
    if (name.includes('/') || !pathValue) return undefined;
    for (const dir of pathValue.split(delimiter)) {
      if (!dir) continue;
      const candidate = join(dir, name);
      if (isExecutableFile(candidate)) {
        return this.trust(name, candidate, 'discovered');
      }
    }
    return undefined;
  }

  get(name: string): TrustedExecutable | undefined {
    return this.byName.get(name);
  }

  /**
   * Verify a requested executable against the registry: the name must have a
   * trusted binding, and a path-qualified request must resolve (realpath) to
   * the trusted canonical identity. Returns the binding whose spawnPath is
   * the only thing the gateway may execute.
   */
  verify(requested: string): TrustedExecutable {
    const name = basename(requested);
    const entry = this.byName.get(name);
    if (!entry) {
      throw new ExecutableTrustError(`no trusted installation registered for executable: ${name}`);
    }
    if (requested.includes('/')) {
      let canonical: string;
      try {
        canonical = canonicalize(requested);
      } catch {
        throw new ExecutableTrustError(`executable does not exist: ${requested}`);
      }
      if (canonical !== entry.canonicalPath) {
        throw new ExecutableTrustError(
          `executable ${requested} (${canonical}) does not match the trusted canonical ` +
            `installation of ${name} (${entry.canonicalPath})`,
        );
      }
    }
    return entry;
  }
}

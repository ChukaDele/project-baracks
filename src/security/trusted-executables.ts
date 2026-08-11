import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { delimiter, dirname, join } from 'node:path';
import { canonicalize, PathViolationError } from './paths.js';

/**
 * Trusted canonical executable registry. The execution gateway only ever
 * spawns executables whose identity was bound here first: a registration
 * resolves the path to its canonical (realpath) form, verifies it is a real,
 * executable regular file, and captures a STABLE IDENTITY (device, inode,
 * size, mtime and a content hash). At spawn time the gateway resolves the
 * requested executable through this registry and REVALIDATES that identity, so
 * a same-basename binary at another location, a replacement at the same path,
 * or an in-place mutation between discovery and spawn is refused (fail closed).
 *
 * Trust enters the registry in exactly two ways, both supervisor-controlled:
 *  - `pin()`      — an explicitly configured installation path (user/project
 *                   configuration), canonicalised and validated;
 *  - `discover()` — a PATH lookup CONSTRAINED to supervisor-controlled
 *                   directories (`allowedDirs`). PATH ordering never confers
 *                   trust: a candidate outside the allowed directories, however
 *                   early on PATH, is ignored. Without configured allowedDirs,
 *                   discovery trusts nothing.
 */

export type TrustSource = 'pinned' | 'discovered';

/** Stable identity of a binary, captured at trust and rechecked at spawn. */
export interface ExecutableIdentity {
  dev: number;
  ino: number;
  size: number;
  mtimeMs: number;
  sha256: string;
}

export interface TrustedExecutable {
  /** Policy identity: the allowlist name (basename) this binding answers for. */
  name: string;
  /** The path to spawn (may be an npm shim/symlink; kept spawnable as-is). */
  spawnPath: string;
  /** Canonical realpath identity used for verification. */
  canonicalPath: string;
  source: TrustSource;
  /** Stable identity captured at trust time. */
  identity: ExecutableIdentity;
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

/** Capture the stable identity of a real file (content hash + inode/size/mtime). */
function captureIdentity(canonicalPath: string): ExecutableIdentity {
  const st = statSync(canonicalPath);
  const sha256 = createHash('sha256').update(readFileSync(canonicalPath)).digest('hex');
  return { dev: st.dev, ino: st.ino, size: st.size, mtimeMs: st.mtimeMs, sha256 };
}

export interface RegistryOptions {
  /**
   * Supervisor-controlled directories from which PATH discovery may trust an
   * executable. Canonicalised. When empty/unset, discovery trusts nothing and
   * trust must be pinned explicitly.
   */
  allowedDirs?: readonly string[];
}

export class TrustedExecutableRegistry {
  private readonly byName = new Map<string, TrustedExecutable>();
  private readonly allowedDirs: string[];

  constructor(options: RegistryOptions = {}) {
    this.allowedDirs = (options.allowedDirs ?? []).flatMap((d) => {
      try {
        return [canonicalize(d)];
      } catch {
        return [];
      }
    });
  }

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
    const entry: TrustedExecutable = {
      name,
      spawnPath: path,
      canonicalPath,
      source,
      identity: captureIdentity(canonicalPath),
    };
    this.byName.set(name, entry);
    return entry;
  }

  /** Explicitly configured installation path (the name is its basename). */
  pin(path: string): TrustedExecutable {
    return this.trust(basename(path), path, 'pinned');
  }

  private withinAllowedDirs(canonicalPath: string): boolean {
    if (this.allowedDirs.length === 0) return false;
    const dir = dirname(canonicalPath);
    return this.allowedDirs.includes(dir);
  }

  /**
   * Supervisor-side PATH lookup (replaces spawning `which`): scan the given
   * PATH value for an executable regular file named `name`, but trust it ONLY
   * when its canonical directory is one of the supervisor-controlled
   * allowedDirs. PATH ordering therefore never confers trust; a shadow binary
   * in an unapproved directory is skipped. Returns undefined when no trusted
   * installation is found.
   */
  discover(name: string, pathValue: string | undefined): TrustedExecutable | undefined {
    const existing = this.byName.get(name);
    if (existing) return existing;
    if (name.includes('/') || !pathValue) return undefined;
    for (const dir of pathValue.split(delimiter)) {
      if (!dir) continue;
      const candidate = join(dir, name);
      if (!isExecutableFile(candidate)) continue;
      let canonical: string;
      try {
        canonical = canonicalize(candidate);
      } catch {
        continue;
      }
      if (!this.withinAllowedDirs(canonical)) continue;
      return this.trust(name, candidate, 'discovered');
    }
    return undefined;
  }

  /**
   * Resolve `name` on PATH to its canonical path for REPORTING ONLY (e.g. a
   * doctor `which` line). This confers no execution trust and does not mutate
   * the registry; the returned path must never be spawned by execute().
   */
  resolveForReport(name: string, pathValue: string | undefined): string | undefined {
    if (name.includes('/') || !pathValue) return undefined;
    for (const dir of pathValue.split(delimiter)) {
      if (!dir) continue;
      const candidate = join(dir, name);
      if (isExecutableFile(candidate)) return candidate;
    }
    return undefined;
  }

  get(name: string): TrustedExecutable | undefined {
    return this.byName.get(name);
  }

  /**
   * Verify a requested executable against the registry AT THE SPAWN BOUNDARY:
   *  - the name must have a trusted binding;
   *  - a path-qualified request must realpath-resolve to the trusted canonical
   *    identity (no same-basename shadow);
   *  - the file's stable identity must still match what was trusted — a
   *    replacement or in-place mutation since trust fails closed.
   * Returns the binding whose spawnPath is the only thing the gateway may run.
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
    this.assertUnchanged(entry);
    return entry;
  }

  /** Re-resolve and re-hash the trusted binary at every spawn boundary. */
  private assertUnchanged(entry: TrustedExecutable): void {
    let current: ExecutableIdentity;
    try {
      // Canonical path may itself have been repointed (symlink swap); re-resolve.
      const canonical = canonicalize(entry.spawnPath);
      if (canonical !== entry.canonicalPath) {
        throw new ExecutableTrustError(
          `trusted executable ${entry.name} now resolves to ${canonical}, not ${entry.canonicalPath}`,
        );
      }
      current = captureIdentity(canonical);
    } catch (error) {
      if (error instanceof ExecutableTrustError) throw error;
      throw new ExecutableTrustError(
        `trusted executable ${entry.name} can no longer be validated: ${entry.canonicalPath}`,
      );
    }
    if (current.sha256 !== entry.identity.sha256) {
      throw new ExecutableTrustError(
        `trusted executable ${entry.name} changed since it was trusted ` +
          `(content of ${entry.canonicalPath} no longer matches): refusing to spawn`,
      );
    }
  }
}

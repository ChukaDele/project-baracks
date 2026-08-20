import {
  cpSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readlinkSync,
  realpathSync,
  rmSync,
  readFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

const MAX_ENTRIES = 100_000;
const MAX_BYTES = 2 * 1024 * 1024 * 1024;
const MAX_DEPTH = 128;
const EXCLUDED_NAMES = new Set(['.git', 'node_modules']);

function isExcluded(path: string, root: string): boolean {
  const rel = relative(root, path);
  return rel.split(sep).some((part) => EXCLUDED_NAMES.has(part));
}

export function snapshotWorkspace(source: string, destination: string): void {
  const canonical = realpathSync(source);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  cpSync(canonical, destination, {
    recursive: true,
    dereference: false,
    verbatimSymlinks: true,
    preserveTimestamps: true,
    filter: (path) => !isExcluded(path, canonical),
  });
}

export interface WorkspaceTreeStats {
  entries: number;
  bytes: number;
}

/** Reject output that could make host-side copy-back follow or create unsafe objects. */
export function validateWorkspaceTree(root: string): WorkspaceTreeStats {
  const canonicalRoot = realpathSync(root);
  let entries = 0;
  let bytes = 0;
  const visit = (directory: string, depth: number) => {
    if (depth > MAX_DEPTH) throw new Error('returned workspace exceeds directory depth limit');
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (EXCLUDED_NAMES.has(entry.name)) {
        throw new Error(`returned workspace contains protected path: ${entry.name}`);
      }
      const path = join(directory, entry.name);
      const stat = lstatSync(path);
      entries += 1;
      if (entries > MAX_ENTRIES) throw new Error('returned workspace exceeds entry limit');
      if (stat.isDirectory()) {
        visit(path, depth + 1);
        continue;
      }
      if (stat.isFile()) {
        if (stat.nlink !== 1) throw new Error(`returned workspace contains a hard link: ${path}`);
        bytes += stat.size;
        if (bytes > MAX_BYTES) throw new Error('returned workspace exceeds byte limit');
        continue;
      }
      if (stat.isSymbolicLink()) {
        const target = readlinkSync(path);
        if (isAbsolute(target))
          throw new Error(`returned workspace contains absolute symlink: ${path}`);
        const resolvedTarget = resolve(dirname(path), target);
        if (
          resolvedTarget !== canonicalRoot &&
          !resolvedTarget.startsWith(`${canonicalRoot}${sep}`)
        ) {
          throw new Error(`returned workspace contains escaping symlink: ${path}`);
        }
        continue;
      }
      throw new Error(`returned workspace contains unsupported filesystem object: ${path}`);
    }
  };
  visit(canonicalRoot, 0);
  return { entries, bytes };
}

export function hashWorkspaceTree(root: string): string {
  validateWorkspaceTree(root);
  const canonicalRoot = realpathSync(root);
  const hash = createHash('sha256');
  const visit = (directory: string) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const path = join(directory, entry.name);
      const rel = relative(canonicalRoot, path);
      const stat = lstatSync(path);
      if (stat.isDirectory()) {
        hash.update(`d\0${rel}\0`);
        visit(path);
      } else if (stat.isFile()) {
        hash.update(`f\0${rel}\0${stat.mode & 0o777}\0`);
        hash.update(readFileSync(path));
      } else if (stat.isSymbolicLink()) {
        hash.update(`l\0${rel}\0${readlinkSync(path)}\0`);
      }
    }
  };
  visit(canonicalRoot);
  return hash.digest('hex');
}

/** Hash the host source exactly as the Lima snapshot sees it: .git and
 * node_modules are transport exclusions, while every other file, mode and
 * relative symlink target contributes to the digest. Hard links are refused
 * intentionally because the copy-back validator cannot preserve or safely
 * reason about shared inodes; generated caches must stay in excluded paths. */
export function hashSourceWorkspaceTree(root: string): string {
  const canonicalRoot = realpathSync(root);
  const hash = createHash('sha256');
  let entries = 0;
  let bytes = 0;
  const visit = (directory: string, depth: number) => {
    if (depth > MAX_DEPTH) throw new Error('source workspace exceeds directory depth limit');
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      if (EXCLUDED_NAMES.has(entry.name)) continue;
      const path = join(directory, entry.name);
      const rel = relative(canonicalRoot, path);
      const stat = lstatSync(path);
      entries += 1;
      if (entries > MAX_ENTRIES) throw new Error('source workspace exceeds entry limit');
      if (stat.isDirectory()) {
        hash.update(`d\0${rel}\0`);
        visit(path, depth + 1);
      } else if (stat.isFile()) {
        if (stat.nlink !== 1) throw new Error(`source workspace contains a hard link: ${path}`);
        bytes += stat.size;
        if (bytes > MAX_BYTES) throw new Error('source workspace exceeds byte limit');
        hash.update(`f\0${rel}\0${stat.mode & 0o777}\0`);
        hash.update(readFileSync(path));
      } else if (stat.isSymbolicLink()) {
        hash.update(`l\0${rel}\0${readlinkSync(path)}\0`);
      } else {
        throw new Error(`source workspace contains unsupported filesystem object: ${path}`);
      }
    }
  };
  visit(canonicalRoot, 0);
  return hash.digest('hex');
}

export function clearRunDirectory(path: string): void {
  if (basename(path).length < 16) throw new Error(`refusing unsafe run cleanup path: ${path}`);
  rmSync(path, { recursive: true, force: true });
}

import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import Database from 'better-sqlite3';
import { trustedMajorHome } from '#trust-roots';
import { defaultDbPath, stateBackupRoot } from './client.js';
import { statePath } from '../supervisor/state.js';
import { policyPath } from '../supervisor/policy.js';

export const STATE_BACKUP_KEEP = 14;

export interface StateBackupOptions {
  home?: string;
  dbPath?: string;
  files?: string[];
  keep?: number;
  now?: Date;
}

/**
 * Snapshot major.db (consistent VACUUM INTO copy) plus the supervisor state and
 * project policy JSON into <home>/backups/state/<UTC timestamp>/, then prune to
 * the newest `keep` snapshots. Returns the snapshot directory.
 */
export function backupState(options: StateBackupOptions = {}): string {
  const root = stateBackupRoot(options.home ?? trustedMajorHome());
  const stamp = (options.now ?? new Date()).toISOString().replace(/[:.]/g, '-');
  const dir = join(root, stamp);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(join(root, '..'), 0o700);
  chmodSync(root, 0o700);
  chmodSync(dir, 0o700);

  const dbPath = options.dbPath ?? defaultDbPath();
  if (existsSync(dbPath)) {
    const target = join(dir, 'major.db');
    const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      sqlite.prepare('VACUUM INTO ?').run(target);
    } finally {
      sqlite.close();
    }
    chmodSync(target, 0o600);
  }
  for (const file of options.files ?? [statePath(), policyPath()]) {
    if (!existsSync(file)) continue;
    const target = join(dir, basename(file));
    copyFileSync(file, target);
    chmodSync(target, 0o600);
  }

  const keep = options.keep ?? STATE_BACKUP_KEEP;
  for (const old of readdirSync(root).sort().slice(0, -keep)) {
    rmSync(join(root, old), { recursive: true, force: true });
  }
  return dir;
}

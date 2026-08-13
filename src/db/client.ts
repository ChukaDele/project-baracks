import { mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import * as schema from './schema.js';

export type Db = BetterSQLite3Database<typeof schema>;

/**
 * A live connection or an open transaction on one. Service functions accept
 * this so transactional flows (claiming, approval, transitions) can compose
 * inside a single BEGIN IMMEDIATE transaction.
 */
export type DbConn = Db | Parameters<Parameters<Db['transaction']>[0]>[0];

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

export function defaultDbPath(): string {
  return process.env.MAJOR_DB_PATH ?? join(homedir(), '.major', 'major.db');
}

export function openDb(path: string = defaultDbPath()): { db: Db; sqlite: Database.Database } {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const sqlite = new Database(path);
  sqlite.function('sha256', { deterministic: true }, (value: string) =>
    createHash('sha256').update(value).digest('hex'),
  );
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('busy_timeout = 5000');
  const db = drizzle(sqlite, { schema });
  // Migrations rebuild tables (SQLite has no ALTER for constraints), which
  // requires foreign keys off; integrity is verified before re-enabling.
  sqlite.pragma('foreign_keys = OFF');
  migrate(db, { migrationsFolder: MIGRATIONS_FOLDER });
  const violations = sqlite.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    sqlite.close();
    throw new Error(`migration left foreign-key violations: ${JSON.stringify(violations)}`);
  }
  sqlite.pragma('foreign_keys = ON');
  return { db, sqlite };
}

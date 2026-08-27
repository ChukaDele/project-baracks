import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { defaultDbPath, openDb } from '../src/db/client.js';
import { tempDbPath } from './helpers.js';

const MIGRATIONS_DIR = join(import.meta.dirname, '..', 'drizzle');

function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
}

/** Apply one migration file raw, the way a partially-migrated DB would look. */
function applyRaw(sqlite: Database.Database, file: string) {
  const sql = readFileSync(join(MIGRATIONS_DIR, file), 'utf8');
  for (const statement of sql.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) sqlite.exec(trimmed);
  }
}

describe('migrations', () => {
  it('keeps the default database inside an explicitly selected Major home', () => {
    const priorMajorHome = process.env.MAJOR_HOME;
    const priorDbPath = process.env.MAJOR_DB_PATH;
    const runtimeHome = join(import.meta.dirname, '.major-runtime-test');
    try {
      process.env.MAJOR_HOME = runtimeHome;
      delete process.env.MAJOR_DB_PATH;
      expect(defaultDbPath()).toBe(join(runtimeHome, 'major.db'));
    } finally {
      if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
      else process.env.MAJOR_HOME = priorMajorHome;
      if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
      else process.env.MAJOR_DB_PATH = priorDbPath;
    }
  });

  it('apply cleanly to a fresh database and are idempotent on reopen', () => {
    const path = tempDbPath();
    const first = openDb(path);
    first.sqlite.close();
    const second = openDb(path); // re-running the migrator must be a no-op
    const tables = second.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    expect(tables.map((t) => t.name)).toContain('task_claims');
    expect(tables.map((t) => t.name)).toContain('execution_policy_decisions');
  });

  it('recovers a database interrupted after only the first migrations (upgrade path)', () => {
    const path = tempDbPath();
    const sqlite = new Database(path);
    sqlite.pragma('foreign_keys = OFF');
    // Simulate an install that crashed after the original foundation
    // migrations: only 0000 and 0001 applied, plus legacy-shaped data.
    const files = migrationFiles();
    applyRaw(sqlite, files[0]!);
    applyRaw(sqlite, files[1]!);
    sqlite
      .prepare(
        `INSERT INTO projects (id, name, repo_path, config_json, created_at, updated_at)
         VALUES ('proj_1', 'legacy', '/tmp/x', '{}', '2026-01-01', '2026-01-01')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO tasks (id, project_id, title, status, complexity, created_at, updated_at)
         VALUES ('task_1', 'proj_1', 'legacy task', 'draft', 'bounded', '2026-01-01', '2026-01-01')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO task_suggestions (id, project_id, title, status, created_at, updated_at)
         VALUES ('tsug_1', 'proj_1', 'legacy suggestion', 'pending', '2026-01-01', '2026-01-01')`,
      )
      .run();
    // record the applied prefix in drizzle's journal table so the migrator resumes
    sqlite
      .prepare(
        `CREATE TABLE IF NOT EXISTS __drizzle_migrations (
           id INTEGER PRIMARY KEY AUTOINCREMENT, hash text NOT NULL, created_at numeric
         )`,
      )
      .run();
    const journal = JSON.parse(
      readFileSync(join(MIGRATIONS_DIR, 'meta', '_journal.json'), 'utf8'),
    ) as { entries: { tag: string; when: number }[] };
    for (const entry of journal.entries.slice(0, 2)) {
      const sql = readFileSync(join(MIGRATIONS_DIR, `${entry.tag}.sql`), 'utf8');
      sqlite
        .prepare('INSERT INTO __drizzle_migrations (hash, created_at) VALUES (?, ?)')
        .run(createHash('sha256').update(sql).digest('hex'), entry.when);
    }
    sqlite.close();

    // openDb resumes: applies the remaining migrations and preserves the data
    const { db, sqlite: upgraded } = openDb(path);
    const task = upgraded.prepare("SELECT * FROM tasks WHERE id = 'task_1'").get() as Record<
      string,
      unknown
    >;
    expect(task.version).toBe(0);
    const suggestion = upgraded
      .prepare("SELECT * FROM task_suggestions WHERE id = 'tsug_1'")
      .get() as Record<string, unknown>;
    expect(suggestion.scope_fingerprint).toBe('legacy:tsug_1');
    expect(suggestion.source_type).toBe('human');
    void db;
  });

  it('upgrades a prior Toolsmith artifact without silently reusing it', () => {
    const path = tempDbPath();
    const sqlite = new Database(path);
    sqlite.pragma('foreign_keys = OFF');
    sqlite.exec(`
      CREATE TABLE capability_records (
        id text PRIMARY KEY NOT NULL,
        status text NOT NULL,
        validation_state text NOT NULL,
        verification_artifact_id text
      );
      CREATE TABLE capability_verification_artifacts (
        id text PRIMARY KEY NOT NULL,
        capability_id text NOT NULL,
        source_fingerprint text NOT NULL,
        operation text NOT NULL,
        fixture_json text NOT NULL,
        expected_json text NOT NULL,
        actual_json text NOT NULL,
        validator text NOT NULL,
        environment_json text NOT NULL,
        security_json text NOT NULL,
        status text NOT NULL,
        verification_run_id text,
        created_at text NOT NULL
      );
      CREATE TABLE verification_runs (id text PRIMARY KEY NOT NULL);
    `);
    sqlite
      .prepare(
        `INSERT INTO capability_records (id, status, validation_state, verification_artifact_id)
         VALUES ('cap_legacy', 'validated', 'independently_validated', 'cvar_legacy')`,
      )
      .run();
    sqlite
      .prepare(
        `INSERT INTO capability_verification_artifacts (id, capability_id, source_fingerprint, operation, fixture_json, expected_json, actual_json, validator, environment_json, security_json, status, created_at)
         VALUES ('cvar_legacy', 'cap_legacy', 'legacy-source', 'fetch', '{}', '{}', '{}', 'legacy-validator', '{}', '{}', 'passed', '2026-01-01')`,
      )
      .run();

    applyRaw(sqlite, '0018_striped_the_hand.sql');

    expect(
      sqlite
        .prepare('SELECT validation_subject FROM capability_verification_artifacts WHERE id = ?')
        .get('cvar_legacy'),
    ).toMatchObject({ validation_subject: 'legacy-unbound:cvar_legacy' });
    expect(
      sqlite
        .prepare(
          'SELECT status, validation_state, verification_artifact_id FROM capability_records WHERE id = ?',
        )
        .get('cap_legacy'),
    ).toMatchObject({
      status: 'degraded',
      validation_state: 'failed',
      verification_artifact_id: null,
    });
    sqlite.close();
  });
});

import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { backupState } from '../src/db/backup.js';
import { openDb } from '../src/db/client.js';
import { rotateJsonlLog } from '../src/security/major-gateway.js';

let home: string;
const savedHome = process.env.MAJOR_HOME;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'major-state-safety-'));
  process.env.MAJOR_HOME = home;
});

afterEach(() => {
  if (savedHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = savedHome;
  rmSync(home, { recursive: true, force: true });
});

const mode = (path: string) => statSync(path).mode & 0o777;

describe('state backup', () => {
  it('snapshots the db and state files with private perms and keeps the newest 14', () => {
    const dbPath = join(home, 'major.db');
    openDb(dbPath).sqlite.close();
    const state = join(home, 'supervisor-state.json');
    const policies = join(home, 'project-policies.json');
    writeFileSync(state, '{"goals":[]}');
    writeFileSync(policies, '{"version":1,"projects":[]}');

    let last = '';
    for (let i = 0; i < 16; i += 1) {
      last = backupState({
        home,
        dbPath,
        files: [state, policies],
        now: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
      });
    }
    const root = join(home, 'backups', 'state');
    const snapshots = readdirSync(root).sort();
    expect(snapshots).toHaveLength(14);
    expect(join(root, snapshots.at(-1)!)).toBe(last);
    expect(snapshots[0]).toBe('2026-01-01T00-00-02-000Z');
    expect(mode(last)).toBe(0o700);
    expect(readdirSync(last).sort()).toEqual([
      'major.db',
      'project-policies.json',
      'supervisor-state.json',
    ]);
    for (const file of readdirSync(last)) expect(mode(join(last, file))).toBe(0o600);
    const copy = new Database(join(last, 'major.db'), { readonly: true });
    expect(copy.pragma('quick_check', { simple: true })).toBe('ok');
    copy.close();
  });
});

describe('database integrity check', () => {
  it('refuses a corrupt db and names the newest snapshot to restore from', () => {
    const dbPath = join(home, 'major.db');
    openDb(dbPath).sqlite.close();
    const snapshot = backupState({ home, dbPath, files: [] });
    writeFileSync(dbPath, 'not a sqlite database at all'.repeat(200));
    expect(() => openDb(dbPath)).toThrow(
      new RegExp(`failed integrity check.*restore major.db from ${join(snapshot, 'major.db')}`),
    );
  });
});

describe('execution-policy log rotation', () => {
  it('gzips past the size limit and keeps the newest 6 rotations', () => {
    const log = join(home, 'execution-policy.jsonl');
    for (let i = 0; i < 8; i += 1) {
      writeFileSync(join(home, `execution-policy.2025-01-0${i + 1}T00-00-00-000Z.jsonl.gz`), '');
    }
    writeFileSync(log, `${'{"x":1}\n'.repeat(20)}`);
    rotateJsonlLog(log, 1_000_000);
    expect(readFileSync(log, 'utf8')).toContain('"x"');

    rotateJsonlLog(log, 10);
    const archives = readdirSync(home)
      .filter((name) => name.endsWith('.jsonl.gz'))
      .sort();
    expect(archives).toHaveLength(6);
    const newest = join(home, archives.at(-1)!);
    expect(gunzipSync(readFileSync(newest)).toString()).toBe('{"x":1}\n'.repeat(20));
    expect(mode(newest)).toBe(0o600);
    expect(readdirSync(home)).not.toContain('execution-policy.jsonl');
  });
});

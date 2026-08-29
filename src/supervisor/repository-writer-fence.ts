import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type Database from 'better-sqlite3';

export interface RepositoryWriterFence {
  readonly repoPath: string;
  readonly token: string;
  assertUncontended(): void;
  commitSqlite(sqlite: Database.Database, afterAssertionForTest?: () => void): void;
  release(): void;
}

function controlHome(): string {
  if (process.env.MAJOR_STATE_PATH) return dirname(resolve(process.env.MAJOR_STATE_PATH));
  if (process.env.MAJOR_HOME) return resolve(process.env.MAJOR_HOME);
  return join(homedir(), '.major');
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function paths(repoPath: string): { lock: string; contention: string } {
  const dir = join(controlHome(), 'supervisor-repo-locks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = createHash('sha256').update(resolve(repoPath)).digest('hex').slice(0, 32);
  return { lock: join(dir, `${key}.pid`), contention: join(dir, `${key}.contended`) };
}

function markContention(path: string): void {
  writeFileSync(path, `${process.pid} ${new Date().toISOString()} ${randomUUID()}\n`, {
    flag: 'a',
    mode: 0o600,
  });
}

/** Acquire the one canonical writer lease for this source tree. A refused
 * writer records contention, allowing an authority transition already holding
 * the lease to fail closed when the attempt occurred after its identity read. */
export function tryAcquireRepositoryWriterFence(
  repoPath: string,
): RepositoryWriterFence | undefined {
  const canonicalRepo = resolve(repoPath);
  const { lock, contention } = paths(canonicalRepo);
  if (existsSync(lock)) {
    const lockText = readFileSync(lock, 'utf8').trim();
    const lockAgeMs = Date.now() - statSync(lock).mtimeMs;
    const prior = Number.parseInt(lockText.split(' ')[0] ?? '', 10);
    if ((!lockText && lockAgeMs <= 30_000) || (Number.isFinite(prior) && pidAlive(prior))) {
      markContention(contention);
      return undefined;
    }
    if (lockAgeMs <= 30_000) {
      markContention(contention);
      return undefined;
    }
    unlinkSync(lock);
  }
  let fd: number;
  try {
    fd = openSync(lock, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      markContention(contention);
      return undefined;
    }
    throw error;
  }
  const token = randomUUID();
  writeFileSync(fd, `${process.pid} ${token}\n`);
  closeSync(fd);
  try {
    unlinkSync(contention);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  let active = true;
  return {
    repoPath: canonicalRepo,
    token,
    assertUncontended() {
      if (
        !active ||
        !existsSync(lock) ||
        readFileSync(lock, 'utf8').trim() !== `${process.pid} ${token}`
      ) {
        throw new Error('repository writer fence was lost');
      }
      if (existsSync(contention)) throw new Error('repository writer fence observed contention');
    },
    commitSqlite(sqlite, afterAssertionForTest) {
      this.assertUncontended();
      afterAssertionForTest?.();
      if (existsSync(contention)) {
        throw new Error('repository writer fence observed contention at SQLite commit');
      }
      sqlite.exec('COMMIT');
    },
    release() {
      if (!active) return;
      active = false;
      try {
        if (existsSync(lock) && readFileSync(lock, 'utf8').trim() === `${process.pid} ${token}`) {
          unlinkSync(lock);
        }
      } catch {
        // A stale lease is reclaimed only after its owner process is gone.
      }
    },
  };
}

export function attemptRepositoryMutation(repoPath: string, mutation: () => void): boolean {
  const fence = tryAcquireRepositoryWriterFence(repoPath);
  if (!fence) return false;
  try {
    mutation();
    return true;
  } finally {
    fence.release();
  }
}

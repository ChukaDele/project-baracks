/**
 * Read only the owner-approved Codex profiles. The policy lives in Major's
 * private state, never beside credentials. Each App Server gets a temporary
 * CODEX_HOME whose auth.json is a symlink to the existing profile; no
 * credential is copied, rewritten, or made active globally.
 */
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { queryCodexAppServer } from './codex-app-server.js';
import { codexUsageReport, type CodexUsageAccount, type CodexUsageReport } from './codex-usage.js';
import { spawnReadOnlyCodexAppServer } from '../security/major-gateway.js';

interface CodexProfilePolicyRow {
  id: string;
  role: 'active' | 'backup-disabled';
  home: string;
}

interface CodexProfilePolicy {
  accounts: CodexProfilePolicyRow[];
}

function majorHome(): string {
  return process.env.MAJOR_HOME ? resolve(process.env.MAJOR_HOME) : join(homedir(), '.major');
}

export function codexProfilePolicyPath(): string {
  return join(majorHome(), 'codex-account-policy.json');
}

export function readCodexProfilePolicy(): CodexProfilePolicy | undefined {
  const path = codexProfilePolicyPath();
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { accounts?: unknown };
    if (!Array.isArray(value.accounts)) return undefined;
    const accounts = value.accounts.filter(
      (row): row is CodexProfilePolicyRow =>
        typeof row === 'object' &&
        row !== null &&
        typeof (row as Record<string, unknown>).id === 'string' &&
        /^COD-\d{2}$/.test((row as Record<string, unknown>).id as string) &&
        ((row as Record<string, unknown>).role === 'active' ||
          (row as Record<string, unknown>).role === 'backup-disabled') &&
        typeof (row as Record<string, unknown>).home === 'string',
    );
    return { accounts };
  } catch {
    return undefined;
  }
}

async function readProfile(row: CodexProfilePolicyRow): Promise<CodexUsageAccount> {
  const auth = join(resolve(row.home), 'auth.json');
  if (!existsSync(auth) || !lstatSync(auth).isFile()) {
    return { accountLabel: row.id, error: 'approved Codex profile credential is unavailable' };
  }
  const before = lstatSync(auth);
  const scratch = mkdtempSync(join(tmpdir(), 'major-codex-read-'));
  try {
    symlinkSync(auth, join(scratch, 'auth.json'));
    const child = spawnReadOnlyCodexAppServer(scratch);
    try {
      const snapshot = await queryCodexAppServer(child.stdin, child.stdout, {
        startupDelayMs: 250,
        readyDelayMs: 500,
      });
      const after = lstatSync(auth);
      if (before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
        throw new Error('Codex credential changed during a read-only usage query');
      }
      return { accountLabel: row.id, ...snapshot };
    } finally {
      child.stop();
    }
  } catch (error) {
    return { accountLabel: row.id, error: error instanceof Error ? error.message : String(error) };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

export async function readApprovedCodexProfileUsage(): Promise<CodexUsageReport | undefined> {
  const policy = readCodexProfilePolicy();
  if (!policy) return undefined;
  const active = policy.accounts.filter((account) => account.role === 'active');
  return codexUsageReport(await Promise.all(active.map(readProfile)));
}

export function writeCodexProfilePolicy(policy: CodexProfilePolicy): void {
  const path = codexProfilePolicyPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, `${JSON.stringify(policy, null, 2)}\n`, { mode: 0o600 });
}

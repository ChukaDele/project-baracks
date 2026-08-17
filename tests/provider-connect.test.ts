import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let hostCheck: { status: 'found' | 'not-found' | 'unsafe'; path?: string; detail: string };
let fingerprint: string;
let importResult: { ok: boolean; detail: string };
let probeResult: { installed: boolean; authenticated: boolean; executable: string; detail: string };
let importCalls: Array<{ host: string; path: string }>;

vi.mock('../src/providers/host-credential.js', () => ({
  checkHostCredential: (_host: string) => hostCheck,
  fingerprintCredentialFile: (_path: string) => fingerprint,
}));

vi.mock('../src/security/major-gateway.js', () => ({
  majorExecutionBackend: () => ({
    probeProvider: async () => probeResult,
    importProviderCredential: async (host: string, path: string) => {
      importCalls.push({ host, path });
      return importResult;
    },
  }),
  trustedExecutableRegistry: () => ({
    verify: () => {
      throw new Error('not trusted in this test');
    },
  }),
}));

import { agentProviders } from '../src/db/schema.js';
import { openDb } from '../src/db/client.js';
import { runProviderLifecycleCli } from '../src/providers/lifecycle-cli.js';
import { eq } from 'drizzle-orm';

let dbPath = '';
let priorDbPath: string | undefined;
let logs: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let priorIsTTY: boolean | undefined;

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'major-provider-connect-')), 'major.db');
  priorDbPath = process.env.MAJOR_DB_PATH;
  process.env.MAJOR_DB_PATH = dbPath;
  logs = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line);
  });
  importCalls = [];
  priorIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
});

afterEach(() => {
  logSpy.mockRestore();
  Object.defineProperty(process.stdin, 'isTTY', { value: priorIsTTY, configurable: true });
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  rmSync(dbPath, { force: true });
});

function output(): string {
  return logs.join('\n');
}

describe('major provider connect', () => {
  it('reports no-host-credential and a next-step action when nothing is found', async () => {
    hostCheck = {
      status: 'not-found',
      detail: 'no known host credential location for codex on this platform',
    };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex']);
    expect(output()).toMatch(/"status": "no-host-credential"/);
    expect(output()).toMatch(/sign in with codex/);
    expect(importCalls).toHaveLength(0);
  });

  it('refuses a symlinked/malformed source without ever attempting import', async () => {
    hostCheck = { status: 'unsafe', detail: 'refusing to import a symlinked credential' };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex']);
    expect(output()).toMatch(/"status": "blocked"/);
    expect(output()).toMatch(/symlinked credential/);
    expect(importCalls).toHaveLength(0);
  });

  it('requires explicit confirmation and never imports without it (non-interactive, no --yes)', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'aaaa';
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex']);
    expect(output()).toMatch(/"status": "confirmation-required"/);
    expect(importCalls).toHaveLength(0);
  });

  it('never imports when the user explicitly declines with --no', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'aaaa';
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex', '--no']);
    expect(output()).toMatch(/"status": "declined"/);
    expect(importCalls).toHaveLength(0);
  });

  it('imports opaquely through the broker and probes on --yes, without ever logging the path as a secret', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'bbbb';
    importResult = {
      ok: true,
      detail: 'imported codex credential -> /var/lib/major/provider-auth/codex/.codex/auth.json',
    };
    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/codex/bin/codex-native',
      detail: 'authenticated',
    };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex', '--yes']);
    expect(importCalls).toEqual([{ host: 'codex', path: '/Users/test/.codex/auth.json' }]);
    expect(output()).toMatch(/"authenticated": true/);

    const opened = openDb(dbPath);
    try {
      const provider = opened.db
        .select()
        .from(agentProviders)
        .where(eq(agentProviders.name, 'codex'))
        .get();
      expect(provider?.credentialFingerprint).toBe('bbbb');
    } finally {
      opened.sqlite.close();
    }
  });

  it('reports import-failed and does not fabricate a READY state when the broker refuses', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'cccc';
    importResult = {
      ok: false,
      detail: 'credential import broker refused: unsafe staged credential copy',
    };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex', '--yes']);
    expect(output()).toMatch(/"status": "import-failed"/);
    expect(output()).not.toMatch(/"authenticated": true/);
  });

  it('re-probes without re-importing when the credential is unchanged (already connected)', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'same-fingerprint';
    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/codex/bin/codex-native',
      detail: 'authenticated',
    };
    const seed = openDb(dbPath);
    try {
      seed.db
        .insert(agentProviders)
        .values({
          id: 'aprov_seed',
          name: 'codex',
          accountLabel: 'default',
          credentialFingerprint: 'same-fingerprint',
        })
        .run();
    } finally {
      seed.sqlite.close();
    }
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex']);
    // No confirmation was needed and no import happened — the stored
    // fingerprint already matches the host credential's current fingerprint.
    expect(importCalls).toHaveLength(0);
    expect(output()).toMatch(/"authenticated": true/);
  });

  it('prompts to replace (not silently swap) when the host credential fingerprint changed — the manual account-swap signal', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.claude/.credentials.json', detail: 'found' };
    fingerprint = 'new-account-fingerprint';
    const seed = openDb(dbPath);
    try {
      seed.db
        .insert(agentProviders)
        .values({
          id: 'aprov_seed2',
          name: 'claude-code',
          accountLabel: 'default',
          credentialFingerprint: 'old-account-fingerprint',
        })
        .run();
    } finally {
      seed.sqlite.close();
    }
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'claude-code']);
    expect(output()).toMatch(/"status": "confirmation-required"/);
    expect(output()).toMatch(/"changed": true/);
    expect(importCalls).toHaveLength(0);

    // Approving with --yes performs the atomic replacement.
    logs = [];
    importResult = { ok: true, detail: 'imported claude credential' };
    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/claude/bin/claude',
      detail: 'authenticated after account swap',
    };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'claude-code', '--yes']);
    expect(importCalls).toEqual([
      { host: 'claude', path: '/Users/test/.claude/.credentials.json' },
    ]);
    const verify = openDb(dbPath);
    try {
      const provider = verify.db
        .select()
        .from(agentProviders)
        .where(eq(agentProviders.name, 'claude-code'))
        .get();
      expect(provider?.credentialFingerprint).toBe('new-account-fingerprint');
    } finally {
      verify.sqlite.close();
    }
  });
});

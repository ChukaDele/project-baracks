import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let hostCheck: { status: 'found' | 'not-found' | 'unsafe'; path?: string; detail: string };
let fingerprint: string;
let importResult: { ok: boolean; detail: string };
let probeResult: {
  installed: boolean;
  authenticated: boolean;
  executable: string;
  detail: string;
  version?: string;
};
let loginResult: { ok: boolean; detail: string };
let hostVersion: string | undefined;
let importCalls: Array<{ host: string; path: string }>;
let loginCalls: Array<{ host: string }>;
let loginLines: string[];

vi.mock('../src/providers/host-credential.js', () => ({
  checkHostCredential: (_host: string) => hostCheck,
  fingerprintCredentialFile: (_path: string) => fingerprint,
}));

vi.mock('../src/providers/host-provider-version.js', () => ({
  hostProviderVersion: (_path: string) => hostVersion,
}));

vi.mock('../src/security/major-gateway.js', () => ({
  majorExecutionBackend: () => ({
    probeProvider: async () => probeResult,
    importProviderCredential: async (host: string, path: string) => {
      importCalls.push({ host, path });
      return importResult;
    },
    loginProviderNative: async (host: string, onLine: (line: string) => void) => {
      loginCalls.push({ host });
      for (const line of loginLines) onLine(line);
      return loginResult;
    },
  }),
  trustedExecutableRegistry: () => ({
    verify: () => ({ spawnPath: '/usr/local/bin/codex' }),
  }),
}));

import { agentModels, agentProviders } from '../src/db/schema.js';
import { openDb } from '../src/db/client.js';
import { runProviderLifecycleCli } from '../src/providers/lifecycle-cli.js';
import { eq } from 'drizzle-orm';
import { ensureObservedModel } from './helpers.js';

let dbPath = '';
let priorDbPath: string | undefined;
let priorExecutionPath: string | undefined;
let logs: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;
let priorIsTTY: boolean | undefined;

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'major-provider-connect-')), 'major.db');
  priorDbPath = process.env.MAJOR_DB_PATH;
  priorExecutionPath = process.env.MAJOR_EXECUTION_PATH;
  process.env.MAJOR_DB_PATH = dbPath;
  // These tests exercise the legacy isolated backend mock. Host-path behavior
  // is covered by the live CLI probe tests.
  process.env.MAJOR_EXECUTION_PATH = 'lima';
  logs = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line);
  });
  importCalls = [];
  loginCalls = [];
  loginLines = [];
  hostVersion = undefined;
  probeResult = {
    installed: true,
    authenticated: false,
    executable: '/opt/major/providers/v1/codex/bin/codex-native',
    detail: 'not authenticated',
  };
  loginResult = { ok: false, detail: 'not configured for this test' };
  priorIsTTY = process.stdin.isTTY;
  Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
});

afterEach(() => {
  logSpy.mockRestore();
  Object.defineProperty(process.stdin, 'isTTY', { value: priorIsTTY, configurable: true });
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  if (priorExecutionPath === undefined) delete process.env.MAJOR_EXECUTION_PATH;
  else process.env.MAJOR_EXECUTION_PATH = priorExecutionPath;
  rmSync(dbPath, { force: true });
});

function output(): string {
  return logs.join('\n');
}

describe('major provider connect', () => {
  it('falls back to native login when no host credential is found, rather than stranding the user', async () => {
    hostCheck = {
      status: 'not-found',
      detail: 'no known host credential location for codex on this platform',
    };
    loginResult = { ok: false, detail: 'login was cancelled' };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex']);
    expect(importCalls).toHaveLength(0);
    expect(loginCalls).toEqual([{ host: 'codex' }]);
    expect(output()).toMatch(/no host login found for codex/);
    expect(output()).toMatch(/"status": "login-failed"/);
  });

  it('falls back to native login when the host credential is unsafe to reuse (e.g. symlinked)', async () => {
    hostCheck = { status: 'unsafe', detail: 'refusing to import a symlinked credential' };
    loginResult = { ok: false, detail: 'login was cancelled' };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex']);
    expect(importCalls).toHaveLength(0);
    expect(loginCalls).toEqual([{ host: 'codex' }]);
    expect(output()).toMatch(/symlinked credential/);
  });

  it('asks again (does not silently fall through) when reuse is ambiguous: found, changed, non-interactive, no --yes/--no', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'aaaa';
    hostVersion = '0.145.0';
    probeResult = { ...probeResult, version: '0.145.0' };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex']);
    expect(output()).toMatch(/"status": "confirmation-required"/);
    expect(importCalls).toHaveLength(0);
    expect(loginCalls).toHaveLength(0);
  });

  it('falls back to native login when the user explicitly declines host reuse with --no', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'aaaa';
    hostVersion = '0.145.0';
    probeResult = { ...probeResult, version: '0.145.0' };
    loginResult = { ok: false, detail: 'login was cancelled' };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex', '--no']);
    expect(importCalls).toHaveLength(0);
    expect(loginCalls).toEqual([{ host: 'codex' }]);
    expect(output()).toMatch(/declined reusing the host login/);
  });

  it('imports opaquely through the broker and probes on --yes, without ever logging the path as a secret', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'bbbb';
    hostVersion = '0.145.0';
    importResult = {
      ok: true,
      detail: 'imported codex credential -> /var/lib/major/provider-auth/codex/.codex/auth.json',
    };
    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/codex/bin/codex-native',
      detail: 'authenticated',
      version: '0.145.0',
    };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex', '--yes']);
    expect(importCalls).toEqual([{ host: 'codex', path: '/Users/test/.codex/auth.json' }]);
    expect(loginCalls).toHaveLength(0);
    expect(output()).toMatch(/"authenticated": true/);
    expect(output()).toMatch(/"credentialReuse": "compatible"/);

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

  it('falls back to native login when the broker refuses the host import', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'cccc';
    hostVersion = '0.145.0';
    probeResult = { ...probeResult, version: '0.145.0' };
    importResult = {
      ok: false,
      detail: 'credential import broker refused: unsafe staged credential copy',
    };
    loginResult = { ok: false, detail: 'login was cancelled' };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex', '--yes']);
    expect(loginCalls).toEqual([{ host: 'codex' }]);
    expect(output()).toMatch(/host login import failed/);
    expect(output()).not.toMatch(/"authenticated": true/);
  });

  it('falls back to native login when host and guest versions are proven incompatible', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'dddd';
    hostVersion = '0.145.0';
    probeResult = { ...probeResult, version: '0.147.0' };
    loginResult = { ok: false, detail: 'login was cancelled' };
    await runProviderLifecycleCli(['provider', 'connect', '--provider', 'codex', '--yes']);
    expect(importCalls).toHaveLength(0); // never even attempted the reuse
    expect(loginCalls).toEqual([{ host: 'codex' }]);
    expect(output()).toMatch(/"credentialReuse": "not compatible"/);
    expect(output()).toMatch(/Host login cannot be safely reused/);
  });

  it('re-probes without re-importing when the credential is unchanged (already connected)', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.codex/auth.json', detail: 'found' };
    fingerprint = 'same-fingerprint';
    hostVersion = '0.145.0';
    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/codex/bin/codex-native',
      detail: 'authenticated',
      version: '0.145.0',
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
    expect(loginCalls).toHaveLength(0);
    expect(output()).toMatch(/"authenticated": true/);
  });

  it('prompts to replace (not silently swap) when the host credential fingerprint changed — the manual account-swap signal', async () => {
    hostCheck = { status: 'found', path: '/Users/test/.claude/.credentials.json', detail: 'found' };
    fingerprint = 'new-account-fingerprint';
    hostVersion = undefined; // claude has no verified guest version signal here -> 'unknown', not blocked
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

  it('does not touch anything and reports already-ready when the provider is already READY', async () => {
    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/codex/bin/codex-native',
      detail: 'authenticated',
      version: '0.145.0',
    };
    const seed = openDb(dbPath);
    try {
      seed.db
        .insert(agentProviders)
        .values({ id: 'aprov_ready', name: 'codex', accountLabel: 'default' })
        .run();
      const modelId = ensureObservedModel(seed.db, 'aprov_ready', 'auto', 'subscription_included');
      seed.db
        .update(agentModels)
        .set({ visible: true, authenticated: true, availability: 'available' })
        .where(eq(agentModels.id, modelId))
        .run();
    } finally {
      seed.sqlite.close();
    }
    await runProviderLifecycleCli(['provider', 'connect', 'codex']);
    expect(importCalls).toHaveLength(0);
    expect(loginCalls).toHaveLength(0);
    expect(output()).toMatch(/"status": "already-ready"/);
  });

  it('--relogin re-authenticates even when already READY, rather than short-circuiting', async () => {
    hostCheck = { status: 'not-found', detail: 'no known host credential location' };
    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/codex/bin/codex-native',
      detail: 'authenticated',
      version: '0.145.0',
    };
    loginResult = { ok: false, detail: 'login was cancelled' };
    await runProviderLifecycleCli(['provider', 'connect', 'codex', '--relogin']);
    expect(loginCalls).toEqual([{ host: 'codex' }]);
  });

  it('accepts a bare positional provider name identically to --provider', async () => {
    hostCheck = { status: 'not-found', detail: 'no known host credential location' };
    loginResult = { ok: false, detail: 'login was cancelled' };
    await runProviderLifecycleCli(['provider', 'connect', 'codex']);
    expect(loginCalls).toEqual([{ host: 'codex' }]);
  });

  it('relays every native-login line to the console as it arrives', async () => {
    hostCheck = { status: 'not-found', detail: 'no known host credential location' };
    loginLines = [
      'Open this link in your browser',
      'https://auth.openai.com/codex/device',
      'TEST-CODE',
    ];
    loginResult = { ok: true, detail: 'imported codex credential -> ...' };
    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/codex/bin/codex-native',
      detail: 'authenticated',
    };
    await runProviderLifecycleCli(['provider', 'connect', 'codex']);
    expect(output()).toMatch(/https:\/\/auth\.openai\.com\/codex\/device/);
    expect(output()).toMatch(/TEST-CODE/);
    expect(output()).toMatch(/"authenticated": true/);
  });

  it('reports billing-confirmation-required (never silently authorizing spend) when non-interactive after a successful login', async () => {
    hostCheck = { status: 'not-found', detail: 'no known host credential location' };
    loginResult = { ok: true, detail: 'imported codex credential -> ...' };
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
        .values({ id: 'aprov_billing', name: 'codex', accountLabel: 'default' })
        .run();
      seed.db
        .insert(agentModels)
        .values({
          id: 'amodel_billing',
          providerId: 'aprov_billing',
          modelRef: 'auto',
          routingClass: 'codex',
          billingMode: 'unknown',
        })
        .run();
    } finally {
      seed.sqlite.close();
    }
    await runProviderLifecycleCli(['provider', 'connect', 'codex']);
    expect(output()).toMatch(/"status": "billing-confirmation-required"/);
    expect(output()).toMatch(/attest-billing/);
  });
});

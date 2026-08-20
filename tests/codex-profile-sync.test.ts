import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import {
  accountAuthStoreRelativePath,
  namedAuthStoreParentRelativePaths,
} from '../src/providers/account.js';
import {
  billingModeForSyncedCodexProfile,
  syncApprovedCodexProfiles,
} from '../src/providers/codex-profile-sync.js';
import {
  loadPersistedProviderInfos,
  persistProviderDiscovery,
  recordBillingObservation,
} from '../src/providers/discovery-store.js';
import { subscriptionAccountPool } from '../src/routing/subscription-accounts.js';
import { model } from './helpers.js';

function tempHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'major-codex-profile-sync-'));
  writeFileSync(
    join(home, 'codex-account-policy.json'),
    `${JSON.stringify(
      {
        accounts: [
          { id: 'COD-01', role: 'active', home: join(home, 'profiles', 'cod-01') },
          { id: 'COD-02', role: 'active', home: join(home, 'profiles', 'cod-02') },
        ],
      },
      null,
      2,
    )}\n`,
  );
  return home;
}

function writeProfileCredential(
  home: string,
  profile: 'cod-01' | 'cod-02',
  secret: string,
): string {
  const dir = join(home, 'profiles', profile);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const auth = join(dir, 'auth.json');
  writeFileSync(auth, `${JSON.stringify({ token: secret }, null, 2)}\n`, { mode: 0o600 });
  return auth;
}

function testBackend(options: {
  importCodexProfileCredential: (
    path: string,
    accountLabel: string,
  ) => Promise<{ ok: true; detail: string } | { ok: false; detail: string }>;
  readCodexUsage: (labels: readonly string[]) => Promise<
    Array<{
      accountLabel: string;
      planType?: string;
      accountKind?: string;
      primary?: { usedPercent?: number; windowDurationMins?: number };
    }>
  >;
}) {
  return {
    kind: 'test',
    inspect: async () => ({
      kind: 'test',
      available: true,
      filesystemIsolation: true,
      networkIsolation: true,
      lifecycleIsolation: true,
      detail: 'test',
    }),
    probeProvider: async () => ({
      executable: 'codex',
      installed: true,
      authenticated: true,
      detail: 'test',
    }),
    readCodexUsage: options.readCodexUsage,
    execute: () => {
      throw new Error('not used');
    },
    importCodexProfileCredential: options.importCodexProfileCredential,
  };
}

function usageRow(
  accountLabel: string,
  usedPercent: number,
): {
  accountLabel: string;
  planType: string;
  accountKind: string;
  primary: { usedPercent: number; windowDurationMins: number };
} {
  return {
    accountLabel,
    planType: 'plus',
    accountKind: 'chatgpt',
    primary: { usedPercent, windowDurationMins: 300 },
  };
}

describe('Codex profile sync bridge', () => {
  it('preserves source profile credentials and leaves the default slot untouched', async () => {
    const home = tempHome();
    const priorHome = process.env.MAJOR_HOME;
    process.env.MAJOR_HOME = home;
    const opened = openDb();
    try {
      const authOne = writeProfileCredential(home, 'cod-01', 'profile-one');
      const authTwo = writeProfileCredential(home, 'cod-02', 'profile-two');
      const beforeOne = readFileSync(authOne);
      const beforeTwo = readFileSync(authTwo);
      const defaultSlot = join(home, 'default-credential.json');
      writeFileSync(defaultSlot, '{"default":true}\n');

      const imported: string[] = [];
      const report = await syncApprovedCodexProfiles(
        testBackend({
          readCodexUsage: async (labels) =>
            labels.map((accountLabel) =>
              usageRow(accountLabel, accountLabel === 'cod-01' ? 10 : 100),
            ),
          importCodexProfileCredential: async (path, accountLabel) => {
            imported.push(`${accountLabel}:${path}`);
            expect(readFileSync(path).toString()).not.toBe('{"default":true}\n');
            return { ok: true, detail: `imported codex credential -> accounts/${accountLabel}` };
          },
        }),
        opened.db,
      );

      expect(imported).toEqual([`cod-01:${authOne}`, `cod-02:${authTwo}`]);
      expect(readFileSync(authOne)).toEqual(beforeOne);
      expect(readFileSync(authTwo)).toEqual(beforeTwo);
      expect(readFileSync(defaultSlot).toString()).toBe('{"default":true}\n');
      expect(report.profiles.map((row) => row.accountLabel)).toEqual(['cod-01', 'cod-02']);
    } finally {
      opened.sqlite.close();
      if (priorHome === undefined) delete process.env.MAJOR_HOME;
      else process.env.MAJOR_HOME = priorHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('routes healthy named siblings ahead of an exhausted default Codex account', async () => {
    const home = tempHome();
    const priorHome = process.env.MAJOR_HOME;
    const priorDb = process.env.MAJOR_DB_PATH;
    const dbPath = join(home, 'major.db');
    process.env.MAJOR_HOME = home;
    process.env.MAJOR_DB_PATH = dbPath;
    const opened = openDb(dbPath);
    try {
      writeProfileCredential(home, 'cod-01', 'healthy');
      writeProfileCredential(home, 'cod-02', 'exhausted');

      persistProviderDiscovery(
        opened.db,
        {
          name: 'codex',
          installed: true,
          authenticated: true,
          models: [
            model({
              modelRef: 'auto',
              routingClass: 'codex',
              availability: 'exhausted',
              billingMode: 'subscription_included',
            }),
          ],
        },
        { source: 'cli' },
      );
      recordBillingObservation(opened.db, {
        providerName: 'codex',
        modelRef: 'auto',
        billingMode: 'subscription_included',
        source: 'human',
        note: 'default attested',
      });

      await syncApprovedCodexProfiles(
        testBackend({
          readCodexUsage: async (labels) =>
            labels.map((accountLabel) =>
              usageRow(accountLabel, accountLabel === 'cod-01' ? 10 : 100),
            ),
          importCodexProfileCredential: async () => ({
            ok: true,
            detail: 'imported codex credential -> accounts/<label>',
          }),
        }),
        opened.db,
      );

      const infos = loadPersistedProviderInfos(opened.db);
      const pooled = subscriptionAccountPool({
        providers: infos,
        lastCapacityKey: 'codex',
        consecutiveFailures: 0,
      });
      expect(pooled.providers.map((provider) => provider.name)).toEqual(['codex#cod-01']);
      expect(pooled.reason).toMatch(/quota rotation/);
    } finally {
      opened.sqlite.close();
      if (priorHome === undefined) delete process.env.MAJOR_HOME;
      else process.env.MAJOR_HOME = priorHome;
      if (priorDb === undefined) delete process.env.MAJOR_DB_PATH;
      else process.env.MAJOR_DB_PATH = priorDb;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('returns a top-level error when every active profile import fails', async () => {
    const home = tempHome();
    const priorHome = process.env.MAJOR_HOME;
    process.env.MAJOR_HOME = home;
    const opened = openDb();
    try {
      writeProfileCredential(home, 'cod-01', 'profile-one');
      writeProfileCredential(home, 'cod-02', 'profile-two');

      const report = await syncApprovedCodexProfiles(
        testBackend({
          readCodexUsage: async () => [],
          importCodexProfileCredential: async (_path, accountLabel) => ({
            ok: false,
            detail: `import rejected for ${accountLabel}`,
          }),
        }),
        opened.db,
      );

      expect(report.error).toBe('every active Codex profile import failed');
      expect(report.profiles).toEqual([
        expect.objectContaining({
          policyId: 'COD-01',
          accountLabel: 'cod-01',
          imported: false,
        }),
        expect.objectContaining({
          policyId: 'COD-02',
          accountLabel: 'cod-02',
          imported: false,
        }),
      ]);
    } finally {
      opened.sqlite.close();
      if (priorHome === undefined) delete process.env.MAJOR_HOME;
      else process.env.MAJOR_HOME = priorHome;
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('keeps row diagnostics without a top-level error on partial import success', async () => {
    const home = tempHome();
    const priorHome = process.env.MAJOR_HOME;
    process.env.MAJOR_HOME = home;
    const opened = openDb();
    try {
      writeProfileCredential(home, 'cod-01', 'profile-one');
      writeProfileCredential(home, 'cod-02', 'profile-two');

      const report = await syncApprovedCodexProfiles(
        testBackend({
          readCodexUsage: async (labels) =>
            labels.map((accountLabel) => usageRow(accountLabel, 10)),
          importCodexProfileCredential: async (_path, accountLabel) =>
            accountLabel === 'cod-01'
              ? { ok: true, detail: 'imported codex credential -> accounts/cod-01' }
              : { ok: false, detail: 'import rejected for cod-02' },
        }),
        opened.db,
      );

      expect(report.error).toBeUndefined();
      expect(report.profiles).toEqual([
        expect.objectContaining({
          policyId: 'COD-01',
          accountLabel: 'cod-01',
          imported: true,
          availability: 'available',
        }),
        expect.objectContaining({
          policyId: 'COD-02',
          accountLabel: 'cod-02',
          imported: false,
          detail: 'import rejected for cod-02',
        }),
      ]);
    } finally {
      opened.sqlite.close();
      if (priorHome === undefined) delete process.env.MAJOR_HOME;
      else process.env.MAJOR_HOME = priorHome;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

describe('Codex profile sync billing evidence', () => {
  it('records subscription billing only with live app-server plan/account evidence', () => {
    expect(
      billingModeForSyncedCodexProfile({
        accountLabel: 'cod-01',
        planType: 'plus',
        accountKind: 'chatgpt',
      }),
    ).toBe('subscription_included');
    expect(
      billingModeForSyncedCodexProfile({
        accountLabel: 'cod-01',
        primary: { usedPercent: 10, windowDurationMins: 300 },
      }),
    ).toBeUndefined();
    expect(
      billingModeForSyncedCodexProfile({
        accountLabel: 'cod-01',
        error: 'usage probe failed',
      }),
    ).toBeUndefined();
  });
});

describe('import broker named account contract', () => {
  it('maps named Codex credentials under accounts/<label>/ via accountAuthStoreRelativePath', () => {
    expect(accountAuthStoreRelativePath('.codex/auth.json', 'cod-01')).toBe(
      'accounts/cod-01/.codex/auth.json',
    );
    expect(accountAuthStoreRelativePath('.codex/auth.json')).toBe('.codex/auth.json');
  });

  it('lists named auth-store parent directories that must be root-owned 0700', () => {
    expect(namedAuthStoreParentRelativePaths('.codex/auth.json', 'cod-01')).toEqual([
      'accounts',
      'accounts/cod-01',
      'accounts/cod-01/.codex',
    ]);
  });
});

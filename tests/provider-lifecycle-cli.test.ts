import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let probeResult: { installed: boolean; authenticated: boolean; executable: string; detail: string };

vi.mock('../src/security/major-gateway.js', () => ({
  majorExecutionBackend: () => ({
    probeProvider: async () => probeResult,
  }),
  trustedExecutableRegistry: () => ({
    verify: () => {
      throw new Error('not trusted in this test');
    },
  }),
}));

import { agentModels, agentProviders } from '../src/db/schema.js';
import { openDb } from '../src/db/client.js';
import { persistProviderDiscovery } from '../src/providers/discovery-store.js';
import { runProviderLifecycleCli } from '../src/providers/lifecycle-cli.js';
import { eq } from 'drizzle-orm';

let dbPath = '';
let priorDbPath: string | undefined;
let logs: string[] = [];
let logSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  dbPath = join(mkdtempSync(join(tmpdir(), 'major-provider-cli-')), 'major.db');
  priorDbPath = process.env.MAJOR_DB_PATH;
  process.env.MAJOR_DB_PATH = dbPath;
  logs = [];
  logSpy = vi.spyOn(console, 'log').mockImplementation((line: string) => {
    logs.push(line);
  });
});

afterEach(() => {
  logSpy.mockRestore();
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  rmSync(dbPath, { force: true });
});

describe('major provider help/usage', () => {
  it('prints usage for `provider` alone and `provider --help`, listing every subcommand', async () => {
    for (const args of [['provider'], ['provider', '--help'], ['provider', 'help']]) {
      logs = [];
      expect(await runProviderLifecycleCli(args)).toBe(true);
      const output = logs.join('\n');
      expect(output).toMatch(/probe --provider/);
      expect(output).toMatch(/attest-billing/);
      expect(output).toMatch(/attest-availability/);
      expect(output).toMatch(/sync-profiles/);
    }
  });

  it('reports an actionable error for an unknown provider subcommand instead of a silent fallthrough', async () => {
    await expect(runProviderLifecycleCli(['provider', 'frobnicate'])).rejects.toThrow(
      /unknown provider subcommand: frobnicate/,
    );
  });
});

describe('major provider probe', () => {
  it('persists a fresh READY state through the isolated probe', async () => {
    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/claude/bin/claude',
      detail: 'authenticated',
    };
    const handled = await runProviderLifecycleCli([
      'provider',
      'probe',
      '--provider',
      'claude-code',
    ]);
    expect(handled).toBe(true);
    expect(logs.join('\n')).toMatch(/"installed": true/);
    expect(logs.join('\n')).toMatch(/"authenticated": true/);

    const opened = openDb(dbPath);
    try {
      const provider = opened.db
        .select()
        .from(agentProviders)
        .where(eq(agentProviders.name, 'claude-code'))
        .get();
      expect(provider?.executable).toBe('/opt/major/providers/v1/claude/bin/claude');
    } finally {
      opened.sqlite.close();
    }
  });

  it('reports NOT_CONFIGURED-shaped state when neither the isolated probe nor a trusted install exists', async () => {
    probeResult = {
      installed: false,
      authenticated: false,
      executable: 'agy',
      detail: 'not installed',
    };
    const handled = await runProviderLifecycleCli([
      'provider',
      'probe',
      '--provider',
      'antigravity',
    ]);
    expect(handled).toBe(true);
    expect(logs.join('\n')).toMatch(/"installed": false/);
    expect(logs.join('\n')).toMatch(/"authenticated": false/);
  });

  it('keeps installed=true when the probe is installed but not yet authenticated', async () => {
    // visible/installed and authenticated are separate dimensions: an
    // installed-but-unauthenticated probe result must produce AUTH_REQUIRED
    // readiness (installed: true), never NOT_CONFIGURED (installed: false).
    const seed = openDb(dbPath);
    try {
      persistProviderDiscovery(
        seed.db,
        {
          name: 'codex',
          installed: true,
          authenticated: false,
          models: [
            {
              modelRef: 'auto',
              routingClass: 'codex',
              visible: false,
              authenticated: false,
              availability: 'unknown',
              billingMode: 'unknown',
              prohibited: false,
              source: 'registry',
            },
          ],
        },
        { source: 'registry' },
      );
    } finally {
      seed.sqlite.close();
    }

    probeResult = {
      installed: true,
      authenticated: false,
      executable: '/opt/major/providers/v1/codex/bin/codex-native',
      detail: 'provider is installed but authentication was not confirmed',
    };
    await runProviderLifecycleCli(['provider', 'probe', '--provider', 'codex']);

    const opened = openDb(dbPath);
    try {
      const provider = opened.db
        .select()
        .from(agentProviders)
        .where(eq(agentProviders.name, 'codex'))
        .get();
      const model = opened.db
        .select()
        .from(agentModels)
        .where(eq(agentModels.providerId, provider!.id))
        .get();
      expect(model?.visible).toBe(true);
      expect(model?.authenticated).toBe(false);
    } finally {
      opened.sqlite.close();
    }
  });

  it('bypasses the passive backoff window for this explicit owner-triggered re-probe', async () => {
    // Seed an EXHAUSTED model with a backoff window far in the future, as a
    // background probe would leave it. A routine 'cli'/'registry' discovery
    // must not clear this early; an explicit `provider probe` must.
    const opened = openDb(dbPath);
    const providerId = 'aprov_test';
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    try {
      opened.db
        .insert(agentProviders)
        .values({ id: providerId, name: 'claude-code', accountLabel: 'default' })
        .run();
      opened.db
        .insert(agentModels)
        .values({
          id: 'amodel_test',
          providerId,
          modelRef: 'sonnet',
          routingClass: 'sonnet',
          visible: true,
          authenticated: false,
          availability: 'exhausted',
          nextProbeAt: future,
        })
        .run();
    } finally {
      opened.sqlite.close();
    }

    probeResult = {
      installed: true,
      authenticated: true,
      executable: '/opt/major/providers/v1/claude/bin/claude',
      detail: 'authenticated after account swap',
    };
    await runProviderLifecycleCli(['provider', 'probe', '--provider', 'claude-code']);

    const verify = openDb(dbPath);
    try {
      const model = verify.db
        .select()
        .from(agentModels)
        .where(eq(agentModels.providerId, providerId))
        .get();
      expect(model?.authenticated).toBe(true);
      expect(model?.availability).toBe('available');
    } finally {
      verify.sqlite.close();
    }
  });

  it('leaves an existing backoff window intact when the re-probe still fails', async () => {
    // A probe that observes nothing new (still not authenticated) must not
    // silently clear the backoff timestamp while availability stays
    // exhausted — that combination defeats the hot-loop protection for
    // whatever eventually schedules automatic re-probes.
    const opened = openDb(dbPath);
    const providerId = 'aprov_test_still_exhausted';
    const future = new Date(Date.now() + 60 * 60 * 1000).toISOString();
    try {
      opened.db
        .insert(agentProviders)
        .values({ id: providerId, name: 'codex', accountLabel: 'default' })
        .run();
      opened.db
        .insert(agentModels)
        .values({
          id: 'amodel_test_still_exhausted',
          providerId,
          modelRef: 'auto',
          routingClass: 'codex',
          visible: true,
          authenticated: false,
          availability: 'exhausted',
          nextProbeAt: future,
        })
        .run();
    } finally {
      opened.sqlite.close();
    }

    probeResult = {
      installed: true,
      authenticated: false,
      executable: '/opt/major/providers/v1/codex/bin/codex-native',
      detail: 'still not authenticated',
    };
    await runProviderLifecycleCli(['provider', 'probe', '--provider', 'codex']);

    const verify = openDb(dbPath);
    try {
      const model = verify.db
        .select()
        .from(agentModels)
        .where(eq(agentModels.providerId, providerId))
        .get();
      expect(model?.availability).toBe('exhausted');
      expect(model?.nextProbeAt).toBe(future);
    } finally {
      verify.sqlite.close();
    }
  });
});

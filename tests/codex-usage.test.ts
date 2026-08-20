import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  authenticatedCodexAccountLabels,
  CODEX_CAPACITY_MAX_LINE_WIDTH,
  collectCodexUsage,
  formatCodexCapacityOverview,
  formatCodexUsage,
  readCodexUsageReport,
  usageBar,
  windowLabel,
  writeCodexUsageReport,
} from '../src/providers/codex-usage.js';

function expectCompactLines(text: string): void {
  for (const line of text.split('\n')) {
    expect(line.length, line).toBeLessThanOrEqual(CODEX_CAPACITY_MAX_LINE_WIDTH);
  }
}
import type { ModelState, ProviderInfo } from '../src/providers/types.js';

function model(overrides: Partial<ModelState> = {}): ModelState {
  return {
    modelRef: 'gpt-codex',
    routingClass: 'codex',
    visible: true,
    authenticated: true,
    availability: 'available',
    billingMode: 'subscription_included',
    prohibited: false,
    source: 'persisted',
    ...overrides,
  };
}

function provider(name: string, overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return {
    name,
    installed: true,
    authenticated: true,
    models: [model()],
    ...overrides,
  };
}

describe('Codex usage monitor selection and formatting', () => {
  it('reads only authenticated Codex accounts from persisted state, default first', () => {
    expect(
      authenticatedCodexAccountLabels([
        provider('codex#work-b'),
        provider('claude-code'),
        provider('codex'),
        provider('codex#personal', {
          models: [model({ authenticated: false })],
          authenticated: false,
        }),
      ]),
    ).toEqual(['default', 'work-b']);
  });

  it('formats a compact refreshed two-account snapshot without emails or secrets', () => {
    const now = new Date('2026-08-17T18:00:00.000Z');
    const report = {
      fetchedAt: now.toISOString(),
      methods: ['account/read', 'account/rateLimits/read'] as const,
      accounts: [
        {
          accountLabel: 'default',
          planType: 'plus',
          accountKind: 'chatgpt',
          primary: {
            usedPercent: 42,
            windowDurationMins: 300,
            resetsAt: Math.floor(now.getTime() / 1000) + 2 * 3600,
          },
          secondary: {
            usedPercent: 18,
            windowDurationMins: 10_080,
            resetsAt: Math.floor(now.getTime() / 1000) + 4 * 86400,
          },
        },
        {
          accountLabel: 'work-b',
          error: 'no Codex credential in the provider-auth store for work-b',
        },
      ],
    };
    const text = formatCodexUsage(report, now);
    expect(text).toBe(
      [
        'CODEX CAPACITY',
        'snapshot source: account/read + account/rateLimits/read',
        'usage refreshed at 2026-08-17T18:00:00.000Z  refresh: major provider usage',
        '',
        'default  plus     5h [####......] 42% 2h   week [##........] 18% 4d healthy',
        'work-b   error  no Codex credential in the provider-auth store for work-b',
      ].join('\n'),
    );
    expectCompactLines(text);
    expect(text).not.toMatch(/@|token|sk-/i);
    expect(windowLabel(300)).toBe('5h');
    expect(windowLabel(10_080)).toBe('week');
    expect(usageBar(42)).toBe('####......');
    expect(usageBar(91)).toBe('#########.');

    const overview = formatCodexCapacityOverview(report, now);
    expect(overview).toBe(
      [
        'Codex capacity:',
        '  default  plus     5h [####......] 42% 2h   week [##........] 18% 4d healthy',
        '  work-b   error  no Codex credential in the provider-auth store for work-b',
        '  usage at last refresh 2026-08-17T18:00:00.000Z',
        '  source: account/read + account/rateLimits/read',
        '  refresh: major provider usage',
      ].join('\n'),
    );
    expectCompactLines(overview);
    expect(
      formatCodexUsage(
        {
          fetchedAt: now.toISOString(),
          methods: ['account/read', 'account/rateLimits/read'],
          accounts: [
            {
              accountLabel: 'default',
              planType: 'pro',
              primary: { usedPercent: 25, windowDurationMins: 15 },
            },
          ],
        },
        now,
      ),
    ).toMatch(/default\s+pro\s+15m \[###\.{7}\] 25% -\s+-/);
  });

  it('collects per-account failures without aborting the other account', async () => {
    const report = await collectCodexUsage(['default', 'work-b'], async (label) => {
      if (label === 'default') {
        return { planType: 'plus', primary: { usedPercent: 1, windowDurationMins: 300 } };
      }
      throw new Error('chatgpt authentication required to read rate limits for owner@example.com');
    });
    expect(report.methods).toEqual(['account/read', 'account/rateLimits/read']);
    expect(report.accounts[0]).toMatchObject({ accountLabel: 'default', planType: 'plus' });
    expect(report.accounts[1]).toMatchObject({
      accountLabel: 'work-b',
      error: 'chatgpt authentication required to read rate limits for [redacted]',
    });
    expect(JSON.stringify(report)).not.toMatch(/@example\.com/);
  });

  it('clips long per-account errors so control-surface rows stay compact', () => {
    const text = formatCodexUsage({
      fetchedAt: '2026-08-17T18:00:00.000Z',
      methods: ['account/read', 'account/rateLimits/read'],
      accounts: [
        {
          accountLabel: 'default',
          error: `could not stage Codex credentials for default: ${'x'.repeat(120)}`,
        },
      ],
    });
    expectCompactLines(text);
    expect(text).toMatch(/default\s+error\s+could not stage Codex credentials/);
    expect(text).toMatch(/\.\.\.$/m);
  });

  it('persists a two-account snapshot that survives a fresh process read (restart proof)', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-codex-capacity-'));
    const priorHome = process.env.MAJOR_HOME;
    const priorPath = process.env.MAJOR_CODEX_USAGE_PATH;
    process.env.MAJOR_HOME = home;
    delete process.env.MAJOR_CODEX_USAGE_PATH;
    try {
      const now = new Date('2026-08-17T18:00:00.000Z');
      writeCodexUsageReport({
        fetchedAt: now.toISOString(),
        methods: ['account/read', 'account/rateLimits/read'],
        accounts: [
          {
            accountLabel: 'default',
            planType: 'plus',
            primary: { usedPercent: 42, windowDurationMins: 300, resetsAt: 1_780_000_000 },
          },
          {
            accountLabel: 'work-b',
            planType: 'plus',
            primary: { usedPercent: 91, windowDurationMins: 300, resetsAt: 1_780_003_600 },
          },
        ],
      });
      const reloaded = readCodexUsageReport();
      expect(reloaded?.accounts.map((account) => account.accountLabel)).toEqual([
        'default',
        'work-b',
      ]);
      expect(reloaded?.methods).toEqual(['account/read', 'account/rateLimits/read']);
      const overview = formatCodexCapacityOverview(reloaded, now);
      expect(overview).toMatch(/default\s+plus\s+5h \[####\.{6}\] 42%/);
      expect(overview).toMatch(/work-b\s+plus\s+5h \[#{9}\.\] 91%/);
      expect(overview).toMatch(/refresh: major provider usage/);
      expectCompactLines(overview);
      expect(readFileSync(join(home, 'codex-usage.json'), 'utf8')).not.toMatch(/@|token|sk-/i);

      writeCodexUsageReport({
        fetchedAt: '2026-08-17T19:00:00.000Z',
        methods: ['account/read', 'account/rateLimits/read'],
        accounts: [
          {
            accountLabel: 'default',
            planType: 'plus',
            primary: { usedPercent: 55, windowDurationMins: 300 },
          },
          {
            accountLabel: 'work-b',
            planType: 'plus',
            primary: { usedPercent: 10, windowDurationMins: 300 },
          },
        ],
      });
      const refreshed = formatCodexCapacityOverview(readCodexUsageReport(), now);
      expect(refreshed).toMatch(/5h \[#{6}\.{4}\] 55%/);
      expect(refreshed).toMatch(/5h \[#\.{9}\] 10%/);
      expect(refreshed).not.toMatch(/42%|91%/);
      expectCompactLines(refreshed);

      writeCodexUsageReport({
        fetchedAt: '2026-08-17T19:05:00.000Z',
        methods: ['account/read', 'account/rateLimits/read'],
        accounts: [
          {
            accountLabel: 'default',
            planType: 'plus',
            primary: { windowDurationMins: 300 },
          },
        ],
      });
      expect(readCodexUsageReport()?.accounts[0]?.primary).toEqual({ windowDurationMins: 300 });
    } finally {
      if (priorHome === undefined) delete process.env.MAJOR_HOME;
      else process.env.MAJOR_HOME = priorHome;
      if (priorPath === undefined) delete process.env.MAJOR_CODEX_USAGE_PATH;
      else process.env.MAJOR_CODEX_USAGE_PATH = priorPath;
      rmSync(home, { recursive: true, force: true });
    }
  });
});

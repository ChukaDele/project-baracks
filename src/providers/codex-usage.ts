/**
 * Compact Codex capacity UI: select already-authenticated Codex accounts
 * from persisted Major state, format live App Server snapshots, and keep a
 * last-known snapshot for the control surface. Does not write
 * provider/model availability or change routing.
 *
 * `major provider usage` is the only refresh. `major status` and session
 * attach read the snapshot file and never spawn App Server.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { DEFAULT_ACCOUNT_LABEL, parseCapacityKey } from './account.js';
import {
  parseRateLimitWindow,
  type CodexAppServerSnapshot,
  type CodexRateLimitWindow,
} from './codex-app-server.js';
import type { ProviderInfo } from './types.js';

export interface CodexUsageAccount extends CodexAppServerSnapshot {
  accountLabel: string;
  error?: string;
}

export const CODEX_USAGE_METHODS = ['account/read', 'account/rateLimits/read'] as const;

export const CODEX_CAPACITY_BAR_WIDTH = 10;

/** Compact control-surface rows must not wrap on a standard 80-col terminal. */
export const CODEX_CAPACITY_MAX_LINE_WIDTH = 80;

const CONTROL_SURFACE_INDENT = '  ';
const CODEX_SNAPSHOT_MAX_AGE_MS = 15 * 60 * 1000;

export interface CodexUsageReport {
  fetchedAt: string;
  methods: typeof CODEX_USAGE_METHODS;
  accounts: CodexUsageAccount[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function snapshotHome(): string {
  return process.env.MAJOR_HOME ? resolve(process.env.MAJOR_HOME) : join(homedir(), '.major');
}

export function codexUsageSnapshotPath(): string {
  return process.env.MAJOR_CODEX_USAGE_PATH
    ? resolve(process.env.MAJOR_CODEX_USAGE_PATH)
    : join(snapshotHome(), 'codex-usage.json');
}

export function codexUsageReport(
  accounts: CodexUsageAccount[],
  fetchedAt: Date = new Date(),
): CodexUsageReport {
  return {
    fetchedAt: fetchedAt.toISOString(),
    methods: CODEX_USAGE_METHODS,
    accounts,
  };
}

export function authenticatedCodexAccountLabels(infos: readonly ProviderInfo[]): string[] {
  const labels = new Set<string>();
  for (const info of infos) {
    const parsed = parseCapacityKey(info.name);
    if (parsed.providerName !== 'codex') continue;
    const authenticated =
      info.authenticated === true || info.models.some((model) => model.authenticated);
    if (!authenticated) continue;
    labels.add(parsed.accountLabel);
  }
  return [...labels].sort((left, right) => {
    if (left === DEFAULT_ACCOUNT_LABEL) return -1;
    if (right === DEFAULT_ACCOUNT_LABEL) return 1;
    return left.localeCompare(right);
  });
}

export function windowLabel(mins: number | undefined): string {
  if (mins === undefined) return 'win';
  if (mins === 300) return '5h';
  if (mins === 10080) return 'week';
  if (mins % 1440 === 0) return `${mins / 1440}d`;
  if (mins % 60 === 0) return `${mins / 60}h`;
  return `${mins}m`;
}

export function formatReset(window: CodexRateLimitWindow | undefined, now: Date): string {
  if (window?.resetsAt === undefined) return '-';
  const remainingMs = window.resetsAt * 1000 - now.getTime();
  if (remainingMs <= 0) return 'now';
  const mins = Math.max(1, Math.round(remainingMs / 60_000));
  if (mins < 60) return `${mins}m`;
  const hours = Math.round(mins / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

/** Usage output may include provider errors; never print account emails. */
export function redactCodexUsageText(text: string): string {
  return text.replace(EMAIL_PATTERN, '[redacted]');
}

/** Compact quota bar for the control-surface UI. 42% of 10 cells → 4 filled. */
export function usageBar(
  percent: number | undefined,
  width: number = CODEX_CAPACITY_BAR_WIDTH,
): string {
  if (percent === undefined || !Number.isFinite(percent) || width <= 0) {
    return '.'.repeat(Math.max(0, width));
  }
  const clamped = Math.max(0, Math.min(100, percent));
  const filled = Math.max(0, Math.min(width, Math.round((clamped / 100) * width)));
  return `${'#'.repeat(filled)}${'.'.repeat(width - filled)}`;
}

function formatWindow(window: CodexRateLimitWindow | undefined, now: Date): string {
  if (!window) return '-';
  const percent = window.usedPercent === undefined ? '-' : `${Math.round(window.usedPercent)}%`;
  const label = windowLabel(window.windowDurationMins);
  const bar = usageBar(window.usedPercent);
  return `${label} [${bar}] ${percent} ${formatReset(window, now)}`;
}

export function codexRefreshHealth(
  account: CodexUsageAccount,
): 'healthy' | 'exhausted' | 'unknown' | 'error' {
  if (account.error) return 'error';
  const usedPercent = account.primary?.usedPercent;
  if (usedPercent === undefined || !Number.isFinite(usedPercent)) return 'unknown';
  return usedPercent >= 100 ? 'exhausted' : 'healthy';
}

export function formatCodexCapacityRows(
  report: CodexUsageReport,
  now: Date = new Date(report.fetchedAt),
): string[] {
  if (report.accounts.length === 0) {
    return ['No authenticated Codex accounts. Run `major provider connect codex`.'];
  }
  const labelWidth = Math.max(7, ...report.accounts.map((account) => account.accountLabel.length));
  const maxRow = CODEX_CAPACITY_MAX_LINE_WIDTH - CONTROL_SURFACE_INDENT.length;
  return report.accounts.map((account) => {
    const label = account.accountLabel.padEnd(labelWidth);
    if (account.error) {
      const prefix = `${label}  error  `;
      const detail = redactCodexUsageText(account.error);
      const budget = Math.max(0, maxRow - prefix.length);
      const clipped =
        detail.length <= budget ? detail : `${detail.slice(0, Math.max(0, budget - 3))}...`;
      return `${prefix}${clipped}`;
    }
    const plan = (account.planType ?? account.accountKind ?? 'chatgpt').padEnd(8);
    const primary = formatWindow(account.primary, now);
    const secondary = formatWindow(account.secondary, now);
    return `${label}  ${plan} ${primary}   ${secondary} ${codexRefreshHealth(account)}`;
  });
}

export function formatCodexUsage(
  report: CodexUsageReport,
  now: Date = new Date(report.fetchedAt),
): string {
  return [
    'CODEX CAPACITY',
    'snapshot source: account/read + account/rateLimits/read',
    `usage refreshed at ${report.fetchedAt}  refresh: major provider usage`,
    '',
    ...formatCodexCapacityRows(report, now),
  ].join('\n');
}

/** Labeled block for `major status` / session attach. Never live-queries. */
export function formatCodexCapacityOverview(
  report: CodexUsageReport | undefined,
  now?: Date,
): string {
  if (!report) {
    return 'Codex capacity:       no refreshed snapshot — run `major provider usage`';
  }
  const rows = formatCodexCapacityRows(report, now ?? new Date(report.fetchedAt));
  const observedAt = now ?? new Date();
  const fetchedAt = new Date(report.fetchedAt);
  const stale = observedAt.getTime() - fetchedAt.getTime() > CODEX_SNAPSHOT_MAX_AGE_MS;
  // Keep quota bars on following lines. A 22-char status prefix plus a
  // two-window row is 89 columns and wraps on a standard terminal.
  return [
    'Codex capacity:',
    ...rows.map((row) => `${CONTROL_SURFACE_INDENT}${row}`),
    `${CONTROL_SURFACE_INDENT}usage at last refresh ${report.fetchedAt}${stale ? ' (stale)' : ''}`,
    `${CONTROL_SURFACE_INDENT}source: account/read + account/rateLimits/read`,
    `${CONTROL_SURFACE_INDENT}refresh: major provider usage`,
  ].join('\n');
}

function parsePersistedAccount(value: unknown): CodexUsageAccount | undefined {
  if (!isRecord(value) || typeof value.accountLabel !== 'string' || value.accountLabel === '') {
    return undefined;
  }
  if (typeof value.error === 'string' && value.error.trim() !== '') {
    return { accountLabel: value.accountLabel, error: redactCodexUsageText(value.error) };
  }
  const planType = typeof value.planType === 'string' ? value.planType : undefined;
  const accountKind = typeof value.accountKind === 'string' ? value.accountKind : undefined;
  const primary = parseRateLimitWindow(value.primary);
  const secondary = parseRateLimitWindow(value.secondary);
  for (const [supplied, parsed] of [
    [value.primary, primary],
    [value.secondary, secondary],
  ] as const) {
    if (supplied === undefined) continue;
    if (!parsed || !isRecord(supplied)) return undefined;
    for (const key of ['usedPercent', 'used_percent'] as const) {
      if (!Object.prototype.hasOwnProperty.call(supplied, key)) continue;
      if (typeof supplied[key] !== 'number' || !Number.isFinite(supplied[key])) return undefined;
    }
  }
  return {
    accountLabel: value.accountLabel,
    ...(planType ? { planType } : {}),
    ...(accountKind ? { accountKind } : {}),
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
  };
}

export function parseCodexUsageReport(value: unknown): CodexUsageReport | undefined {
  if (!isRecord(value)) return undefined;
  const methods = value.methods;
  if (
    typeof value.fetchedAt !== 'string' ||
    !Number.isFinite(Date.parse(value.fetchedAt)) ||
    !Array.isArray(methods) ||
    methods.length !== CODEX_USAGE_METHODS.length ||
    !CODEX_USAGE_METHODS.every((method, index) => methods[index] === method) ||
    !Array.isArray(value.accounts)
  ) {
    return undefined;
  }
  const accounts: CodexUsageAccount[] = [];
  for (const row of value.accounts) {
    const parsed = parsePersistedAccount(row);
    if (!parsed) return undefined;
    accounts.push(parsed);
  }
  return {
    fetchedAt: value.fetchedAt,
    methods: CODEX_USAGE_METHODS,
    accounts,
  };
}

export function writeCodexUsageReport(report: CodexUsageReport): void {
  const path = codexUsageSnapshotPath();
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const persisted = parseCodexUsageReport(report) ?? report;
  writeFileSync(path, `${JSON.stringify(persisted, null, 2)}\n`, { mode: 0o600 });
}

export function readCodexUsageReport(): CodexUsageReport | undefined {
  const path = codexUsageSnapshotPath();
  if (!existsSync(path)) return undefined;
  try {
    return parseCodexUsageReport(JSON.parse(readFileSync(path, 'utf8')) as unknown);
  } catch {
    return undefined;
  }
}

export async function collectCodexUsage(
  accountLabels: readonly string[],
  readAccount: (accountLabel: string) => Promise<CodexAppServerSnapshot>,
  now: () => Date = () => new Date(),
): Promise<CodexUsageReport> {
  const accounts: CodexUsageAccount[] = [];
  for (const accountLabel of accountLabels) {
    try {
      const snapshot = await readAccount(accountLabel);
      accounts.push({ accountLabel, ...snapshot });
    } catch (error) {
      accounts.push({
        accountLabel,
        error: redactCodexUsageText(error instanceof Error ? error.message : String(error)),
      });
    }
  }
  return codexUsageReport(accounts, now());
}

import { existsSync, readFileSync } from 'node:fs';
import { arch, homedir, platform, release } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadLimaExecutionConfig } from '../execution/lima-config.js';
import { redactValue } from '../security/redact.js';
import type { DoctorReport } from './doctor.js';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

interface InstalledReleaseRecord {
  version?: string;
  sha?: string;
  branch?: string;
  installedAt?: string;
  releaseGate?: string;
}

interface InstallHistoryEntry {
  version?: string;
  sha?: string;
  installedAt?: string;
  rollback?: boolean;
}

export interface SupportBundle {
  generatedAt: string;
  os: { platform: string; release: string; arch: string };
  major: {
    version: string | null;
    installedSha: string | null;
    installedBranch: string | null;
    installedAt: string | null;
    /** What install-time verification recorded — not a live re-check. */
    releaseGateAtInstall: string | null;
  };
  worker: { instance: string | null; isolationScope: string | null };
  core: { ready: boolean; issues: string[] };
  providers: Array<{ provider: string; state: string; detail: string }>;
  models: Array<{
    provider: string;
    modelRef: string;
    routingClass: string;
    availability: string;
    billingMode: string;
  }>;
  liveExecution: { ready: boolean; healthyProviderCount: number; blockers: string[] };
  multiProviderReady: boolean;
  capabilities: Array<{ capability: string; available: boolean; milestone?: string }>;
  /** Non-'ok' checks only — a category label plus already-redacted detail. */
  errorChecks: Array<{ name: string; status: string; detail: string }>;
  /** Most recent install/rollback events: version + git sha + timestamp only. */
  installHistory: InstallHistoryEntry[];
}

function readJsonSafe(path: string): unknown {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function readInstallHistory(path: string, limit: number): InstallHistoryEntry[] {
  if (!existsSync(path)) return [];
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const entries: InstallHistoryEntry[] = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line) as InstallHistoryEntry);
    } catch {
      // A corrupt line is dropped, not surfaced — never let unparsed bytes
      // from a lifecycle log flow into a diagnostic bundle unexamined.
    }
  }
  return entries.slice(-limit);
}

export function buildSupportBundle(
  report: DoctorReport,
  opts: { majorHome?: string; now?: () => Date } = {},
): SupportBundle {
  const home = opts.majorHome ?? join(homedir(), '.major');
  const installedRelease = readJsonSafe(
    join(home, 'installed-release.json'),
  ) as InstalledReleaseRecord | null;
  const fallbackVersion = (
    readJsonSafe(join(REPO_ROOT, 'package.json')) as { version?: string } | null
  )?.version;

  let workerInstance: string | null = null;
  let isolationScope: string | null = null;
  try {
    const config = loadLimaExecutionConfig(join(home, 'execution.json'));
    workerInstance = config.instance;
    isolationScope = config.isolationScope;
  } catch {
    workerInstance = null;
    isolationScope = null;
  }

  const bundle: SupportBundle = {
    generatedAt: (opts.now?.() ?? new Date()).toISOString(),
    os: { platform: platform(), release: release(), arch: arch() },
    major: {
      version: installedRelease?.version ?? fallbackVersion ?? null,
      installedSha: installedRelease?.sha ?? null,
      installedBranch: installedRelease?.branch ?? null,
      installedAt: installedRelease?.installedAt ?? null,
      releaseGateAtInstall: installedRelease?.releaseGate ?? null,
    },
    worker: { instance: workerInstance, isolationScope },
    core: { ready: report.core.ready, issues: report.core.issues },
    providers: report.providerReadiness.map((p) => ({
      provider: p.provider,
      state: p.state,
      detail: p.detail,
    })),
    models: report.providers.flatMap((p) =>
      p.models.map((m) => ({
        provider: p.name,
        modelRef: m.modelRef,
        routingClass: m.routingClass,
        availability: m.availability,
        billingMode: m.billingMode,
      })),
    ),
    liveExecution: {
      ready: report.liveExecution.ready,
      healthyProviderCount: report.liveExecution.healthyProviders.length,
      blockers: report.liveExecution.blockers,
    },
    multiProviderReady: report.multiProviderReady,
    capabilities: report.capabilities.map((c) => ({
      capability: c.capability,
      available: c.available,
      milestone: c.milestone,
    })),
    errorChecks: report.checks
      .filter((c) => c.status !== 'ok')
      .map((c) => ({ name: c.name, status: c.status, detail: c.detail })),
    installHistory: readInstallHistory(join(home, 'install-history.jsonl'), 10),
  };

  // Defense in depth: every field above is already drawn from curated,
  // non-secret sources, but redact structurally anyway so a future field
  // added here without the same care fails closed instead of leaking.
  return redactValue(bundle);
}

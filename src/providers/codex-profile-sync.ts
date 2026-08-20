/**
 * Explicit onboarding bridge from owner-approved Codex profile policy rows
 * into persisted named-account routing slots. This is the only path that
 * imports policy credentials and writes codex#label ProviderInfo availability.
 *
 * `major provider usage` remains read-only; run `major provider sync-profiles`
 * deliberately when policy profiles should become routable siblings.
 */
import { existsSync, lstatSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Db } from '../db/client.js';
import type { BillingMode, ModelAvailability } from '../db/schema.js';
import type { ExecutionBackend } from '../execution/backend.js';
import {
  capacityKey,
  DEFAULT_ACCOUNT_LABEL,
  mapPolicyIdsToAccountLabels,
  parseCapacityKey,
} from './account.js';
import { codexRefreshHealth, type CodexUsageAccount } from './codex-usage.js';
import { readCodexProfilePolicy } from './codex-profile-reader.js';
import {
  loadPersistedProviderInfos,
  persistProviderDiscovery,
  recordBillingObservation,
} from './discovery-store.js';
import { loadModelRegistry, registryModels } from './registry.js';
import type { ModelState, ProviderInfo } from './types.js';

export interface CodexProfileSyncRow {
  policyId: string;
  accountLabel: string;
  imported: boolean;
  availability?: ModelAvailability;
  detail: string;
}

export interface CodexProfileSyncReport {
  syncedAt: string;
  profiles: CodexProfileSyncRow[];
  error?: string;
}

function profileAuthPath(home: string): string {
  return join(resolve(home), 'auth.json');
}

function usageAvailability(account: CodexUsageAccount): ModelAvailability {
  const health = codexRefreshHealth(account);
  if (health === 'healthy') return 'available';
  if (health === 'exhausted') return 'exhausted';
  return 'unknown';
}

/** Record subscription billing only when live app-server plan/account evidence exists. */
export function billingModeForSyncedCodexProfile(
  usage: CodexUsageAccount,
): Exclude<BillingMode, 'unknown'> | undefined {
  if (usage.error) return undefined;
  const kind = usage.accountKind?.toLowerCase();
  const plan = usage.planType?.trim();
  if (kind === 'chatgpt' && plan) return 'subscription_included';
  return undefined;
}

function buildProviderInfo(input: {
  accountLabel: string;
  executable?: string;
  usage: CodexUsageAccount;
  inheritedBilling?: Exclude<BillingMode, 'unknown'>;
}): ProviderInfo {
  const registry = loadModelRegistry();
  const authenticated = !input.usage.error;
  const availability = usageAvailability(input.usage);
  const models: ModelState[] = registryModels(registry, 'codex', {
    visible: authenticated,
    authenticated,
  }).map((model) => ({
    ...model,
    availability: authenticated ? availability : 'unknown',
    ...(input.inheritedBilling ? { billingMode: input.inheritedBilling } : {}),
  }));
  return {
    name: capacityKey('codex', input.accountLabel),
    installed: authenticated,
    authenticated,
    ...(input.executable !== undefined ? { executable: input.executable } : {}),
    models,
  };
}

export async function syncApprovedCodexProfiles(
  backend: ExecutionBackend & {
    importCodexProfileCredential?: (
      profileAuthPath: string,
      accountLabel: string,
    ) => Promise<{ ok: true; detail: string } | { ok: false; detail: string }>;
    readCodexUsage: (accountLabels: readonly string[]) => Promise<CodexUsageAccount[]>;
  },
  db: Db,
  now: () => Date = () => new Date(),
): Promise<CodexProfileSyncReport> {
  const syncedAt = now().toISOString();
  const policy = readCodexProfilePolicy();
  if (!policy) {
    return {
      syncedAt,
      profiles: [],
      error: 'no Codex profile policy found at ~/.major/codex-account-policy.json',
    };
  }
  const active = policy.accounts.filter((row) => row.role === 'active');
  if (active.length === 0) {
    return { syncedAt, profiles: [], error: 'Codex profile policy has no active profiles' };
  }

  const mapped = mapPolicyIdsToAccountLabels(active.map((row) => row.id));
  if ('error' in mapped) {
    return { syncedAt, profiles: [], error: mapped.error };
  }

  if (typeof backend.importCodexProfileCredential !== 'function') {
    return {
      syncedAt,
      profiles: [],
      error: 'Codex profile import is unavailable in the current execution backend',
    };
  }

  const existing = loadPersistedProviderInfos(db);
  const defaultExecutable = existing.find(
    (info) =>
      parseCapacityKey(info.name).providerName === 'codex' &&
      parseCapacityKey(info.name).accountLabel === DEFAULT_ACCOUNT_LABEL,
  )?.executable;

  const profiles: CodexProfileSyncRow[] = [];
  const probedLabels: string[] = [];

  for (const row of active) {
    const accountLabel = mapped.labels.get(row.id)!;
    const authPath = profileAuthPath(row.home);
    if (!existsSync(authPath) || !lstatSync(authPath).isFile()) {
      profiles.push({
        policyId: row.id,
        accountLabel,
        imported: false,
        detail: 'approved Codex profile credential is unavailable',
      });
      continue;
    }

    const imported = await backend.importCodexProfileCredential(authPath, accountLabel);
    if (!imported.ok) {
      profiles.push({
        policyId: row.id,
        accountLabel,
        imported: false,
        detail: imported.detail,
      });
      continue;
    }

    probedLabels.push(accountLabel);
    profiles.push({
      policyId: row.id,
      accountLabel,
      imported: true,
      detail: imported.detail,
    });
  }

  const usageByLabel = new Map<string, CodexUsageAccount>();
  if (probedLabels.length > 0) {
    const usage = await backend.readCodexUsage(probedLabels);
    for (const account of usage) usageByLabel.set(account.accountLabel, account);
  }

  for (const profile of profiles) {
    if (!profile.imported) continue;
    const usage = usageByLabel.get(profile.accountLabel) ?? {
      accountLabel: profile.accountLabel,
      error: 'usage probe did not return this account',
    };
    const billing = billingModeForSyncedCodexProfile(usage);
    const info = buildProviderInfo({
      accountLabel: profile.accountLabel,
      ...(defaultExecutable !== undefined ? { executable: defaultExecutable } : {}),
      usage,
      ...(billing !== undefined ? { inheritedBilling: billing } : {}),
    });
    persistProviderDiscovery(db, info, {
      source: 'probe',
      note: `sync-profiles: ${profile.policyId}`,
      bypassBackoff: true,
    });
    if (billing) {
      for (const model of info.models) {
        if (model.billingMode === billing) {
          recordBillingObservation(db, {
            providerName: info.name,
            modelRef: model.modelRef,
            billingMode: billing,
            source: 'human',
            note: `app-server ${usage.accountKind}/${usage.planType} for owner-approved active profile ${profile.policyId}`,
          });
        }
      }
    }
    profile.availability = usageAvailability(usage);
    if (usage.error) profile.detail = `${profile.detail}; usage: ${usage.error}`;
  }

  if (profiles.length > 0 && profiles.every((profile) => !profile.imported)) {
    return {
      syncedAt,
      profiles,
      error: 'every active Codex profile import failed',
    };
  }

  return { syncedAt, profiles };
}

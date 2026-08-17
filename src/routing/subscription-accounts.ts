/**
 * Quota-aware multi-account router that sits beneath the provider/class
 * ladder. It never replaces `route()`: it only decides which persisted
 * provider rows (capacity keys) the ladder may consider.
 *
 * Observed exhaustion/rate-limit on one account is capacity unavailability,
 * not a reason to leave the provider. Sibling accounts of the same CLI stay
 * in the pool; vendor session IDs never cross accounts or hosts.
 */

import { capacityKey, DEFAULT_ACCOUNT_LABEL, parseCapacityKey } from '../providers/account.js';
import type { ModelState, ProviderInfo } from '../providers/types.js';

export function providerHasUsableCapacity(info: ProviderInfo): boolean {
  return info.models.some(usableSubscriptionModel);
}

export function usableSubscriptionModel(model: ModelState): boolean {
  return (
    model.visible &&
    model.authenticated &&
    !model.prohibited &&
    (model.availability === 'available' || model.retryEligible === true) &&
    model.billingMode !== 'unknown'
  );
}

function quotaRank(info: ProviderInfo): number {
  if (
    info.models.some(
      (model) => usableSubscriptionModel(model) && model.availability === 'available',
    )
  ) {
    return 0;
  }
  if (info.models.some((model) => usableSubscriptionModel(model) && model.retryEligible === true)) {
    return 1;
  }
  return 2;
}

function byQuotaThenName(left: ProviderInfo, right: ProviderInfo): number {
  const rank = quotaRank(left) - quotaRank(right);
  return rank !== 0 ? rank : left.name.localeCompare(right.name);
}

export function compareSubscriptionAccounts(
  left: ProviderInfo,
  right: ProviderInfo,
  preferredProvider?: string,
): number {
  if (preferredProvider) {
    const leftPreferred = parseCapacityKey(left.name).providerName === preferredProvider;
    const rightPreferred = parseCapacityKey(right.name).providerName === preferredProvider;
    if (leftPreferred && !rightPreferred) return -1;
    if (rightPreferred && !leftPreferred) return 1;
  }
  return byQuotaThenName(left, right);
}

export function lastCapacityKey(input: {
  lastCoordinator?: string;
  /** Used only when no hop has been recorded yet, so a preferred Codex
   * goal can still quota-rotate onto a sibling account on first dispatch. */
  preferredCoordinator?: string;
  lastAccountLabel?: string;
  hostProviders: Record<string, string>;
}): string | undefined {
  const host = input.lastCoordinator ?? input.preferredCoordinator;
  if (!host) return undefined;
  const providerName = input.hostProviders[host];
  if (!providerName) return undefined;
  return capacityKey(providerName, input.lastAccountLabel ?? DEFAULT_ACCOUNT_LABEL);
}

/**
 * Narrow or filter the provider list before `route()`.
 *
 * 1. Last used account is unusable and a sibling account remains → stay on
 *    that provider (quota rotation; quality ladder does not hop away).
 * 2. Two consecutive work failures → drop only the last capacity key, not
 *    every account of the provider.
 * 3. Otherwise pass the full list through.
 */
export function subscriptionAccountPool(input: {
  providers: ProviderInfo[];
  lastCapacityKey?: string;
  consecutiveFailures: number;
}): { providers: ProviderInfo[]; reason?: string } {
  const lastKey = input.lastCapacityKey;
  if (!lastKey) return { providers: input.providers };

  const last = input.providers.find((provider) => provider.name === lastKey);
  const { providerName } = parseCapacityKey(lastKey);
  const siblings = input.providers.filter(
    (provider) =>
      provider.name !== lastKey && parseCapacityKey(provider.name).providerName === providerName,
  );

  if ((!last || !providerHasUsableCapacity(last)) && siblings.length > 0) {
    const usableSiblings = siblings.filter(providerHasUsableCapacity);
    const pool = usableSiblings.length > 0 ? usableSiblings : siblings;
    return {
      providers: [...pool].sort(byQuotaThenName),
      reason:
        usableSiblings.length > 0
          ? `quota rotation: ${lastKey} unusable; staying on ${providerName} sibling accounts`
          : `quota rotation: ${lastKey} unusable; ${providerName} sibling accounts exist but are not yet routable`,
    };
  }

  if (input.consecutiveFailures >= 2) {
    return {
      providers: input.providers.filter((provider) => provider.name !== lastKey),
      reason: `work-failure rotation: excluding ${lastKey}`,
    };
  }

  return { providers: input.providers };
}

export function contextContinuity(input: {
  lastCoordinator?: string;
  lastAccountLabel?: string;
  lastSessionRef?: string;
  lastSummary?: string;
  nextHost: string;
  nextAccountLabel: string;
}): { resumeSessionRef?: string; promptBlock: string } {
  const previousAccount = input.lastAccountLabel ?? DEFAULT_ACCOUNT_LABEL;
  const previousSlot = `${input.lastCoordinator ?? 'unassigned'}/${previousAccount}`;
  const nextSlot = `${input.nextHost}/${input.nextAccountLabel}`;
  const sameAccount =
    input.lastCoordinator === input.nextHost && previousAccount === input.nextAccountLabel;
  const resumeSessionRef = sameAccount && input.lastSessionRef ? input.lastSessionRef : undefined;
  const summary = input.lastSummary?.trim();
  const lines = ['CONTEXT CONTINUITY:'];
  if (resumeSessionRef) {
    lines.push(
      `Resuming the vendor session on the same ${nextSlot} subscription. Preserve that conversation; do not restart the goal.`,
    );
  } else if (summary) {
    lines.push(
      sameAccount
        ? 'Continuing the same goal on this account without a vendor session resume.'
        : `Previous subscription '${previousSlot}' is no longer the active slot. Continuing the SAME goal on '${nextSlot}' without resuming a vendor session id that belongs to another account.`,
    );
    lines.push(`Prior cycle summary:\n${summary}`);
  } else {
    lines.push('(No prior cycle summary. This is the first hop of the goal.)');
  }
  return resumeSessionRef
    ? { resumeSessionRef, promptBlock: lines.join('\n') }
    : { promptBlock: lines.join('\n') };
}

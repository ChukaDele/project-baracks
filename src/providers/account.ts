/**
 * Opaque capacity-key encoding for one authenticated account/profile of a
 * provider. Major never stores raw credentials here — only a label the owner
 * assigns when a second legitimate account/subscription is configured.
 *
 * The default account round-trips as the bare provider name, so every
 * existing single-account caller, persisted row and test fixture is
 * unaffected: multi-account routing is additive, not a breaking migration.
 *
 * Named-account credentials live in a sibling store slot
 * (`provider-auth/<host>/accounts/<label>/...`) so importing a second Codex
 * login cannot overwrite the default slot. Coordinator dispatch passes the
 * selected label into the Lima provider-state broker, which materializes
 * that slot into the ephemeral run home.
 */

export const DEFAULT_ACCOUNT_LABEL = 'default';

const SEPARATOR = '#';

/** Owner-assigned labels only. Rejects path traversal, separators and the
 * reserved store directory name `accounts`. */
export const ACCOUNT_LABEL_PATTERN = /^[a-z][a-z0-9-]{0,31}$/;

export function assertAccountLabel(label: string): string {
  if (label === DEFAULT_ACCOUNT_LABEL) return label;
  if (!ACCOUNT_LABEL_PATTERN.test(label) || label === 'accounts') {
    throw new Error(
      `invalid account label '${label}': use ${ACCOUNT_LABEL_PATTERN} and not the reserved name 'accounts'`,
    );
  }
  return label;
}

/**
 * Map an owner-approved Codex policy id (e.g. COD-01) into a routable account
 * label without modifying the policy file. Throws when the result would still
 * violate {@link ACCOUNT_LABEL_PATTERN}.
 */
export function normalizePolicyIdToAccountLabel(policyId: string): string {
  let normalized = policyId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-');
  normalized = normalized.replace(/^-+|-+$/g, '');
  if (!normalized || !/^[a-z]/.test(normalized)) {
    normalized = `p-${normalized || 'profile'}`.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  }
  if (normalized.length > 32) normalized = normalized.slice(0, 32).replace(/-+$/, '');
  if (!normalized) normalized = 'profile';
  return assertAccountLabel(normalized);
}

/** Assign distinct account labels for a batch of policy ids; fail on collision. */
export function mapPolicyIdsToAccountLabels(
  policyIds: readonly string[],
): { labels: Map<string, string> } | { error: string } {
  const labels = new Map<string, string>();
  const ownerByLabel = new Map<string, string>();
  for (const policyId of policyIds) {
    let accountLabel: string;
    try {
      accountLabel = normalizePolicyIdToAccountLabel(policyId);
    } catch {
      return {
        error: `policy id '${policyId}' cannot be normalized to a valid account label`,
      };
    }
    const prior = ownerByLabel.get(accountLabel);
    if (prior !== undefined && prior !== policyId) {
      return {
        error: `policy ids '${prior}' and '${policyId}' collide on account label '${accountLabel}'`,
      };
    }
    ownerByLabel.set(accountLabel, policyId);
    labels.set(policyId, accountLabel);
  }
  return { labels };
}

export function capacityKey(
  providerName: string,
  accountLabel: string = DEFAULT_ACCOUNT_LABEL,
): string {
  assertAccountLabel(accountLabel);
  if (providerName.includes(SEPARATOR) || accountLabel.includes(SEPARATOR)) {
    throw new Error(
      `provider name and account label must not contain '${SEPARATOR}': ${providerName}/${accountLabel}`,
    );
  }
  return accountLabel === DEFAULT_ACCOUNT_LABEL
    ? providerName
    : `${providerName}${SEPARATOR}${accountLabel}`;
}

export function parseCapacityKey(key: string): {
  providerName: string;
  accountLabel: string;
} {
  const separator = key.indexOf(SEPARATOR);
  if (separator === -1) return { providerName: key, accountLabel: DEFAULT_ACCOUNT_LABEL };
  const providerName = key.slice(0, separator);
  const accountLabel = assertAccountLabel(key.slice(separator + 1));
  if (accountLabel.includes(SEPARATOR)) {
    throw new Error(`ambiguous capacity key (more than one '${SEPARATOR}'): ${key}`);
  }
  return { providerName, accountLabel };
}

/**
 * Path of one account's credential file relative to `provider-auth/<host>/`.
 * The default account keeps the historical location so existing stores and
 * tests stay valid. Named accounts are nested under `accounts/<label>/` so a
 * label can never collide with the provider's own auth directory (`.codex`).
 */
export function accountAuthStoreRelativePath(
  authRelativePath: string,
  accountLabel: string = DEFAULT_ACCOUNT_LABEL,
): string {
  assertAccountLabel(accountLabel);
  if (authRelativePath.includes('..') || authRelativePath.startsWith('/')) {
    throw new Error(`unsafe auth relative path: ${authRelativePath}`);
  }
  if (accountLabel === DEFAULT_ACCOUNT_LABEL) return authRelativePath;
  return `accounts/${accountLabel}/${authRelativePath}`;
}

/**
 * Relative path segments (under `provider-auth/<host>/`) that must exist as
 * root-owned 0700 directories before writing a named account credential.
 */
export function namedAuthStoreParentRelativePaths(
  authRelativePath: string,
  accountLabel: string,
): readonly string[] {
  assertAccountLabel(accountLabel);
  if (accountLabel === DEFAULT_ACCOUNT_LABEL) {
    throw new Error('named auth store parents apply only to non-default accounts');
  }
  const relParent = authRelativePath.includes('/')
    ? authRelativePath.slice(0, authRelativePath.lastIndexOf('/'))
    : '.';
  return [`accounts`, `accounts/${accountLabel}`, `accounts/${accountLabel}/${relParent}`];
}

/** Extra argv for `/opt/major/manage-provider-state` when a named account is selected. */
export function providerStateAccountArgs(accountLabel: string = DEFAULT_ACCOUNT_LABEL): string[] {
  assertAccountLabel(accountLabel);
  return accountLabel === DEFAULT_ACCOUNT_LABEL ? [] : [accountLabel];
}

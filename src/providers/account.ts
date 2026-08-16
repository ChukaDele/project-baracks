/**
 * Opaque capacity-key encoding for one authenticated account/profile of a
 * provider. Major never stores raw credentials here — only a label the owner
 * assigns when a second legitimate account/subscription is configured.
 *
 * The default account round-trips as the bare provider name, so every
 * existing single-account caller, persisted row and test fixture is
 * unaffected: multi-account routing is additive, not a breaking migration.
 *
 * SCOPE: this module and the agent_providers.account_label column it backs
 * are a routing/bookkeeping layer only. Nothing in the current codebase
 * creates a non-default account row, and coordinator dispatch
 * (supervisor/worker.ts's runWorker) does not yet select distinct
 * credentials per account — every account of a given provider currently
 * invokes the same canonical CLI login. Wiring an actual second
 * authenticated credential set into execution (e.g. a second Lima guest
 * profile) is a separate, not-yet-built follow-up.
 */

export const DEFAULT_ACCOUNT_LABEL = 'default';

const SEPARATOR = '#';

export function capacityKey(
  providerName: string,
  accountLabel: string = DEFAULT_ACCOUNT_LABEL,
): string {
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
  const accountLabel = key.slice(separator + 1);
  if (accountLabel.includes(SEPARATOR)) {
    throw new Error(`ambiguous capacity key (more than one '${SEPARATOR}'): ${key}`);
  }
  return { providerName, accountLabel };
}

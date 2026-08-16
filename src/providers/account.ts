/**
 * Opaque capacity-key encoding for one authenticated account/profile of a
 * provider. Major never stores raw credentials here — only a label the owner
 * assigns when a second legitimate account/subscription is configured.
 *
 * The default account round-trips as the bare provider name, so every
 * existing single-account caller, persisted row and test fixture is
 * unaffected: multi-account routing is additive, not a breaking migration.
 */

export const DEFAULT_ACCOUNT_LABEL = 'default';

const SEPARATOR = '#';

export function capacityKey(
  providerName: string,
  accountLabel: string = DEFAULT_ACCOUNT_LABEL,
): string {
  return accountLabel === DEFAULT_ACCOUNT_LABEL
    ? providerName
    : `${providerName}${SEPARATOR}${accountLabel}`;
}

export function parseCapacityKey(key: string): {
  providerName: string;
  accountLabel: string;
} {
  const separator = key.indexOf(SEPARATOR);
  return separator === -1
    ? { providerName: key, accountLabel: DEFAULT_ACCOUNT_LABEL }
    : { providerName: key.slice(0, separator), accountLabel: key.slice(separator + 1) };
}

import { describe, expect, it } from 'vitest';
import {
  accountAuthStoreRelativePath,
  assertAccountLabel,
  capacityKey,
  DEFAULT_ACCOUNT_LABEL,
  mapPolicyIdsToAccountLabels,
  normalizePolicyIdToAccountLabel,
  parseCapacityKey,
  providerStateAccountArgs,
} from '../src/providers/account.js';

describe('provider capacity keys', () => {
  it('round-trips the default account as the bare provider name', () => {
    expect(capacityKey('codex')).toBe('codex');
    expect(capacityKey('codex', DEFAULT_ACCOUNT_LABEL)).toBe('codex');
    expect(parseCapacityKey('codex')).toEqual({
      providerName: 'codex',
      accountLabel: DEFAULT_ACCOUNT_LABEL,
    });
  });

  it('encodes a non-default account as a distinguishable composite key', () => {
    const key = capacityKey('codex', 'work-b');
    expect(key).toBe('codex#work-b');
    expect(parseCapacityKey(key)).toEqual({ providerName: 'codex', accountLabel: 'work-b' });
  });

  it('parses a bare key with no separator as the default account', () => {
    expect(parseCapacityKey('claude-code')).toEqual({
      providerName: 'claude-code',
      accountLabel: DEFAULT_ACCOUNT_LABEL,
    });
  });

  it('rejects unsafe account labels before they can become store paths', () => {
    expect(() => assertAccountLabel('../etc')).toThrow(/invalid account label/);
    expect(() => assertAccountLabel('accounts')).toThrow(/invalid account label/);
    expect(() => assertAccountLabel('Work_B')).toThrow(/invalid account label/);
    expect(() => capacityKey('codex', 'a/b')).toThrow(/invalid account label/);
  });

  it('keeps the default credential path and nests named accounts under accounts/<label>/', () => {
    expect(accountAuthStoreRelativePath('.codex/auth.json')).toBe('.codex/auth.json');
    expect(accountAuthStoreRelativePath('.codex/auth.json', 'work-b')).toBe(
      'accounts/work-b/.codex/auth.json',
    );
    expect(providerStateAccountArgs()).toEqual([]);
    expect(providerStateAccountArgs('work-b')).toEqual(['work-b']);
  });

  it('normalizes approved policy ids into valid account labels', () => {
    expect(normalizePolicyIdToAccountLabel('COD-01')).toBe('cod-01');
    expect(normalizePolicyIdToAccountLabel('COD-02')).toBe('cod-02');
  });

  it('rejects policy ids that cannot normalize safely', () => {
    expect(() => normalizePolicyIdToAccountLabel('accounts')).toThrow(/invalid account label/);
    const colliding = mapPolicyIdsToAccountLabels(['COD-01', 'COD_01']);
    expect(colliding).toEqual({
      error: "policy ids 'COD-01' and 'COD_01' collide on account label 'cod-01'",
    });
  });
});

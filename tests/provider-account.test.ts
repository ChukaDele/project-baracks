import { describe, expect, it } from 'vitest';
import { capacityKey, DEFAULT_ACCOUNT_LABEL, parseCapacityKey } from '../src/providers/account.js';

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
});

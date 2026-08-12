import { describe, expect, it } from 'vitest';
import {
  decideProviderAction,
  validateProviderApprovalAuthority,
} from '../src/security/provider-approval-policy.js';

const noApprovals = { approvedCategories: [] as const };

describe('authoritative provider approval policy', () => {
  it('automatically allows ordinary quarantined work', () => {
    expect(
      decideProviderAction({ host: 'cursor', action: { kind: 'edit' }, authority: noApprovals }),
    ).toMatchObject({ outcome: 'automatic' });
  });

  it('requires a Major approval for a sensitive action', () => {
    expect(
      decideProviderAction({
        host: 'cursor',
        action: { kind: 'execute', rawInput: { command: 'git push origin feature' } },
        authority: noApprovals,
      }),
    ).toMatchObject({ outcome: 'approval_required', category: 'push' });
  });

  it('requires approval for every shell command even when its text appears harmless', () => {
    expect(
      decideProviderAction({
        host: 'cursor',
        action: { kind: 'execute', rawInput: { command: 'pwd' } },
        authority: noApprovals,
      }),
    ).toMatchObject({ outcome: 'approval_required', category: 'command_execution' });
  });

  it('rejects destructive actions even when a provider labels them execute', () => {
    expect(
      decideProviderAction({
        host: 'cursor',
        action: { kind: 'execute', rawInput: { command: 'git reset --hard' } },
        authority: noApprovals,
      }),
    ).toMatchObject({ outcome: 'forbidden' });
  });

  it('rejects an explicit provider policy bypass', () => {
    const authority = { approvedCategories: [] as const, bypassAttempted: true };
    expect(
      decideProviderAction({ host: 'cursor', action: { kind: 'edit' }, authority }),
    ).toMatchObject({ outcome: 'forbidden' });
    expect(() => validateProviderApprovalAuthority('cursor', authority)).toThrow(
      /bypass Major approval policy/,
    );
  });

  it.each(['claude', 'codex', 'antigravity'] as const)(
    'fails closed when %s is asked to perform approval-required work',
    (host) => {
      const authority = { approvedCategories: ['dependency_install'] as const };
      expect(
        decideProviderAction({
          host,
          action: { kind: 'dependency_install' },
          authority,
        }),
      ).toMatchObject({ outcome: 'unsupported' });
      expect(() => validateProviderApprovalAuthority(host, authority)).toThrow(
        /does not expose per-tool approval semantics/,
      );
    },
  );

  it('allows a typed Cursor action only after exact Major authority', () => {
    expect(
      decideProviderAction({
        host: 'cursor',
        action: { kind: 'dependency_install' },
        authority: { approvedCategories: ['dependency_install'] },
      }),
    ).toMatchObject({ outcome: 'automatic' });
  });
});

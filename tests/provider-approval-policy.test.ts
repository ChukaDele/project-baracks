import { describe, expect, it } from 'vitest';
import {
  decideProviderAction,
  providerActionDigest,
  validateProviderApprovalAuthority,
} from '../src/security/provider-approval-policy.js';

const noApprovals = { decisions: [] as const };

describe('authoritative provider approval policy', () => {
  it('binds approval to every field in the complete structured action', () => {
    const approved = providerActionDigest({
      kind: 'external_integration',
      name: 'publish',
      rawInput: { command: 'tool', url: 'https://safe.invalid', cwd: '/guest' },
    });
    expect(
      providerActionDigest({
        kind: 'external_integration',
        name: 'publish',
        rawInput: { cwd: '/guest', url: 'https://safe.invalid', command: 'tool' },
      }),
    ).toBe(approved);
    expect(
      providerActionDigest({
        kind: 'external_integration',
        name: 'publish',
        rawInput: { command: 'tool', url: 'https://different.invalid', cwd: '/guest' },
      }),
    ).not.toBe(approved);
    expect(
      providerActionDigest({
        kind: 'external_integration',
        name: 'different-tool',
        rawInput: { command: 'tool', url: 'https://safe.invalid', cwd: '/guest' },
      }),
    ).not.toBe(approved);
  });
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
    const authority = { decisions: [] as const, bypassAttempted: true };
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
      const authority = {
        decisions: [
          {
            category: 'dependency_install' as const,
            decisionId: 'dreq_1',
            actionDigest: providerActionDigest({ kind: 'dependency_install' }),
          },
        ],
      };
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
        authority: {
          decisions: [
            {
              category: 'dependency_install',
              decisionId: 'dreq_1',
              actionDigest: providerActionDigest({ kind: 'dependency_install' }),
            },
          ],
        },
      }),
    ).toMatchObject({ outcome: 'automatic' });
  });

  it('rejects fabricated or unverified DecisionRequest references', () => {
    const authority = {
      decisions: [
        {
          category: 'command_execution' as const,
          decisionId: 'dreq_fake',
          actionDigest: providerActionDigest({ kind: 'execute' }),
        },
      ],
    };
    expect(() => validateProviderApprovalAuthority('cursor', authority)).toThrow(
      /does not authorise/,
    );
    expect(() =>
      validateProviderApprovalAuthority(
        'cursor',
        authority,
        (category, decisionId) =>
          category === 'command_execution' && decisionId === 'dreq_verified',
      ),
    ).toThrow(/does not authorise/);
  });
});

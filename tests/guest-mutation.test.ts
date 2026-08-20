import { describe, expect, it } from 'vitest';
import { assertGuestMutationPolicy } from '../src/security/guest-mutation.js';

const digest = 'a'.repeat(64);

describe('Codex guest mutation policy', () => {
  it('allows Codex mutation only inside Lima plus active Supervised Workshop', () => {
    expect(() =>
      assertGuestMutationPolicy({
        host: 'codex',
        allowGuestMutation: true,
        workspaceHash: digest,
        executionAuthorityKind: 'supervised_workshop',
        isolatedBackend: true,
      }),
    ).not.toThrow();
  });

  it('refuses Codex mutation on ordinary supervised execution', () => {
    expect(() =>
      assertGuestMutationPolicy({
        host: 'codex',
        allowGuestMutation: true,
        workspaceHash: digest,
        executionAuthorityKind: 'supervised',
        isolatedBackend: true,
      }),
    ).toThrow(/active supervised Workshop authority/);
  });

  it('refuses Codex mutation during staged validation', () => {
    expect(() =>
      assertGuestMutationPolicy({
        host: 'codex',
        allowGuestMutation: true,
        workspaceHash: digest,
        executionAuthorityKind: 'staged_validation',
        isolatedBackend: true,
      }),
    ).toThrow(/active supervised Workshop authority/);
  });

  it('refuses Codex mutation without the Lima backend', () => {
    expect(() =>
      assertGuestMutationPolicy({
        host: 'codex',
        allowGuestMutation: true,
        workspaceHash: digest,
        executionAuthorityKind: 'supervised_workshop',
        isolatedBackend: false,
      }),
    ).toThrow(/Lima execution backend/);
  });

  it('refuses Codex mutation without a source workspace digest', () => {
    expect(() =>
      assertGuestMutationPolicy({
        host: 'codex',
        allowGuestMutation: true,
        executionAuthorityKind: 'supervised_workshop',
        isolatedBackend: true,
      }),
    ).toThrow(/source workspace digest/);
  });

  it('allows read-only Codex without Workshop or a digest', () => {
    expect(() =>
      assertGuestMutationPolicy({
        host: 'codex',
        allowGuestMutation: false,
        executionAuthorityKind: 'supervised',
        isolatedBackend: true,
      }),
    ).not.toThrow();
  });

  it('keeps Claude and Cursor mutation contracts without requiring a new source digest', () => {
    expect(() =>
      assertGuestMutationPolicy({
        host: 'claude',
        allowGuestMutation: true,
        executionAuthorityKind: 'supervised',
        isolatedBackend: true,
      }),
    ).not.toThrow();
    expect(() =>
      assertGuestMutationPolicy({
        host: 'cursor',
        allowGuestMutation: true,
        executionAuthorityKind: 'supervised',
        isolatedBackend: true,
      }),
    ).not.toThrow();
  });

  it('forbids Antigravity writes', () => {
    expect(() =>
      assertGuestMutationPolicy({
        host: 'antigravity',
        allowGuestMutation: true,
        workspaceHash: digest,
        executionAuthorityKind: 'supervised_workshop',
        isolatedBackend: true,
      }),
    ).toThrow(/antigravity cannot mutate/);
  });
});

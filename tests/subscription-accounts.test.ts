import { describe, expect, it } from 'vitest';
import {
  contextContinuity,
  lastCapacityKey,
  subscriptionAccountPool,
} from '../src/routing/subscription-accounts.js';
import type { ProviderInfo } from '../src/providers/types.js';
import { HOST_PROVIDERS } from '../src/supervisor/runtime.js';
import { model } from './helpers.js';

function codexAccount(
  label: 'default' | 'work-b' | 'work-c',
  availability: 'available' | 'exhausted',
): ProviderInfo {
  const name = label === 'default' ? 'codex' : `codex#${label}`;
  return {
    name,
    installed: true,
    authenticated: true,
    models: [
      model({
        modelRef: 'gpt-codex',
        routingClass: 'codex',
        availability,
        billingMode: 'subscription_included',
      }),
    ],
  };
}

function claudeOpus(): ProviderInfo {
  return {
    name: 'claude-code',
    installed: true,
    authenticated: true,
    models: [model({ modelRef: 'opus', routingClass: 'opus' })],
  };
}

describe('subscription account pool', () => {
  it('stays on Codex sibling accounts when the last Codex account is exhausted', () => {
    const pooled = subscriptionAccountPool({
      providers: [
        codexAccount('default', 'exhausted'),
        codexAccount('work-b', 'available'),
        claudeOpus(),
      ],
      lastCapacityKey: 'codex',
      consecutiveFailures: 0,
    });
    expect(pooled.providers.map((provider) => provider.name)).toEqual(['codex#work-b']);
    expect(pooled.reason).toMatch(/quota rotation/);
  });

  it('prefers a fully available sibling over a retry-eligible one', () => {
    const retry = codexAccount('work-b', 'exhausted');
    retry.models[0]!.retryEligible = true;
    const pooled = subscriptionAccountPool({
      providers: [
        codexAccount('default', 'exhausted'),
        retry,
        codexAccount('work-c', 'available'),
        claudeOpus(),
      ],
      lastCapacityKey: 'codex',
      consecutiveFailures: 0,
    });
    expect(pooled.providers.map((provider) => provider.name)).toEqual([
      'codex#work-c',
      'codex#work-b',
    ]);
  });

  it('excludes only the last capacity key after two work failures', () => {
    const pooled = subscriptionAccountPool({
      providers: [
        codexAccount('default', 'available'),
        codexAccount('work-b', 'available'),
        claudeOpus(),
      ],
      lastCapacityKey: 'codex',
      consecutiveFailures: 2,
    });
    expect(pooled.providers.map((provider) => provider.name)).toEqual([
      'codex#work-b',
      'claude-code',
    ]);
  });

  it('passes the full pool through when the last account is still usable', () => {
    const providers = [codexAccount('default', 'available'), claudeOpus()];
    const pooled = subscriptionAccountPool({
      providers,
      lastCapacityKey: 'codex',
      consecutiveFailures: 0,
    });
    expect(pooled.providers).toEqual(providers);
  });

  it('stays on a Codex sibling when the last capacity key is absent from the pool', () => {
    const pooled = subscriptionAccountPool({
      providers: [codexAccount('work-b', 'available'), claudeOpus()],
      lastCapacityKey: 'codex',
      consecutiveFailures: 0,
    });
    expect(pooled.providers.map((provider) => provider.name)).toEqual(['codex#work-b']);
    expect(pooled.reason).toMatch(/quota rotation/);
  });

  it('stays on Codex sibling accounts even when they are not yet routable', () => {
    const unbilled = codexAccount('work-b', 'available');
    unbilled.models[0]!.billingMode = 'unknown';
    const pooled = subscriptionAccountPool({
      providers: [codexAccount('default', 'exhausted'), unbilled, claudeOpus()],
      lastCapacityKey: 'codex',
      consecutiveFailures: 0,
    });
    expect(pooled.providers.map((provider) => provider.name)).toEqual(['codex#work-b']);
    expect(pooled.reason).toMatch(/not yet routable/);
  });
});

describe('context continuity', () => {
  it('resumes a vendor session only when the adapter persists and the slot is unchanged', () => {
    const cursorSame = contextContinuity({
      lastCoordinator: 'cursor',
      lastAccountLabel: 'default',
      lastSessionRef: 'sess-a',
      lastSummary: 'implemented the router',
      nextHost: 'cursor',
      nextAccountLabel: 'default',
    });
    expect(cursorSame.resumeSessionRef).toBe('sess-a');
    expect(cursorSame.promptBlock).toMatch(/Resuming the vendor session/);
    expect(cursorSame.promptBlock).not.toContain('sess-a');

    const antigravitySame = contextContinuity({
      lastCoordinator: 'antigravity',
      lastAccountLabel: 'default',
      lastSessionRef: 'conv-a',
      lastSummary: 'planned the rollout',
      nextHost: 'antigravity',
      nextAccountLabel: 'default',
    });
    expect(antigravitySame.resumeSessionRef).toBe('conv-a');
    expect(antigravitySame.promptBlock).toMatch(/Resuming the vendor session/);
    expect(antigravitySame.promptBlock).not.toContain('conv-a');

    const codexSame = contextContinuity({
      lastCoordinator: 'codex',
      lastAccountLabel: 'default',
      lastSessionRef: 'sess-a',
      lastSummary: 'implemented the router',
      nextHost: 'codex',
      nextAccountLabel: 'default',
    });
    expect(codexSame.resumeSessionRef).toBeUndefined();
    expect(codexSame.promptBlock).toMatch(/without a vendor session resume/);
    expect(codexSame.promptBlock).toContain('implemented the router');
    expect(codexSame.promptBlock).not.toContain('sess-a');

    const claudeSame = contextContinuity({
      lastCoordinator: 'claude',
      lastAccountLabel: 'default',
      lastSessionRef: 'sess-claude',
      lastSummary: 'refined the policy layer',
      nextHost: 'claude',
      nextAccountLabel: 'default',
    });
    expect(claudeSame.resumeSessionRef).toBeUndefined();
    expect(claudeSame.promptBlock).toMatch(/without a vendor session resume/);
    expect(claudeSame.promptBlock).toContain('refined the policy layer');
    expect(claudeSame.promptBlock).not.toContain('sess-claude');

    const hop = contextContinuity({
      lastCoordinator: 'cursor',
      lastAccountLabel: 'default',
      lastSessionRef: 'sess-a',
      lastSummary: 'implemented the router',
      nextHost: 'cursor',
      nextAccountLabel: 'work-b',
    });
    expect(hop.resumeSessionRef).toBeUndefined();
    expect(hop.promptBlock).toMatch(/without resuming a vendor session/);
    expect(hop.promptBlock).toContain('implemented the router');
    expect(hop.promptBlock).not.toContain('sess-a');
  });

  it('does not resume a Codex vendor session after hopping to Claude default', () => {
    const hop = contextContinuity({
      lastCoordinator: 'codex',
      lastAccountLabel: 'default',
      lastSessionRef: 'sess-codex',
      lastSummary: 'wired the provider router',
      nextHost: 'claude',
      nextAccountLabel: 'default',
    });
    expect(hop.resumeSessionRef).toBeUndefined();
    expect(hop.promptBlock).toMatch(/without resuming a vendor session/);
    expect(hop.promptBlock).toContain('wired the provider router');
    expect(hop.promptBlock).not.toContain('sess-codex');
  });

  it('encodes last coordinator plus account as a capacity key', () => {
    expect(
      lastCapacityKey({
        lastCoordinator: 'codex',
        lastAccountLabel: 'work-b',
        hostProviders: HOST_PROVIDERS,
      }),
    ).toBe('codex#work-b');
  });

  it('falls back to the preferred coordinator when no hop has been recorded yet', () => {
    expect(
      lastCapacityKey({
        preferredCoordinator: 'codex',
        hostProviders: HOST_PROVIDERS,
      }),
    ).toBe('codex');
  });
});

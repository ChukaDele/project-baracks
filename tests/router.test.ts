import { describe, expect, it } from 'vitest';
import type { ProviderInfo } from '../src/providers/types.js';
import { route, targetClass } from '../src/routing/router.js';
import { model } from './helpers.js';

function claude(models: Parameters<typeof model>[0][]): ProviderInfo {
  return { name: 'claude-code', installed: true, authenticated: true, models: models.map(model) };
}

function codex(): ProviderInfo {
  return {
    name: 'codex',
    installed: true,
    authenticated: true,
    models: [model({ modelRef: 'codex-model', routingClass: 'codex' })],
  };
}

const FULL_FLEET = [
  claude([
    { modelRef: 'fable', routingClass: 'fable' },
    { modelRef: 'opus', routingClass: 'opus' },
    { modelRef: 'sonnet', routingClass: 'sonnet' },
  ]),
  codex(),
];

describe('target class selection', () => {
  it('routes architectural implementation to fable-class', () => {
    expect(targetClass({ purpose: 'implementation', complexity: 'architectural' })).toBe('fable');
  });
  it('routes high-risk work to opus-class', () => {
    expect(
      targetClass({
        purpose: 'implementation',
        complexity: 'bounded',
        riskLevel: 'security_sensitive',
      }),
    ).toBe('opus');
  });
  it('routes bounded work to sonnet-class', () => {
    expect(targetClass({ purpose: 'repair', complexity: 'bounded' })).toBe('sonnet');
  });
  it('escalates after repeated repair failures', () => {
    expect(targetClass({ purpose: 'repair', complexity: 'bounded', repairAttempts: 2 })).toBe(
      'opus',
    );
    expect(targetClass({ purpose: 'repair', complexity: 'bounded', repairAttempts: 4 })).toBe(
      'fable',
    );
  });
});

describe('provider and model fallback', () => {
  it('falls back down the ladder when the target class is rate-limited', () => {
    const providers = [
      claude([
        { modelRef: 'fable', routingClass: 'fable', availability: 'rate_limited' },
        { modelRef: 'opus', routingClass: 'opus' },
      ]),
    ];
    const decision = route({ purpose: 'implementation', complexity: 'architectural' }, providers);
    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') {
      expect(decision.modelRef).toBe('opus');
      expect(decision.reason).toContain('target=fable');
    }
  });

  it('checkpoints when everything is exhausted', () => {
    const providers = [
      claude([
        { modelRef: 'fable', routingClass: 'fable', availability: 'exhausted' },
        { modelRef: 'opus', routingClass: 'opus', availability: 'exhausted' },
        { modelRef: 'sonnet', routingClass: 'sonnet', availability: 'exhausted' },
      ]),
    ];
    const decision = route({ purpose: 'implementation', complexity: 'architectural' }, providers);
    expect(decision.kind).toBe('checkpoint');
  });

  it('skips prohibited and unauthenticated models', () => {
    const providers = [
      claude([
        { modelRef: 'fable', routingClass: 'fable', prohibited: true },
        { modelRef: 'opus', routingClass: 'opus', authenticated: false },
        { modelRef: 'sonnet', routingClass: 'sonnet' },
      ]),
    ];
    const decision = route({ purpose: 'implementation', complexity: 'architectural' }, providers);
    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') expect(decision.modelRef).toBe('sonnet');
  });
});

describe('Codex routing', () => {
  it('uses subscription-backed Codex for implementation when it is the useful available capacity', () => {
    const providers = [codex()];
    const decision = route({ purpose: 'implementation', complexity: 'bounded' }, providers);
    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') expect(decision.provider).toBe('codex');
  });

  it('can explicitly preserve Codex for review for a project that requests it', () => {
    const providers = [codex()];
    const decision = route(
      { purpose: 'implementation', complexity: 'bounded' },
      providers,
      { preserveCodexForReview: true },
    );
    expect(decision.kind).toBe('checkpoint');
  });

  it('prefers codex for independent review', () => {
    const decision = route(
      { purpose: 'review', complexity: 'bounded', implementedByProvider: 'claude-code' },
      FULL_FLEET,
    );
    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') {
      expect(decision.provider).toBe('codex');
      expect(decision.independenceLoss).toBeUndefined();
    }
  });

  it('records independence loss when only the implementing provider can review', () => {
    const providers = [claude([{ modelRef: 'opus', routingClass: 'opus' }])];
    const decision = route(
      { purpose: 'review', complexity: 'bounded', implementedByProvider: 'claude-code' },
      providers,
    );
    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') {
      expect(decision.provider).toBe('claude-code');
      expect(decision.independenceLoss).toMatch(/no independent provider/);
    }
  });
});

describe('billing safety', () => {
  const paidOnly = [
    claude([
      { modelRef: 'fable', routingClass: 'fable', billingMode: 'usage_credits' },
      { modelRef: 'opus', routingClass: 'opus', billingMode: 'api_billing' },
    ]),
  ];

  it('checkpoints rather than silently spending usage credits', () => {
    const decision = route({ purpose: 'implementation', complexity: 'architectural' }, paidOnly);
    expect(decision.kind).toBe('checkpoint');
    if (decision.kind === 'checkpoint') {
      expect(decision.reason).toMatch(/unapproved charge/);
      expect(decision.paidOptionsAvailable.length).toBeGreaterThan(0);
    }
  });

  it('never routes to paid capacity, even with an approving DecisionRequest reference', () => {
    const decision = route(
      {
        purpose: 'implementation',
        complexity: 'architectural',
        approvedPaidUsage: { decisionId: 'dreq_paid1' },
      },
      paidOnly,
    );
    expect(decision.kind).toBe('checkpoint');
    if (decision.kind === 'checkpoint') {
      expect(decision.reason).toMatch(/paid provider execution is unavailable/);
      expect(decision.paidOptionsAvailable.length).toBeGreaterThan(0);
    }
  });

  it('prefers subscription-included capacity over stronger paid capacity', () => {
    const providers = [
      claude([
        { modelRef: 'fable', routingClass: 'fable', billingMode: 'api_billing' },
        { modelRef: 'opus', routingClass: 'opus' },
      ]),
    ];
    const decision = route(
      {
        purpose: 'implementation',
        complexity: 'architectural',
        approvedPaidUsage: { decisionId: 'dreq_paid1' },
      },
      providers,
    );
    expect(decision.kind).toBe('route');
    if (decision.kind === 'route') {
      expect(decision.billingMode).toBe('subscription_included');
      expect(decision.paidUsageDecisionId).toBeUndefined();
    }
  });

  it('treats unknown billing as unroutable, even with paid approval', () => {
    const providers = [
      claude([{ modelRef: 'mystery', routingClass: 'fable', billingMode: 'unknown' }]),
    ];
    for (const approvedPaidUsage of [undefined, { decisionId: 'dreq_paid1' }]) {
      const request: Parameters<typeof route>[0] = {
        purpose: 'implementation',
        complexity: 'architectural',
      };
      if (approvedPaidUsage) request.approvedPaidUsage = approvedPaidUsage;
      const decision = route(request, providers);
      expect(decision.kind).toBe('checkpoint');
      if (decision.kind === 'checkpoint') expect(decision.paidOptionsAvailable).toHaveLength(0);
    }
  });
});

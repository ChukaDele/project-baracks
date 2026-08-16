import { describe, expect, it } from 'vitest';
import {
  computeCoreReadiness,
  computeLiveExecutionReadiness,
  computeMultiProviderReadiness,
  computeProviderReadiness,
} from '../src/doctor/readiness.js';
import { model } from './helpers.js';
import type { ProviderInfo } from '../src/providers/types.js';

function provider(name: string, overrides: Partial<ProviderInfo> = {}): ProviderInfo {
  return { name, installed: true, authenticated: true, models: [], ...overrides };
}

const readyCore = () =>
  computeCoreReadiness({
    runnerCapabilityAvailable: true,
    containmentReady: true,
    containmentDetail: 'ok',
    missingRequiredPrerequisites: [],
  });

describe('computeProviderReadiness', () => {
  it('reports NOT_CONFIGURED when the provider client is not installed', () => {
    expect(computeProviderReadiness(provider('gemini', { installed: false })).state).toBe(
      'NOT_CONFIGURED',
    );
  });

  it('reports AUTH_REQUIRED when installed but not authenticated', () => {
    expect(computeProviderReadiness(provider('cursor', { authenticated: false })).state).toBe(
      'AUTH_REQUIRED',
    );
  });

  it('reports READY when at least one model is visible, authenticated, and routable', () => {
    const result = computeProviderReadiness(
      provider('codex', { models: [model({ modelRef: 'auto', routingClass: 'codex' })] }),
    );
    expect(result).toMatchObject({ state: 'READY', provider: 'codex' });
  });

  it('reports RATE_LIMITED independent of AUTH_REQUIRED or READY on other providers', () => {
    const result = computeProviderReadiness(
      provider('claude-code', {
        models: [model({ modelRef: 'sonnet', availability: 'rate_limited' })],
      }),
    );
    expect(result.state).toBe('RATE_LIMITED');
  });

  it('reports EXHAUSTED when the only model has exhausted its quota', () => {
    const result = computeProviderReadiness(
      provider('claude-code', {
        models: [model({ modelRef: 'sonnet', availability: 'exhausted' })],
      }),
    );
    expect(result).toMatchObject({ state: 'EXHAUSTED' });
    expect(result.action).toMatch(/switch/);
  });

  it('reports UNAVAILABLE when authenticated but billing has not been attested', () => {
    const result = computeProviderReadiness(
      provider('codex', {
        models: [model({ modelRef: 'auto', routingClass: 'codex', billingMode: 'unknown' })],
      }),
    );
    expect(result.state).toBe('UNAVAILABLE');
    expect(result.action).toMatch(/attest-billing/);
  });

  it('one provider state never depends on another provider', () => {
    const claude = computeProviderReadiness(provider('claude-code', { authenticated: false }));
    const codex = computeProviderReadiness(
      provider('codex', { models: [model({ modelRef: 'auto', routingClass: 'codex' })] }),
    );
    expect(claude.state).toBe('AUTH_REQUIRED');
    expect(codex.state).toBe('READY');
  });
});

describe('computeLiveExecutionReadiness', () => {
  it('is ready with exactly one healthy provider (Codex only)', () => {
    const codex = computeProviderReadiness(
      provider('codex', { models: [model({ modelRef: 'auto', routingClass: 'codex' })] }),
    );
    const live = computeLiveExecutionReadiness(readyCore(), [codex]);
    expect(live.ready).toBe(true);
    expect(live.healthyProviders).toEqual(['codex']);
    expect(live.fallbackCount).toBe(0);
  });

  it('is ready with exactly one healthy provider (Claude only)', () => {
    const claude = computeProviderReadiness(
      provider('claude-code', { models: [model({ modelRef: 'sonnet' })] }),
    );
    const live = computeLiveExecutionReadiness(readyCore(), [claude]);
    expect(live.ready).toBe(true);
    expect(live.healthyProviders).toEqual(['claude-code']);
  });

  it('keeps working on Codex when Claude is exhausted', () => {
    const claude = computeProviderReadiness(
      provider('claude-code', {
        models: [model({ modelRef: 'sonnet', availability: 'exhausted' })],
      }),
    );
    const codex = computeProviderReadiness(
      provider('codex', { models: [model({ modelRef: 'auto', routingClass: 'codex' })] }),
    );
    const live = computeLiveExecutionReadiness(readyCore(), [claude, codex]);
    expect(live.ready).toBe(true);
    expect(live.healthyProviders).toEqual(['codex']);
  });

  it('a broken optional provider (Cursor) does not block Codex+Claude', () => {
    const cursor = computeProviderReadiness(provider('cursor', { installed: false }));
    const codex = computeProviderReadiness(
      provider('codex', { models: [model({ modelRef: 'auto', routingClass: 'codex' })] }),
    );
    const claude = computeProviderReadiness(
      provider('claude-code', { models: [model({ modelRef: 'sonnet' })] }),
    );
    const live = computeLiveExecutionReadiness(readyCore(), [cursor, codex, claude]);
    expect(live.ready).toBe(true);
    expect(live.healthyProviders.sort()).toEqual(['claude-code', 'codex']);
  });

  it('is not ready when core safety fails even with a healthy provider', () => {
    const core = computeCoreReadiness({
      runnerCapabilityAvailable: true,
      containmentReady: false,
      containmentDetail: 'no supported OS sandbox',
      missingRequiredPrerequisites: [],
    });
    const codex = computeProviderReadiness(
      provider('codex', { models: [model({ modelRef: 'auto', routingClass: 'codex' })] }),
    );
    const live = computeLiveExecutionReadiness(core, [codex]);
    expect(live.ready).toBe(false);
    expect(live.blockers.join()).toMatch(/containment insufficient/);
  });

  it('is not ready when no provider is configured at all', () => {
    const live = computeLiveExecutionReadiness(readyCore(), []);
    expect(live.ready).toBe(false);
    expect(live.blockers.join()).toMatch(/no providers configured/);
  });

  // The two acceptance scenarios named literally in the beta-operability
  // spec: an unauthenticated optional provider never blocks a READY one, and
  // an authoritatively exhausted provider never blocks a different READY one
  // — with the exact provider names used in that spec, not just structurally
  // equivalent stand-ins.
  it('is ready with Claude AUTH_REQUIRED alongside Codex READY', () => {
    const claude = computeProviderReadiness(provider('claude-code', { authenticated: false }));
    const codex = computeProviderReadiness(
      provider('codex', { models: [model({ modelRef: 'auto', routingClass: 'codex' })] }),
    );
    const live = computeLiveExecutionReadiness(readyCore(), [claude, codex]);
    expect(live.ready).toBe(true);
    expect(live.healthyProviders).toEqual(['codex']);
  });

  it('reroutes readiness to Cursor when Codex is authoritatively EXHAUSTED', () => {
    const codex = computeProviderReadiness(
      provider('codex', {
        models: [model({ modelRef: 'auto', routingClass: 'codex', availability: 'exhausted' })],
      }),
    );
    const cursor = computeProviderReadiness(
      provider('cursor', { models: [model({ modelRef: 'auto', routingClass: 'sonnet' })] }),
    );
    const live = computeLiveExecutionReadiness(readyCore(), [codex, cursor]);
    expect(live.ready).toBe(true);
    expect(live.healthyProviders).toEqual(['cursor']);
  });
});

describe('computeMultiProviderReadiness', () => {
  it('requires more than one healthy provider for fallback capacity', () => {
    const codex = computeProviderReadiness(
      provider('codex', { models: [model({ modelRef: 'auto', routingClass: 'codex' })] }),
    );
    const single = computeLiveExecutionReadiness(readyCore(), [codex]);
    expect(computeMultiProviderReadiness(single).ready).toBe(false);

    const claude = computeProviderReadiness(
      provider('claude-code', { models: [model({ modelRef: 'sonnet' })] }),
    );
    const double = computeLiveExecutionReadiness(readyCore(), [codex, claude]);
    expect(computeMultiProviderReadiness(double)).toMatchObject({ ready: true, healthyCount: 2 });
  });
});

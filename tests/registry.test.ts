import { describe, expect, it } from 'vitest';
import {
  classifyModel,
  DEFAULT_MODEL_REGISTRY,
  modelRegistrySchema,
  registryModels,
} from '../src/providers/registry.js';

describe('capability registry', () => {
  it('classifies models by configurable rules, not hard-coded names', () => {
    const registry = modelRegistrySchema.parse({
      version: 1,
      entries: [
        {
          provider: 'claude-code',
          knownModels: ['some-future-model'],
          rules: [{ match: 'future', routingClass: 'fable', billingMode: 'subscription_included' }],
        },
      ],
    });
    expect(classifyModel(registry, 'claude-code', 'some-future-model').routingClass).toBe('fable');
    expect(classifyModel(registry, 'claude-code', 'unmatched').routingClass).toBe('unknown');
    expect(classifyModel(registry, 'nonexistent-provider', 'x').routingClass).toBe('unknown');
  });

  it('supports manual prohibition with a reason', () => {
    const registry = modelRegistrySchema.parse({
      version: 1,
      entries: [
        {
          provider: 'claude-code',
          knownModels: ['banned-model'],
          rules: [
            {
              match: 'banned',
              routingClass: 'opus',
              prohibited: true,
              prohibitedReason: 'manually prohibited by operator',
            },
          ],
        },
      ],
    });
    const [state] = registryModels(registry, 'claude-code', {
      visible: true,
      authenticated: true,
    });
    expect(state?.prohibited).toBe(true);
    expect(state?.prohibitedReason).toMatch(/manually prohibited/);
  });

  it('never presents configured billing as observed: registry billing is unknown', () => {
    const models = registryModels(DEFAULT_MODEL_REGISTRY, 'claude-code', {
      visible: true,
      authenticated: true,
    });
    expect(models.length).toBeGreaterThan(0);
    for (const state of models) {
      expect(state.billingMode).toBe('unknown'); // unroutable until observed
      expect(state.expectedBillingMode).toBe('subscription_included'); // display only
    }
  });

  it('derives availability from visibility and authentication', () => {
    const [visible] = registryModels(DEFAULT_MODEL_REGISTRY, 'claude-code', {
      visible: true,
      authenticated: true,
    });
    expect(visible?.availability).toBe('available');
    const [invisible] = registryModels(DEFAULT_MODEL_REGISTRY, 'claude-code', {
      visible: false,
      authenticated: false,
    });
    expect(invisible?.availability).toBe('unknown');
    expect(invisible?.visible).toBe(false);
  });
});

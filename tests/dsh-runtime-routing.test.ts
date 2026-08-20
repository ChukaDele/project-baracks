import { describe, expect, it } from 'vitest';
import { configuredDshRuntimeRoute } from '../src/harness/runtime-routing.js';

describe('DSH runtime routing checkpoint', () => {
  it('preserves the compatibility path only when the opt-in is unset', () => {
    expect(configuredDshRuntimeRoute({})).toBeUndefined();
    expect(configuredDshRuntimeRoute({ MAJOR_DSH_EXECUTION_ENVIRONMENT: '' })).toBeUndefined();
  });

  it('keeps provider and environment as independent typed choices', () => {
    expect(configuredDshRuntimeRoute({ MAJOR_DSH_EXECUTION_ENVIRONMENT: 'local' })).toEqual({
      environment: 'local',
    });
    expect(configuredDshRuntimeRoute({ MAJOR_DSH_EXECUTION_ENVIRONMENT: 'lima' })).toEqual({
      environment: 'lima',
    });
  });

  it('does not let a provider environment variable bypass Major routing', () => {
    expect(
      configuredDshRuntimeRoute({
        MAJOR_DSH_EXECUTION_ENVIRONMENT: 'local',
        MAJOR_DSH_PROVIDER: 'claude-native',
      }),
    ).toEqual({ environment: 'local' });
  });

  it('fails closed for unsupported execution environments', () => {
    expect(() => configuredDshRuntimeRoute({ MAJOR_DSH_EXECUTION_ENVIRONMENT: 'host' })).toThrow(
      /unsupported/,
    );
  });
});

import { describe, expect, it } from 'vitest';
import { evaluateShipGate } from '../src/validation/ship-gate.js';

describe('ship gate', () => {
  it('blocks a public web ship gate when browser or deployment evidence is absent', () => {
    const result = evaluateShipGate({
      publicSite: true,
      checks: [{ id: 'functional-critical-journey', state: 'pass', evidence: 'browser run' }],
    });
    expect(result.deterministicPassed).toBe(false);
    expect(result.blockers).toEqual(
      expect.arrayContaining([
        'visual-desktop: evidence is missing',
        'deployment-health: evidence is missing',
      ]),
    );
  });
});

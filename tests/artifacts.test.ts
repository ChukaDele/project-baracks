import { describe, expect, it } from 'vitest';
import { validateArtifact } from '../src/validation/artifacts.js';
import { evaluateShipGate } from '../src/validation/ship-gate.js';

describe('artifact-aware validation', () => {
  it('runs deterministic writing checks before any independent review', () => {
    const result = validateArtifact({
      kind: 'writing',
      content: "In today's fast-paced world, this is a game-changer.",
    });
    expect(result.deterministicPassed).toBe(false);
    expect(result.deterministicChecks[0]).toMatchObject({
      id: 'writing-specific-language',
      passed: false,
    });
    expect(result.needsIndependentReview).toBe(true);
  });

  it('requires code evidence instead of treating a supplied conclusion as proof', () => {
    const result = validateArtifact({
      kind: 'code',
      evidence: { 'code-typecheck': true, 'code-tests': true },
    });
    expect(result.deterministicPassed).toBe(false);
    expect(result.deterministicChecks.map((check) => check.id)).toEqual(
      expect.arrayContaining(['code-security-review', 'code-dependency-review']),
    );
  });

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

  it('runs the applicable ship gate for web artifacts', () => {
    const checks = [
      'functional-critical-journey',
      'functional-error-state',
      'data-source',
      'data-empty-error-state',
      'visual-desktop',
      'visual-mobile',
      'technical-build',
      'technical-console-network',
      'performance-obvious-regression',
      'security-secrets-boundary',
      'security-auth-boundary',
      'deployment-environment',
      'deployment-health',
    ].map((id) => ({ id, state: 'pass' as const, evidence: `evidence for ${id}` }));
    const result = validateArtifact({
      kind: 'web',
      web: { checks },
    });
    expect(result).toMatchObject({
      deterministicPassed: true,
      shipGate: { deterministicPassed: true },
    });
  });

  it('does not call an artifact validated without a separate review', () => {
    const result = validateArtifact({ kind: 'writing', content: 'Specific short copy.' });
    expect(result).toMatchObject({ deterministicPassed: true });
  });
});

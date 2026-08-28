import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessDelivery,
  decideSdlc,
  failureRegression,
  reviewFindingBlocksPromotion,
  validateSdlcIntent,
} from '../src/domain/sdlc.js';

describe('MVP-first SDLC policy', () => {
  it('keeps a small low-risk task low overhead', () => {
    const decision = decideSdlc({ estimatedFiles: 1, acceptancePaths: 1 });
    expect(decision).toMatchObject({
      workClass: 'small',
      review: 'none',
      requiresCompactState: false,
      requiredState: ['intent', 'spec'],
    });
    expect(
      validateSdlcIntent(
        { intent: 'Correct the label.', spec: ['Focused test passes.'] },
        decision,
      ),
    ).toEqual({ ok: true, missing: [] });
  });

  it('requires compact intent-to-spec-to-plan-to-evidence state for substantive work', () => {
    const decision = decideSdlc({ estimatedFiles: 3, acceptancePaths: 2 });
    expect(decision).toMatchObject({ workClass: 'substantive', review: 'focused' });
    expect(
      validateSdlcIntent(
        { intent: 'Ship the flow.', spec: ['E2E passes.'], plan: [], evidence: [] },
        decision,
      ),
    ).toEqual({ ok: false, missing: ['plan', 'evidence'] });
  });

  it('uses the exact compact intent/spec/plan/evidence contract', () => {
    const decision = decideSdlc({ estimatedFiles: 3, acceptancePaths: 2 });
    expect(decision.requiredState).toEqual(['intent', 'spec', 'plan', 'evidence']);
    expect(
      validateSdlcIntent(
        {
          intent: 'Deliver one useful end-to-end slice.',
          spec: ['The representative acceptance path succeeds.'],
          plan: ['Implement the minimum delta.'],
          evidence: ['Focused regression passes.'],
        },
        decision,
      ),
    ).toEqual({ ok: true, missing: [] });
  });

  it('keeps nits and speculation non-blocking while actionable findings block promotion', () => {
    expect(reviewFindingBlocksPromotion({ severity: 'BLOCKER' })).toBe(true);
    expect(reviewFindingBlocksPromotion({ severity: 'IMPORTANT' })).toBe(true);
    expect(reviewFindingBlocksPromotion({ severity: 'IMPORTANT', riskAccepted: true })).toBe(false);
    expect(reviewFindingBlocksPromotion({ severity: 'NIT' })).toBe(false);
    expect(reviewFindingBlocksPromotion({ severity: 'BLOCKER', speculative: true })).toBe(false);
    expect(reviewFindingBlocksPromotion({})).toBe(false);
  });

  it('keeps the canonical template and review policy aligned with the public contract', () => {
    const template = readFileSync(join(process.cwd(), 'templates/project/GOAL_STATE.md'), 'utf8');
    expect(template).toMatch(/^## Intent$/m);
    expect(template).toMatch(/^## Spec$/m);
    expect(template).toMatch(/^## Plan$/m);
    expect(template).toMatch(/^## Evidence$/m);

    const reviewPolicy = readFileSync(join(process.cwd(), 'REVIEW.md'), 'utf8');
    expect(reviewPolicy).toContain('**BLOCKER:**');
    expect(reviewPolicy).toContain('**IMPORTANT:**');
    expect(reviewPolicy).toContain('**NIT:**');
    expect(reviewPolicy).toContain('Speculation and questions are not findings and never block.');
    expect(reviewPolicy).not.toMatch(/\*\*P[0-3]/);
  });

  it('raises review based on consequence, not change size', () => {
    expect(
      decideSdlc({
        estimatedFiles: 1,
        acceptancePaths: 1,
        risk: { touchesAuthority: true },
      }),
    ).toMatchObject({ workClass: 'substantive', review: 'independent' });
  });

  it('rejects invalid sizing inputs instead of silently lowering ceremony', () => {
    expect(() => decideSdlc({ estimatedFiles: -1, acceptancePaths: 1 })).toThrow(
      'estimatedFiles must be a non-negative integer',
    );
    expect(() => decideSdlc({ estimatedFiles: 1, acceptancePaths: 0 })).toThrow(
      'acceptancePaths must be a positive integer',
    );
  });

  it('keeps regression proof separate from optional generalisable learning', () => {
    const result = failureRegression({
      failure: 'A stale claim completed the wrong task.',
      reproduction: 'Replay the expired claim.',
      expected: 'The transition is rejected.',
      verification: 'claim-fencing regression test',
      generalisableLearning: 'Fence downstream mutations with live task identity.',
    });
    expect(result.regressionArtifact.reproduction).toBe('Replay the expired claim.');
    expect(result.learningCandidate).toEqual({
      summary: 'Fence downstream mutations with live task identity.',
      evidence: 'Regression: claim-fencing regression test',
      scope: 'project',
    });
  });

  it('lets low-risk work validate without a review that policy did not require', () => {
    expect(
      assessDelivery(
        { implementationExists: true, deterministicChecksPassed: true },
        { review: 'none', installationRequired: false },
      ),
    ).toEqual({
      delivery: 'validated',
      reviewProof: 'not_required',
      installationProof: 'not_required',
      behaviorProof: 'unproven',
    });
  });

  it('does not validate substantive work until its selected review passes', () => {
    expect(
      assessDelivery(
        { implementationExists: true, deterministicChecksPassed: true },
        { review: 'focused', installationRequired: false },
      ),
    ).toMatchObject({ delivery: 'built', reviewProof: 'unproven' });
  });

  it('keeps installation and representative behavior proof explicit', () => {
    expect(
      assessDelivery(
        {
          implementationExists: true,
          deterministicChecksPassed: true,
          reviewPassed: true,
        },
        { review: 'independent', installationRequired: true },
      ),
    ).toEqual({
      delivery: 'validated',
      reviewProof: 'proven',
      installationProof: 'unproven',
      behaviorProof: 'unproven',
    });
    expect(
      assessDelivery(
        {
          implementationExists: true,
          deterministicChecksPassed: true,
          reviewPassed: true,
          installationProven: true,
          representativeBehaviorProven: true,
        },
        { review: 'independent', installationRequired: true },
      ),
    ).toEqual({
      delivery: 'ready',
      reviewProof: 'proven',
      installationProof: 'proven',
      behaviorProof: 'proven',
    });
  });
});

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assessDelivery,
  assessPromotion,
  assessTaskDeliveryEvidence,
  decideSdlc,
  failureRegression,
  planProgressiveValidation,
  reviewFindingBlocksPromotion,
  reviewFindingDisposition,
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

  it('defaults to the cheapest critical-path validation without broad ceremony', () => {
    expect(planProgressiveValidation({})).toEqual({
      requiredChecks: ['focused_tests', 'cheapest_compile_type_or_build', 'critical_path_behavior'],
      broaderValidationRequired: false,
      activeTriggers: [],
    });
  });

  it('adds risk checks and broadens only for the five explicit triggers', () => {
    expect(
      planProgressiveValidation({
        riskSpecificChecks: ['promotion boundary regression'],
        triggers: { promotion_policy: true, shared_dependency: true },
      }),
    ).toEqual({
      requiredChecks: [
        'focused_tests',
        'cheapest_compile_type_or_build',
        'critical_path_behavior',
        'risk_specific_checks',
        'broader_validation',
      ],
      broaderValidationRequired: true,
      activeTriggers: ['shared_dependency', 'promotion_policy'],
    });
  });

  it('blocks only blockers while triaging important findings for a usable safe MVP', () => {
    expect(reviewFindingBlocksPromotion({ severity: 'BLOCKER' })).toBe(true);
    expect(reviewFindingBlocksPromotion({ severity: 'IMPORTANT' })).toBe(false);
    expect(reviewFindingBlocksPromotion({ severity: 'NIT' })).toBe(false);
    expect(reviewFindingBlocksPromotion({ severity: 'BLOCKER', speculative: true })).toBe(false);
    expect(reviewFindingBlocksPromotion({})).toBe(false);

    expect(reviewFindingDisposition({ severity: 'BLOCKER' })).toBe('block');
    expect(reviewFindingDisposition({ severity: 'IMPORTANT' })).toBe('triage');
    expect(reviewFindingDisposition({ severity: 'NIT' })).toBe('advisory');
    expect(reviewFindingDisposition({ severity: 'IMPORTANT', speculative: true })).toBe('advisory');
  });

  it('keeps the canonical template and review policy aligned with the public contract', () => {
    const template = readFileSync(join(process.cwd(), 'templates/project/GOAL_STATE.md'), 'utf8');
    expect(template).toMatch(/^## Intent$/m);
    expect(template).toMatch(/^## Spec$/m);
    expect(template).toMatch(/^## Plan$/m);
    expect(template).toMatch(/^## Evidence$/m);
    for (const state of [
      'IMPLEMENTED',
      'TESTED',
      'STAGED',
      'RESOLVED',
      'LOADED',
      'FOLLOWED',
      'INSTALLED',
      'BEHAVIOURALLY PROVEN',
    ]) {
      expect(template).toContain(`${state}:`);
    }

    const reviewPolicy = readFileSync(join(process.cwd(), 'REVIEW.md'), 'utf8');
    expect(reviewPolicy).toContain('**BLOCKER:**');
    expect(reviewPolicy).toContain('**IMPORTANT:**');
    expect(reviewPolicy).toContain('**NIT:**');
    expect(reviewPolicy).toContain('does not automatically block');
    expect(reviewPolicy).toContain('Speculation and questions are not findings and never block.');
    expect(reviewPolicy).not.toMatch(/\*\*P[0-3]/);
  });

  it('requires evidence only for delivery states applicable to the task', () => {
    expect(
      assessTaskDeliveryEvidence({
        applicable: ['IMPLEMENTED', 'TESTED', 'INSTALLED', 'BEHAVIOURALLY PROVEN'],
        evidence: {
          IMPLEMENTED: ['src/domain/sdlc.ts'],
          TESTED: ['focused regression passed'],
          INSTALLED: ['   '],
        },
      }),
    ).toEqual({
      IMPLEMENTED: 'proven',
      TESTED: 'proven',
      STAGED: 'not_required',
      RESOLVED: 'not_required',
      LOADED: 'not_required',
      FOLLOWED: 'not_required',
      INSTALLED: 'unproven',
      'BEHAVIOURALLY PROVEN': 'unproven',
    });
  });

  it('can prove workflow states without inventing installation requirements', () => {
    expect(
      assessTaskDeliveryEvidence({
        applicable: ['RESOLVED', 'LOADED', 'FOLLOWED'],
        evidence: {
          RESOLVED: ['dependency resolution recorded'],
          LOADED: ['configuration observed in runtime'],
          FOLLOWED: ['procedure evidence recorded'],
        },
      }),
    ).toMatchObject({
      IMPLEMENTED: 'not_required',
      TESTED: 'not_required',
      RESOLVED: 'proven',
      LOADED: 'proven',
      FOLLOWED: 'proven',
      INSTALLED: 'not_required',
      'BEHAVIOURALLY PROVEN': 'not_required',
    });
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

  it('separates PROMOTABLE from installed READY proof', () => {
    expect(
      assessPromotion({
        prePromotionEvidencePassed: true,
        review: 'independent',
        reviewPassed: true,
        blockerFindings: 0,
      }),
    ).toEqual({ promotion: 'PROMOTABLE', blockers: [] });
    expect(
      assessDelivery(
        {
          implementationExists: true,
          deterministicChecksPassed: true,
          reviewPassed: true,
        },
        { review: 'independent', installationRequired: true },
      ),
    ).toMatchObject({
      delivery: 'validated',
      installationProof: 'unproven',
      behaviorProof: 'unproven',
    });
  });

  it('refuses promotion for missing evidence, required review, or BLOCKER findings', () => {
    expect(
      assessPromotion({
        prePromotionEvidencePassed: false,
        review: 'focused',
        reviewPassed: false,
        blockerFindings: 1,
      }),
    ).toEqual({
      promotion: 'NOT_PROMOTABLE',
      blockers: [
        'required pre-promotion evidence is missing',
        'required review has not passed',
        'BLOCKER findings remain',
      ],
    });
  });
});

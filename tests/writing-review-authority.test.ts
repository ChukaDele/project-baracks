import { describe, expect, it } from 'vitest';
import { resolveWritingReviewAuthority } from '../src/writing/review-authority.js';
import { writingDraftDigest } from '../src/writing/runtime.js';
import { canonicalGradeProvenance, testDb } from './helpers.js';

describe('persisted writing review authority', () => {
  it('accepts only the exact draft digest on the canonical append-only receipt', () => {
    const db = testDb();
    const draft = 'Carefully supported claim.';
    const digest = writingDraftDigest(draft);
    const sourcesDigest = 'e'.repeat(64);
    const fixture = canonicalGradeProvenance(db, {
      id: 'writing-review',
      project: 'project-baracks',
      goalId: 'goal-writing',
      reviewEvidence: JSON.stringify({
        writingDraftSha256: digest,
        assessment: 'The exact draft preserves its supported claims and qualifications.',
        checks: [
          {
            dimension: 'source fidelity',
            draftExcerpt: 'supported claim',
            evidence: 'The traced claim matches the supplied source.',
          },
        ],
        findings: [],
        sourceCoverage: { sourcesSha256: sourcesDigest, verdict: 'pass' },
      }),
    });
    expect(
      resolveWritingReviewAuthority(db, {
        project: 'project-baracks',
        goalId: 'goal-writing',
        reviewedRunId: fixture.reviewedExecutionId,
        sourceHead: 'a'.repeat(40),
        sourceTreeDigest: 'b'.repeat(64),
        draft,
      }),
    ).toMatchObject({
      redTeam: { receiptId: fixture.reviewReceiptId, verdict: 'pass' },
      sourceCoverage: {
        receiptId: fixture.reviewReceiptId,
        sourcesSha256: sourcesDigest,
        verdict: 'pass',
      },
    });
    expect(
      resolveWritingReviewAuthority(db, {
        project: 'project-baracks',
        goalId: 'goal-writing',
        reviewedRunId: fixture.reviewedExecutionId,
        sourceHead: 'a'.repeat(40),
        sourceTreeDigest: 'b'.repeat(64),
        draft: 'Different draft.',
      }),
    ).toBeUndefined();
  });

  it('rejects digest-only receipts without substantive reviewer observations', () => {
    const db = testDb();
    const draft = 'Carefully supported claim.';
    const digest = writingDraftDigest(draft);
    const fixture = canonicalGradeProvenance(db, {
      id: 'digest-only-writing-review',
      project: 'project-baracks',
      goalId: 'goal-digest-only',
      reviewEvidence: JSON.stringify({ writingDraftSha256: digest, findings: [] }),
    });
    expect(
      resolveWritingReviewAuthority(db, {
        project: 'project-baracks',
        goalId: 'goal-digest-only',
        reviewedRunId: fixture.reviewedExecutionId,
        sourceHead: 'a'.repeat(40),
        sourceTreeDigest: 'b'.repeat(64),
        draft,
      }),
    ).toBeUndefined();
  });

  it('rejects schema-shaped generic checks whose excerpts are absent from the exact draft', () => {
    const db = testDb();
    const draft = 'Carefully supported claim.';
    const fixture = canonicalGradeProvenance(db, {
      id: 'generic-writing-review',
      project: 'project-baracks',
      goalId: 'goal-generic-review',
      reviewEvidence: JSON.stringify({
        writingDraftSha256: writingDraftDigest(draft),
        assessment: 'This generic assessment is long enough but is not grounded.',
        checks: [
          {
            dimension: 'quality',
            draftExcerpt: 'Text that is not in the draft.',
            evidence: 'The reviewer asserts that quality was checked.',
          },
        ],
        findings: [],
      }),
    });
    expect(
      resolveWritingReviewAuthority(db, {
        project: 'project-baracks',
        goalId: 'goal-generic-review',
        reviewedRunId: fixture.reviewedExecutionId,
        sourceHead: 'a'.repeat(40),
        sourceTreeDigest: 'b'.repeat(64),
        draft,
      }),
    ).toBeUndefined();
  });
});

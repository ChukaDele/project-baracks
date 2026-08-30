import { describe, expect, it } from 'vitest';
import { resolveWritingReviewAuthority } from '../src/writing/review-authority.js';
import { canonicalGradeProvenance, testDb } from './helpers.js';

describe('persisted writing review authority', () => {
  it('accepts only the exact draft digest on the canonical append-only receipt', () => {
    const db = testDb();
    const digest = 'c'.repeat(64);
    const fixture = canonicalGradeProvenance(db, {
      id: 'writing-review',
      project: 'project-baracks',
      goalId: 'goal-writing',
      reviewEvidence: JSON.stringify({ writingDraftSha256: digest, findings: [] }),
    });
    expect(
      resolveWritingReviewAuthority(db, {
        project: 'project-baracks',
        goalId: 'goal-writing',
        reviewedRunId: fixture.reviewedExecutionId,
        sourceHead: 'a'.repeat(40),
        sourceTreeDigest: 'b'.repeat(64),
        draftSha256: digest,
      }),
    ).toMatchObject({ redTeam: { receiptId: fixture.reviewReceiptId, verdict: 'pass' } });
    expect(
      resolveWritingReviewAuthority(db, {
        project: 'project-baracks',
        goalId: 'goal-writing',
        reviewedRunId: fixture.reviewedExecutionId,
        sourceHead: 'a'.repeat(40),
        sourceTreeDigest: 'b'.repeat(64),
        draftSha256: 'd'.repeat(64),
      }),
    ).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';
import {
  resolveWritingReviewAuthority,
  writingReviewEvidenceMatchesDraft,
  type WritingReviewEvidence,
} from '../src/writing/review-authority.js';
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
            draftExcerpt: draft,
            evidence: 'The supported claim retains its careful qualification and source meaning.',
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

  it('rejects one-character, common-word, and generic-match observations', () => {
    const draft = 'The measured improvement remains limited to the controlled study population.';
    const base: WritingReviewEvidence = {
      writingDraftSha256: writingDraftDigest(draft),
      assessment: 'The draft was reviewed for claim strength and qualification fidelity.',
      checks: [
        {
          dimension: 'claim strength',
          draftExcerpt: 'measured improvement remains limited',
          evidence: 'The measured improvement remains explicitly limited to the study population.',
        },
      ],
      findings: [],
    };
    expect(writingReviewEvidenceMatchesDraft(base, draft)).toBe(true);
    expect(
      writingReviewEvidenceMatchesDraft(
        { ...base, checks: [{ ...base.checks[0]!, draftExcerpt: 'e' }] },
        draft,
      ),
    ).toBe(false);
    expect(
      writingReviewEvidenceMatchesDraft(
        { ...base, checks: [{ ...base.checks[0]!, draftExcerpt: 'The' }] },
        draft,
      ),
    ).toBe(false);
    expect(
      writingReviewEvidenceMatchesDraft(
        {
          ...base,
          checks: [
            {
              ...base.checks[0]!,
              evidence: 'The measured improvement digest matches the exact draft excerpt.',
            },
          ],
        },
        draft,
      ),
    ).toBe(false);
  });

  it('allows a legitimate short draft only when the whole draft is substantively reviewed', () => {
    const draft = 'Thanks!';
    const evidence: WritingReviewEvidence = {
      writingDraftSha256: writingDraftDigest(draft),
      assessment: 'The short transactional reply was reviewed in its complete context.',
      checks: [
        {
          dimension: 'transactional fit',
          draftExcerpt: draft,
          evidence: 'The acknowledgment is appropriately concise and courteous for this reply.',
        },
      ],
      findings: [],
    };
    expect(writingReviewEvidenceMatchesDraft(evidence, draft)).toBe(true);
    expect(
      writingReviewEvidenceMatchesDraft(
        { ...evidence, checks: [{ ...evidence.checks[0]!, draftExcerpt: 'T' }] },
        draft,
      ),
    ).toBe(false);
  });
});

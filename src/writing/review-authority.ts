import { and, desc, eq } from 'drizzle-orm';
import type { DbConn } from '../db/client.js';
import { independentReviewReceipts } from '../db/schema.js';
import type { WritingRuntimeAuthority } from './runtime.js';

/** Resolve writing red-team authority only from Major's append-only review
 * receipt. Free-form worker identifiers and verdicts are never consulted. */
export function resolveWritingReviewAuthority(
  db: DbConn,
  input: {
    project: string;
    goalId: string;
    reviewedRunId: string;
    sourceHead: string;
    sourceTreeDigest: string;
    draftSha256: string;
  },
): WritingRuntimeAuthority | undefined {
  const receipts = db
    .select()
    .from(independentReviewReceipts)
    .where(
      and(
        eq(independentReviewReceipts.project, input.project),
        eq(independentReviewReceipts.goalId, input.goalId),
        eq(independentReviewReceipts.reviewedRunId, input.reviewedRunId),
        eq(independentReviewReceipts.sourceHead, input.sourceHead),
        eq(independentReviewReceipts.sourceTreeDigest, input.sourceTreeDigest),
        eq(independentReviewReceipts.executionStatus, 'succeeded'),
      ),
    )
    .orderBy(desc(independentReviewReceipts.createdAt))
    .all();
  for (const receipt of receipts) {
    try {
      const evidence = JSON.parse(receipt.evidence) as Record<string, unknown>;
      if (evidence.writingDraftSha256 !== input.draftSha256) continue;
      const sourceCoverage = evidence.sourceCoverage;
      const coverage =
        sourceCoverage && typeof sourceCoverage === 'object' && !Array.isArray(sourceCoverage)
          ? (sourceCoverage as Record<string, unknown>)
          : undefined;
      return {
        redTeam: {
          receiptId: receipt.id,
          draftSha256: input.draftSha256,
          verdict: receipt.verdict,
        },
        ...(coverage &&
        typeof coverage.sourcesSha256 === 'string' &&
        /^[a-f0-9]{64}$/u.test(coverage.sourcesSha256) &&
        coverage.verdict === receipt.verdict
          ? {
              sourceCoverage: {
                receiptId: receipt.id,
                draftSha256: input.draftSha256,
                sourcesSha256: coverage.sourcesSha256,
                verdict: receipt.verdict,
              },
            }
          : {}),
      };
    } catch {
      // Legacy/free-form receipt evidence cannot authorize a writing gate.
    }
  }
  return undefined;
}

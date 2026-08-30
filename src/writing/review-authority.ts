import { and, desc, eq } from 'drizzle-orm';
import type { DbConn } from '../db/client.js';
import { independentReviewReceipts } from '../db/schema.js';
import type { WritingRuntimeAuthority } from './runtime.js';

export interface WritingReviewEvidence {
  writingDraftSha256: string;
  assessment: string;
  checks: Array<{ dimension: string; evidence: string }>;
  findings: string[];
  sourceCoverage?: { sourcesSha256: string; verdict: 'pass' | 'fail' };
}

/** A digest binds identity but is not a review. Require bounded, substantive
 * observations so a caller cannot authorize completion with hashes alone. */
export function parseWritingReviewEvidence(value: string): WritingReviewEvidence | undefined {
  if (Buffer.byteLength(value, 'utf8') > 4_000) return undefined;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    if (
      typeof parsed.writingDraftSha256 !== 'string' ||
      !/^[a-f0-9]{64}$/u.test(parsed.writingDraftSha256) ||
      typeof parsed.assessment !== 'string' ||
      parsed.assessment.trim().length < 20 ||
      Buffer.byteLength(parsed.assessment, 'utf8') > 2_000 ||
      !Array.isArray(parsed.checks) ||
      parsed.checks.length === 0 ||
      parsed.checks.length > 20 ||
      !Array.isArray(parsed.findings) ||
      parsed.findings.length > 20
    )
      return undefined;
    const bounded = (candidate: unknown, maximum: number): candidate is string =>
      typeof candidate === 'string' &&
      Boolean(candidate.trim()) &&
      Buffer.byteLength(candidate, 'utf8') <= maximum;
    const checks = parsed.checks.flatMap((item): WritingReviewEvidence['checks'] => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const check = item as Record<string, unknown>;
      return bounded(check.dimension, 200) && bounded(check.evidence, 1_000)
        ? [{ dimension: check.dimension.trim(), evidence: check.evidence.trim() }]
        : [];
    });
    const findings = parsed.findings.filter((item): item is string => bounded(item, 1_000));
    if (checks.length !== parsed.checks.length || findings.length !== parsed.findings.length)
      return undefined;
    const source =
      parsed.sourceCoverage &&
      typeof parsed.sourceCoverage === 'object' &&
      !Array.isArray(parsed.sourceCoverage)
        ? (parsed.sourceCoverage as Record<string, unknown>)
        : undefined;
    if (
      parsed.sourceCoverage !== undefined &&
      (!source ||
        typeof source.sourcesSha256 !== 'string' ||
        !/^[a-f0-9]{64}$/u.test(source.sourcesSha256) ||
        !['pass', 'fail'].includes(String(source.verdict)))
    )
      return undefined;
    return {
      writingDraftSha256: parsed.writingDraftSha256,
      assessment: parsed.assessment.trim(),
      checks,
      findings,
      ...(source
        ? {
            sourceCoverage: {
              sourcesSha256: source.sourcesSha256 as string,
              verdict: source.verdict as 'pass' | 'fail',
            },
          }
        : {}),
    };
  } catch {
    return undefined;
  }
}

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
      const evidence = parseWritingReviewEvidence(receipt.evidence);
      if (!evidence) continue;
      if (evidence.writingDraftSha256 !== input.draftSha256) continue;
      const sourceCoverage = evidence.sourceCoverage;
      return {
        redTeam: {
          receiptId: receipt.id,
          draftSha256: input.draftSha256,
          verdict: receipt.verdict,
        },
        ...(sourceCoverage && sourceCoverage.verdict === receipt.verdict
          ? {
              sourceCoverage: {
                receiptId: receipt.id,
                draftSha256: input.draftSha256,
                sourcesSha256: sourceCoverage.sourcesSha256,
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

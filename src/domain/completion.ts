import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import type { DbConn } from '../db/client.js';
import {
  agentRuns,
  decisionRequests,
  evidence,
  reviewFindings,
  verificationRuns,
} from '../db/schema.js';
import type { CompletionProof } from './lifecycle.js';
import {
  assessPromotion,
  BROADER_VALIDATION_TRIGGERS,
  planProgressiveValidation,
  REVIEW_LEVELS,
  type ReviewSeverity,
} from './sdlc.js';

/**
 * The completion proof set: what must be true, in the database, before a task
 * may reach 'completed'. Free-text evidence alone is never sufficient — the
 * proof requires QUALIFYING VerificationRun records (passed with exit code 0,
 * completed timestamps, produced under a succeeded agent run of this same
 * task, and cited by an immutable evidence row), resolved BLOCKER review
 * findings, verified evidence relationships, and any task-specific criteria.
 * It is evaluated inside the same transaction as the final state transition,
 * and the same invariants are enforced again by database triggers so a direct
 * write cannot bypass them (latest tasks_completion_requires_proof trigger).
 */

export const completionCriteriaSchema = z
  .object({
    /** Minimum passed verification runs (default 1; cannot be set below 1). */
    minPassedVerificationRuns: z.number().int().min(1).default(1),
    /** Require at least one 'artifact' evidence (commit/branch/PR ref). */
    requireArtifact: z.boolean().default(false),
    /** DecisionRequest categories that must each have an approved decision. */
    requiredDecisionCategories: z.array(z.string().min(1)).default([]),
    /** Opt-in progressive proof contract. Absent on legacy tasks, which retain
     * their existing minimum-verification completion semantics. */
    progressiveValidation: z
      .object({
        riskSpecificChecks: z.array(z.string().min(1)).default([]),
        broaderValidationTriggers: z.enum(BROADER_VALIDATION_TRIGGERS).array().default([]),
        repositoryPolicyRequiresBroadValidation: z.boolean().default(false),
        review: z.enum(REVIEW_LEVELS).default('focused'),
      })
      .strict()
      .optional(),
  })
  .strict();

export type CompletionCriteria = z.infer<typeof completionCriteriaSchema>;

export function parseCompletionCriteria(json: string | null | undefined): CompletionCriteria {
  return completionCriteriaSchema.parse(json ? JSON.parse(json) : {});
}

export interface CompletionProofResult extends CompletionProof {
  failures: string[];
  checkedAt: string;
}

export const REVIEW_SEVERITY_STORAGE = {
  BLOCKER: 'critical',
  IMPORTANT: 'minor',
  NIT: 'info',
} as const satisfies Record<ReviewSeverity, 'critical' | 'minor' | 'info'>;

/** `major` is the pre-SDLC storage alias for a blocking finding. Retaining it
 * preserves existing rows while all new canonical BLOCKER writes use critical. */
export const BLOCKING_STORED_REVIEW_SEVERITIES = ['critical', 'major'] as const;

export function reviewSeverityFromStorage(
  severity: 'info' | 'minor' | 'major' | 'critical',
): ReviewSeverity {
  if (severity === 'critical' || severity === 'major') return 'BLOCKER';
  return severity === 'minor' ? 'IMPORTANT' : 'NIT';
}

export function evaluateCompletionProof(
  db: DbConn,
  taskId: string,
  criteria: CompletionCriteria = completionCriteriaSchema.parse({}),
): CompletionProofResult {
  const failures: string[] = [];

  // A verification run qualifies only when its 'passed' label is backed by
  // exit code 0, completed timestamps, provenance (a succeeded agent run of
  // this same task — the composite FK guarantees the task linkage), and an
  // immutable evidence row citing it.
  const qualifyingVerifications = db
    .selectDistinct({
      id: verificationRuns.id,
      validationSubject: verificationRuns.validationSubject,
    })
    .from(verificationRuns)
    .innerJoin(
      agentRuns,
      and(
        eq(verificationRuns.agentRunId, agentRuns.id),
        eq(agentRuns.taskId, verificationRuns.taskId),
      ),
    )
    .innerJoin(
      evidence,
      and(
        eq(evidence.ref, verificationRuns.id),
        eq(evidence.kind, 'verification_run'),
        eq(evidence.taskId, verificationRuns.taskId),
      ),
    )
    .where(
      and(
        eq(verificationRuns.taskId, taskId),
        eq(verificationRuns.status, 'passed'),
        eq(verificationRuns.exitCode, 0),
        isNotNull(verificationRuns.startedAt),
        isNotNull(verificationRuns.endedAt),
        eq(agentRuns.status, 'succeeded'),
      ),
    )
    .all();
  const passedVerifications = qualifyingVerifications.length;
  if (passedVerifications < criteria.minPassedVerificationRuns) {
    failures.push(
      `requires ${criteria.minPassedVerificationRuns} qualifying passed verification run(s) ` +
        `(exit 0, completed, from a succeeded run of this task, with linked evidence), ` +
        `found ${passedVerifications}`,
    );
  }

  const openBlockingFindings =
    db
      .select({ n: count() })
      .from(reviewFindings)
      .where(
        and(
          eq(reviewFindings.taskId, taskId),
          eq(reviewFindings.status, 'open'),
          inArray(reviewFindings.severity, [...BLOCKING_STORED_REVIEW_SEVERITIES]),
        ),
      )
      .get()?.n ?? 0;
  const progressive = criteria.progressiveValidation;
  if (progressive) {
    const triggerSet = new Set(progressive.broaderValidationTriggers);
    const plan = planProgressiveValidation({
      riskSpecificChecks: progressive.riskSpecificChecks,
      triggers: Object.fromEntries(
        BROADER_VALIDATION_TRIGGERS.map((trigger) => [trigger, triggerSet.has(trigger)]),
      ),
      repositoryPolicyRequiresBroadValidation: progressive.repositoryPolicyRequiresBroadValidation,
    });
    const provenSubjects = new Set(
      qualifyingVerifications
        .map((verification) => verification.validationSubject)
        .filter((subject): subject is string => subject !== null),
    );
    const missingChecks = plan.requiredChecks.filter((check) => !provenSubjects.has(check));
    if (missingChecks.length > 0) {
      failures.push(`missing required progressive validation: ${missingChecks.join(', ')}`);
    }

    const reviewPassed =
      progressive.review === 'none' ||
      (db
        .select({ n: count() })
        .from(agentRuns)
        .where(
          and(
            eq(agentRuns.taskId, taskId),
            eq(agentRuns.purpose, 'review'),
            eq(agentRuns.status, 'succeeded'),
          ),
        )
        .get()?.n ?? 0) > 0;
    const promotion = assessPromotion({
      prePromotionEvidencePassed:
        passedVerifications >= criteria.minPassedVerificationRuns && missingChecks.length === 0,
      review: progressive.review,
      reviewPassed,
      blockerFindings: openBlockingFindings,
    });
    failures.push(...promotion.blockers);
  } else if (openBlockingFindings > 0) {
    failures.push(`${openBlockingFindings} open BLOCKER review finding(s)`);
  }

  const evidenceRows = db.select().from(evidence).where(eq(evidence.taskId, taskId)).all();
  if (evidenceRows.length === 0) {
    failures.push('no evidence records');
  }

  // Verify evidence relationships: linked-record evidence must reference a
  // real record of this task (insert triggers enforce this too; re-checking
  // here defends against rows created before the triggers existed).
  for (const row of evidenceRows) {
    if (row.kind === 'verification_run') {
      const linked = db
        .select({ n: count() })
        .from(verificationRuns)
        .where(and(eq(verificationRuns.id, row.ref ?? ''), eq(verificationRuns.taskId, taskId)))
        .get();
      if ((linked?.n ?? 0) === 0) {
        failures.push(`evidence ${row.id} does not reference a verification run of this task`);
      }
    }
  }

  if (criteria.requireArtifact) {
    const artifact = evidenceRows.find((row) => row.kind === 'artifact' && row.ref?.trim());
    if (!artifact) failures.push('requires an artifact evidence record with a repository ref');
  }

  for (const category of criteria.requiredDecisionCategories) {
    const approved =
      db
        .select({ n: count() })
        .from(decisionRequests)
        .where(
          and(
            eq(decisionRequests.taskId, taskId),
            eq(decisionRequests.category, category),
            eq(decisionRequests.status, 'approved'),
          ),
        )
        .get()?.n ?? 0;
    if (approved === 0) failures.push(`requires an approved '${category}' DecisionRequest`);
  }

  return { ok: failures.length === 0, failures, checkedAt: new Date().toISOString() };
}

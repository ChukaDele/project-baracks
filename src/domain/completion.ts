import { and, count, eq, inArray, isNotNull } from 'drizzle-orm';
import { z } from 'zod';
import { resolve } from 'node:path';
import type { DbConn } from '../db/client.js';
import {
  agentRuns,
  agentProviders,
  decisionRequests,
  evidence,
  projects,
  reviewFindings,
  tasks,
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
    requiredDecisionCategories: z.array(z.string().trim().min(1)).default([]),
    /** Opt-in progressive proof contract. Absent on legacy tasks, which retain
     * their existing minimum-verification completion semantics. */
    progressiveValidation: z
      .object({
        riskSpecificChecks: z.array(z.string().trim().min(1)).default([]),
        broaderValidationTriggers: z.enum(BROADER_VALIDATION_TRIGGERS).array().default([]),
        repositoryPolicyRequiresBroadValidation: z.boolean().default(false),
        review: z.enum(REVIEW_LEVELS).default('focused'),
        candidateHead: z
          .string()
          .regex(/^[0-9a-f]{40}$/)
          .optional(),
        broadValidationJustification: z
          .object({
            cost: z.string().trim().min(1),
            expectedInformationGain: z.string().trim().min(1),
          })
          .strict()
          .optional(),
      })
      .strict()
      .superRefine((value, context) => {
        const broadRequired =
          value.broaderValidationTriggers.length > 0 ||
          value.repositoryPolicyRequiresBroadValidation;
        if (broadRequired && !value.broadValidationJustification) {
          context.addIssue({
            code: 'custom',
            path: ['broadValidationJustification'],
            message: 'broad validation requires recorded cost and expected information gain',
          });
        }
        if (!value.candidateHead) {
          context.addIssue({
            code: 'custom',
            path: ['candidateHead'],
            message: 'progressive validation requires an exact candidate head',
          });
        }
      })
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

export interface TaskPromotionProofResult extends CompletionProofResult {
  taskId: string;
}

export interface CanonicalTaskBinding {
  taskId: string;
  projectId: string;
  repoPath: string;
  frozenCriteriaJson: string;
}

export type CanonicalTaskBindingResult =
  | { ok: true; binding: CanonicalTaskBinding }
  | {
      ok: false;
      kind: 'no_task' | 'ambiguous' | 'invalid_project' | 'invalid_task';
      failure: string;
    };

/** Resolve the one promotable task through the existing project/task store.
 * Repository identity is canonical; project display names and worker-supplied
 * task IDs are not authority. */
export function resolveCanonicalTaskBinding(
  db: DbConn,
  repoPath: string,
): CanonicalTaskBindingResult {
  const normalizedRepo = resolve(repoPath);
  const project = db
    .select({ id: projects.id, repoPath: projects.repoPath })
    .from(projects)
    .all()
    .find((candidate) => resolve(candidate.repoPath) === normalizedRepo);
  if (!project)
    return {
      ok: false,
      kind: 'no_task',
      failure: `project not found for repository: ${normalizedRepo}`,
    };
  const candidates = db
    .select({ taskId: tasks.id, criteria: tasks.completionCriteriaSnapshotJson })
    .from(tasks)
    .where(and(eq(tasks.projectId, project.id), eq(tasks.status, 'ready_to_merge')))
    .all();
  if (candidates.length === 0) {
    return { ok: false, kind: 'no_task', failure: 'repository has no ready_to_merge task' };
  }
  if (candidates.length !== 1) {
    return {
      ok: false,
      kind: 'ambiguous',
      failure: `repository has ${candidates.length} ready_to_merge task(s) with frozen criteria; expected exactly one`,
    };
  }
  const candidate = candidates[0];
  if (!candidate?.criteria) {
    return {
      ok: false,
      kind: 'invalid_task',
      failure: 'canonical ready_to_merge task has no frozen completion criteria',
    };
  }
  return {
    ok: true,
    binding: {
      taskId: candidate.taskId,
      projectId: project.id,
      repoPath: project.repoPath,
      frozenCriteriaJson: candidate.criteria,
    },
  };
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
    const missingChecks = plan.requiredChecks
      .filter((check) => check !== 'risk_specific_checks')
      .filter((check) => !provenSubjects.has(check));
    const missingRiskChecks = progressive.riskSpecificChecks.filter(
      (check) => !provenSubjects.has(`risk_specific_check:${check}`),
    );
    if (missingRiskChecks.length > 0) {
      failures.push(`missing risk-specific verification: ${missingRiskChecks.join(', ')}`);
    }
    if (missingChecks.length > 0) {
      failures.push(`missing required progressive validation: ${missingChecks.join(', ')}`);
    }
    if (!plan.broaderValidationRequired && provenSubjects.has('broader_validation')) {
      failures.push('untriggered broader validation evidence is not promotable');
    }

    const implementationProviders = new Set(
      db
        .select({ providerName: agentProviders.name, sourceHead: agentRuns.sourceHead })
        .from(agentRuns)
        .innerJoin(agentProviders, eq(agentProviders.id, agentRuns.providerId))
        .where(
          and(
            eq(agentRuns.taskId, taskId),
            inArray(agentRuns.purpose, ['implementation', 'repair']),
            eq(agentRuns.status, 'succeeded'),
          ),
        )
        .all()
        .filter((run) => !progressive.candidateHead || run.sourceHead === progressive.candidateHead)
        .map((run) => run.providerName),
    );
    const succeededReviews = db
      .select({
        providerName: agentProviders.name,
        independenceLoss: agentRuns.independenceLoss,
        sourceHead: agentRuns.sourceHead,
      })
      .from(agentRuns)
      .innerJoin(agentProviders, eq(agentProviders.id, agentRuns.providerId))
      .where(
        and(
          eq(agentRuns.taskId, taskId),
          eq(agentRuns.purpose, 'review'),
          eq(agentRuns.status, 'succeeded'),
        ),
      )
      .all();
    const reviewPassed =
      progressive.review === 'none' ||
      succeededReviews.some(
        (review) =>
          (!progressive.candidateHead || review.sourceHead === progressive.candidateHead) &&
          (progressive.review !== 'independent' ||
            (review.independenceLoss === null &&
              implementationProviders.size > 0 &&
              !implementationProviders.has(review.providerName))),
      );
    const promotion = assessPromotion({
      prePromotionEvidencePassed:
        passedVerifications >= criteria.minPassedVerificationRuns &&
        missingChecks.length === 0 &&
        missingRiskChecks.length === 0,
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

  const taskProjectId = db
    .select({ projectId: tasks.projectId })
    .from(tasks)
    .where(eq(tasks.id, taskId))
    .get()?.projectId;

  for (const category of criteria.requiredDecisionCategories) {
    const approved =
      db
        .select({ n: count() })
        .from(decisionRequests)
        .where(
          and(
            eq(decisionRequests.taskId, taskId),
            eq(decisionRequests.projectId, taskProjectId ?? ''),
            eq(decisionRequests.category, category),
            eq(decisionRequests.status, 'approved'),
          ),
        )
        .get()?.n ?? 0;
    if (approved === 0) failures.push(`requires an approved '${category}' DecisionRequest`);
  }

  return { ok: failures.length === 0, failures, checkedAt: new Date().toISOString() };
}

/** Resolve a coordinator completion claim through the canonical task row and
 * its immutable dispatch criteria. This is PROMOTABLE proof only: it neither
 * installs the candidate nor claims READY. */
export function evaluateTaskPromotionProof(
  db: DbConn,
  input: { taskId: string; repoPath: string },
): TaskPromotionProofResult {
  const row = db
    .select({
      taskId: tasks.id,
      status: tasks.status,
      criteria: tasks.completionCriteriaSnapshotJson,
      repoPath: projects.repoPath,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(eq(tasks.id, input.taskId))
    .get();
  const checkedAt = new Date().toISOString();
  if (!row) {
    return {
      taskId: input.taskId,
      ok: false,
      failures: ['canonical task does not exist'],
      checkedAt,
    };
  }
  const failures: string[] = [];
  if (resolve(row.repoPath) !== resolve(input.repoPath)) {
    failures.push('canonical task belongs to another repository');
  }
  if (row.status !== 'ready_to_merge') {
    failures.push(`canonical task is ${row.status}, not ready_to_merge`);
  }
  if (row.criteria === null) failures.push('canonical task has no frozen completion criteria');
  if (failures.length > 0) return { taskId: row.taskId, ok: false, failures, checkedAt };
  try {
    return {
      taskId: row.taskId,
      ...evaluateCompletionProof(db, row.taskId, parseCompletionCriteria(row.criteria)),
    };
  } catch (error) {
    return {
      taskId: row.taskId,
      ok: false,
      failures: [
        `canonical task completion criteria are invalid: ${error instanceof Error ? error.message : String(error)}`,
      ],
      checkedAt,
    };
  }
}

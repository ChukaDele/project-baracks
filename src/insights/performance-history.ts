import { randomUUID } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import type { DbConn } from '../db/client.js';
import {
  agentProviders,
  agentRuns,
  independentReviewReceipts,
  runPerformanceObservations,
} from '../db/schema.js';
import { redactValue } from '../security/redact.js';

export const RUN_INSIGHT_SCHEMA = 'major.run-insight.v1' as const;
export const BEST_WORKER_MIN_RUNS = 3;
export const RUN_INSIGHT_OUTCOMES = ['completed', 'blocked', 'failed', 'cancelled'] as const;

export type RunInsightOutcome = (typeof RUN_INSIGHT_OUTCOMES)[number];

type Effect = { subject: string; effect: 'helped' | 'hurt'; evidence: string };
export type Receipt = Record<string, unknown> & {
  schema: typeof RUN_INSIGHT_SCHEMA;
  recordedAt: string;
  goalId: string;
  outcome?: RunInsightOutcome;
  worker?: { coordinator?: string | null; provider?: string | null; model?: string | null };
  runEvidence?: { runId: string; sourceHead: string };
  independentReview?: {
    purpose: 'independent_completion_review';
    goalId: string;
    sourceHead: string;
    verdict: 'pass' | 'fail';
    evidence: string;
  };
  timing?: {
    durationMs?: number | null;
    productiveWorkMs?: number | null;
    productiveWorkRatio?: number | null;
    productiveWorkRatioLabel?: string | null;
    majorOverheadMs?: number | null;
    infrastructureOverheadMs?: number | null;
    overheadBasis?: string | null;
    stages?: Record<string, number | null>;
  };
  skills?: string[];
  effects?: Effect[];
  failures?: string[];
  recurrence?: {
    signature?: string | null;
    priorOccurrences?: number | null;
    evidence?: string | null;
  };
  humanInterventions?: string[];
  quality?: { assessment?: 'passed' | 'failed' | 'mixed' | 'unknown'; evidence?: string[] };
  reuseStrategy?: { strategy?: string | null; reusableAssets?: string[] };
};

function finite(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function isRunInsightOutcome(value: unknown): value is RunInsightOutcome {
  return RUN_INSIGHT_OUTCOMES.some((outcome) => outcome === value);
}

export function validateRunInsight(value: unknown): Receipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('run insight must be an object');
  }
  const receipt = value as Receipt;
  if (receipt.schema !== RUN_INSIGHT_SCHEMA) throw new Error(`unsupported run insight schema`);
  if (!receipt.goalId?.trim()) throw new Error('run insight requires goalId');
  if (!Number.isFinite(Date.parse(receipt.recordedAt))) {
    throw new Error('run insight requires a valid recordedAt');
  }
  if (receipt.outcome !== undefined && !isRunInsightOutcome(receipt.outcome)) {
    throw new Error('run insight outcome must be completed, blocked, failed, or cancelled');
  }
  const review = receipt.independentReview;
  if (
    review !== undefined &&
    (review.purpose !== 'independent_completion_review' ||
      !review.goalId?.trim() ||
      !/^[0-9a-f]{40}$/.test(review.sourceHead) ||
      !['pass', 'fail'].includes(review.verdict) ||
      !review.evidence?.trim())
  ) {
    throw new Error('run insight independent review receipt is invalid');
  }
  for (const key of ['skills', 'failures', 'humanInterventions'] as const) {
    const field = receipt[key];
    if (
      field !== undefined &&
      (!Array.isArray(field) || field.some((item) => typeof item !== 'string'))
    ) {
      throw new Error(`run insight ${key} must be an array of strings`);
    }
  }
  if (
    receipt.effects !== undefined &&
    (!Array.isArray(receipt.effects) ||
      receipt.effects.some(
        (effect) =>
          !effect ||
          typeof effect.subject !== 'string' ||
          !['helped', 'hurt'].includes(effect.effect) ||
          typeof effect.evidence !== 'string',
      ))
  ) {
    throw new Error('run insight effects must be evidence-qualified helped/hurt records');
  }
  if (
    receipt.quality !== undefined &&
    (!receipt.quality ||
      typeof receipt.quality !== 'object' ||
      Array.isArray(receipt.quality) ||
      (receipt.quality.assessment !== undefined &&
        !['passed', 'failed', 'mixed', 'unknown'].includes(receipt.quality.assessment)) ||
      (receipt.quality.evidence !== undefined &&
        (!Array.isArray(receipt.quality.evidence) ||
          receipt.quality.evidence.some((item) => typeof item !== 'string'))))
  ) {
    throw new Error('run insight quality must contain a known assessment and string evidence');
  }
  if (receipt.timing !== undefined) {
    if (!receipt.timing || typeof receipt.timing !== 'object' || Array.isArray(receipt.timing)) {
      throw new Error('run insight timing must be an object');
    }
    if (
      receipt.timing.stages !== undefined &&
      (!receipt.timing.stages ||
        typeof receipt.timing.stages !== 'object' ||
        Array.isArray(receipt.timing.stages))
    ) {
      throw new Error('run insight timing stages must be an object');
    }
    const timingValues = [
      receipt.timing.durationMs,
      receipt.timing.productiveWorkMs,
      receipt.timing.productiveWorkRatio,
      receipt.timing.majorOverheadMs,
      receipt.timing.infrastructureOverheadMs,
      ...Object.values(receipt.timing.stages ?? {}),
    ];
    if (
      timingValues.some((item) => item !== undefined && item !== null && finite(item) === undefined)
    ) {
      throw new Error('run insight timing values must be non-negative finite numbers or null');
    }
  }
  return redactValue(receipt);
}

export function recordPerformanceObservation(
  db: DbConn,
  input: { project: string; source: 'major' | 'dsh'; receipt: unknown },
): Receipt {
  if (!input.project.trim()) throw new Error('performance observation requires project identity');
  const receipt = validateRunInsight(input.receipt);
  db.insert(runPerformanceObservations)
    .values({
      id: randomUUID(),
      project: input.project.trim(),
      goalId: receipt.goalId,
      source: input.source,
      schema: receipt.schema,
      receiptJson: JSON.stringify(receipt),
      recordedAt: receipt.recordedAt,
    })
    .run();
  return receipt;
}

/** Mint completion authority only from the dedicated provider execution
 * controlled by Major after the worker completion claim already exists. */
export function recordIndependentReviewExecution(
  db: DbConn,
  input: {
    project: string;
    goalId: string;
    runId: string;
    reviewedRunId: string;
    taskId: string;
    dispatchId: string;
    provider: string;
    providerId: string;
    providerAccountLabel: string;
    sourceHead: string;
    sourceTreeDigest: string;
    pendingClaimedAt: string;
    reviewStartedAt: string;
    executionStatus: 'succeeded';
    review: NonNullable<Receipt['independentReview']>;
  },
): string {
  if (
    !input.project.trim() ||
    !input.goalId.trim() ||
    !input.runId.trim() ||
    !input.reviewedRunId.trim() ||
    !input.taskId.trim() ||
    !input.dispatchId.trim() ||
    !input.provider.trim() ||
    !input.providerId.trim() ||
    !input.providerAccountLabel.trim()
  ) {
    throw new Error('independent review execution identity is incomplete');
  }
  if (!/^[0-9a-f]{40}$/.test(input.sourceHead)) throw new Error('invalid review source head');
  if (!/^[0-9a-f]{64}$/.test(input.sourceTreeDigest)) {
    throw new Error('invalid reviewed source-tree digest');
  }
  if (input.runId === input.reviewedRunId) {
    throw new Error('independent review must be a distinct execution');
  }
  if (input.review.goalId !== input.goalId || input.review.sourceHead !== input.sourceHead) {
    throw new Error('provider review verdict is not bound to this goal and exact head');
  }
  if (input.review.purpose !== 'independent_completion_review' || !input.review.evidence.trim()) {
    throw new Error('provider review verdict is invalid');
  }
  if (
    !Number.isFinite(Date.parse(input.pendingClaimedAt)) ||
    !Number.isFinite(Date.parse(input.reviewStartedAt)) ||
    Date.parse(input.reviewStartedAt) < Date.parse(input.pendingClaimedAt)
  ) {
    throw new Error('independent review execution predates the pending completion claim');
  }
  const reviewedRun = db
    .select({
      taskId: agentRuns.taskId,
      purpose: agentRuns.purpose,
      sourceHead: agentRuns.sourceHead,
      sessionRef: agentRuns.sessionRef,
      status: agentRuns.status,
    })
    .from(agentRuns)
    .where(eq(agentRuns.id, input.reviewedRunId))
    .get();
  if (
    !reviewedRun ||
    reviewedRun.taskId !== input.taskId ||
    !['implementation', 'repair'].includes(reviewedRun.purpose) ||
    reviewedRun.sourceHead !== input.sourceHead ||
    !reviewedRun.sessionRef?.trim() ||
    reviewedRun.status !== 'succeeded'
  ) {
    throw new Error(
      'independent review authority requires a distinct canonical succeeded implementation or repair run at the exact head',
    );
  }
  const canonicalRun = db
    .select({
      taskId: agentRuns.taskId,
      providerId: agentRuns.providerId,
      provider: agentProviders.name,
      accountLabel: agentProviders.accountLabel,
      purpose: agentRuns.purpose,
      independenceLoss: agentRuns.independenceLoss,
      sourceHead: agentRuns.sourceHead,
      sessionRef: agentRuns.sessionRef,
      status: agentRuns.status,
    })
    .from(agentRuns)
    .innerJoin(agentProviders, eq(agentProviders.id, agentRuns.providerId))
    .where(eq(agentRuns.id, input.runId))
    .get();
  if (
    !canonicalRun ||
    canonicalRun.taskId !== input.taskId ||
    canonicalRun.providerId !== input.providerId ||
    canonicalRun.provider !== (input.provider === 'claude' ? 'claude-code' : input.provider) ||
    canonicalRun.accountLabel !== input.providerAccountLabel ||
    canonicalRun.purpose !== 'review' ||
    canonicalRun.independenceLoss !== null ||
    canonicalRun.sourceHead !== input.sourceHead ||
    !canonicalRun.sessionRef?.trim() ||
    canonicalRun.status !== 'succeeded'
  ) {
    throw new Error(
      'independent review authority requires the canonical succeeded task run, exact head, review purpose, and routed provider account',
    );
  }
  const id = randomUUID();
  db.insert(independentReviewReceipts)
    .values({
      id,
      project: input.project.trim(),
      goalId: input.goalId,
      runId: input.runId,
      reviewedRunId: input.reviewedRunId,
      reviewSessionRef: canonicalRun.sessionRef.trim(),
      reviewedSessionRef: reviewedRun.sessionRef.trim(),
      taskId: input.taskId,
      dispatchId: input.dispatchId,
      provider: input.provider.trim(),
      providerId: input.providerId,
      providerAccountLabel: input.providerAccountLabel,
      sourceHead: input.sourceHead,
      sourceTreeDigest: input.sourceTreeDigest,
      purpose: input.review.purpose,
      verdict: input.review.verdict,
      evidence: input.review.evidence.trim(),
      pendingClaimedAt: input.pendingClaimedAt,
      reviewStartedAt: input.reviewStartedAt,
      executionStatus: input.executionStatus,
    })
    .run();
  return id;
}

export function listPerformanceObservations(
  db: DbConn,
  project: string,
  goalId?: string,
): Receipt[] {
  const where = goalId
    ? and(
        eq(runPerformanceObservations.project, project),
        eq(runPerformanceObservations.goalId, goalId),
      )
    : eq(runPerformanceObservations.project, project);
  return db
    .select({ receiptJson: runPerformanceObservations.receiptJson })
    .from(runPerformanceObservations)
    .where(where)
    .orderBy(
      desc(runPerformanceObservations.recordedAt),
      desc(runPerformanceObservations.createdAt),
    )
    .all()
    .map((row) => validateRunInsight(JSON.parse(row.receiptJson)));
}

export function getPerformanceObservation(db: DbConn, id: string): Receipt | undefined {
  const row = db
    .select({ receiptJson: runPerformanceObservations.receiptJson })
    .from(runPerformanceObservations)
    .where(eq(runPerformanceObservations.id, id))
    .get();
  return row ? validateRunInsight(JSON.parse(row.receiptJson)) : undefined;
}

export function getPerformanceObservationRecord(db: DbConn, id: string) {
  const row = db
    .select({
      id: runPerformanceObservations.id,
      project: runPerformanceObservations.project,
      goalId: runPerformanceObservations.goalId,
      receiptJson: runPerformanceObservations.receiptJson,
    })
    .from(runPerformanceObservations)
    .where(eq(runPerformanceObservations.id, id))
    .get();
  return row ? { ...row, receipt: validateRunInsight(JSON.parse(row.receiptJson)) } : undefined;
}

export function getIndependentReviewReceipt(db: DbConn, id: string) {
  return db
    .select()
    .from(independentReviewReceipts)
    .where(eq(independentReviewReceipts.id, id))
    .get();
}

function workerKey(receipt: Receipt): string | undefined {
  const worker = receipt.worker;
  if (!worker) return undefined;
  const parts = [worker.coordinator, worker.provider, worker.model].filter(Boolean);
  return parts.length ? parts.join('/') : undefined;
}

function latestComparableChange(ordered: Receipt[]) {
  const current = ordered[0];
  if (!current) return { basis: 'none', result: 'no_prior_run' };
  const prior = ordered.slice(1).find((candidate) => candidate.goalId === current.goalId);
  if (!prior) return { basis: 'none', result: 'no_prior_comparable_run' };
  const changes: Record<string, unknown> = {};
  if (current.outcome !== prior.outcome) {
    changes.outcome = { previous: prior.outcome, current: current.outcome };
  }
  for (const key of ['durationMs', 'productiveWorkRatio'] as const) {
    const previous = finite(prior.timing?.[key]);
    const next = finite(current.timing?.[key]);
    if (previous !== undefined && next !== undefined) {
      changes[key] = { previous, current: next, delta: next - previous };
    }
  }
  const currentAssessment = current.quality?.assessment;
  const priorAssessment = prior.quality?.assessment;
  const comparableQuality = Boolean(
    currentAssessment &&
    currentAssessment !== 'unknown' &&
    current.quality?.evidence?.some((item) => item.trim()) &&
    priorAssessment &&
    priorAssessment !== 'unknown' &&
    prior.quality?.evidence?.some((item) => item.trim()),
  );
  const improvementSupported =
    comparableQuality && currentAssessment === 'passed' && priorAssessment !== 'passed';
  return {
    basis: 'latest_durable_comparable_run',
    result: improvementSupported
      ? 'improvement_supported_by_comparable_quality_evidence'
      : 'insufficient_comparable_quality_evidence',
    ...(Object.keys(changes).length ? { changes } : {}),
  };
}

export function performanceHistoryReport(receipts: Receipt[]) {
  const ordered = [...receipts].sort((a, b) => Date.parse(b.recordedAt) - Date.parse(a.recordedAt));
  const effects = new Map<
    string,
    { subject: string; effect: 'helped' | 'hurt'; occurrences: number; evidence: string[] }
  >();
  const failures = new Map<
    string,
    { signature: string; occurrences: number; evidence: string[] }
  >();
  const workers = new Map<string, { runs: number; successes: number; durations: number[] }>();
  const skillPerformance = new Map<string, { runs: number; successes: number; failures: number }>();
  let totalDurationMs = 0;
  let observedDurationRuns = 0;
  let infrastructureWasteMs = 0;
  let observedInfrastructureRuns = 0;
  let majorOverheadMs = 0;
  let observedMajorOverheadRuns = 0;
  const humanInterventions: string[] = [];
  const reusedAssets = new Set<string>();
  const usedSkills = new Set<string>();

  for (const receipt of ordered) {
    const duration = finite(receipt.timing?.durationMs);
    if (duration !== undefined) {
      totalDurationMs += duration;
      observedDurationRuns += 1;
    }
    const infrastructureOverhead = finite(receipt.timing?.infrastructureOverheadMs);
    if (infrastructureOverhead !== undefined) {
      infrastructureWasteMs += infrastructureOverhead;
      observedInfrastructureRuns += 1;
    }
    const majorOverhead = finite(receipt.timing?.majorOverheadMs);
    if (majorOverhead !== undefined) {
      majorOverheadMs += majorOverhead;
      observedMajorOverheadRuns += 1;
    }
    const worker = workerKey(receipt);
    if (worker) {
      const row = workers.get(worker) ?? { runs: 0, successes: 0, durations: [] };
      row.runs += 1;
      if (receipt.outcome === 'completed') row.successes += 1;
      if (duration !== undefined) row.durations.push(duration);
      workers.set(worker, row);
    }
    for (const effect of receipt.effects ?? []) {
      if (!effect.evidence?.trim()) continue;
      const key = `${effect.effect}:${effect.subject}`;
      const row = effects.get(key) ?? { ...effect, occurrences: 0, evidence: [] };
      row.occurrences += 1;
      row.evidence.push(effect.evidence);
      effects.set(key, row);
    }
    const signature = receipt.outcome === 'completed' ? null : receipt.recurrence?.signature;
    if (signature) {
      const row = failures.get(signature) ?? { signature, occurrences: 0, evidence: [] };
      row.occurrences += 1;
      if (receipt.recurrence?.evidence) row.evidence.push(receipt.recurrence.evidence);
      failures.set(signature, row);
    }
    humanInterventions.push(...(receipt.humanInterventions ?? []));
    for (const skill of receipt.skills ?? []) {
      usedSkills.add(skill);
      const row = skillPerformance.get(skill) ?? { runs: 0, successes: 0, failures: 0 };
      row.runs += 1;
      if (receipt.outcome === 'completed') row.successes += 1;
      if (receipt.outcome === 'failed' || receipt.outcome === 'blocked') row.failures += 1;
      skillPerformance.set(skill, row);
    }
    for (const asset of receipt.reuseStrategy?.reusableAssets ?? []) reusedAssets.add(asset);
  }

  const eligibleWorkers = [...workers.entries()]
    .filter(
      ([, row]) => row.runs >= BEST_WORKER_MIN_RUNS && row.durations.length >= BEST_WORKER_MIN_RUNS,
    )
    .map(([worker, row]) => ({
      worker,
      runs: row.runs,
      successRate: row.successes / row.runs,
      averageDurationMs:
        row.durations.reduce((sum, value) => sum + value, 0) / row.durations.length,
    }))
    .sort((a, b) => b.successRate - a.successRate || a.averageDurationMs - b.averageDurationMs);
  return {
    runs: ordered.length,
    timeSpent: {
      totalDurationMs: observedDurationRuns ? totalDurationMs : null,
      observedRuns: observedDurationRuns,
      averageDurationMs: observedDurationRuns ? totalDurationMs / observedDurationRuns : null,
    },
    overhead: {
      majorOverheadMs: observedMajorOverheadRuns ? majorOverheadMs : null,
      majorObservedRuns: observedMajorOverheadRuns,
      infrastructureOverheadMs: observedInfrastructureRuns ? infrastructureWasteMs : null,
      infrastructureObservedRuns: observedInfrastructureRuns,
    },
    observedStageTiming: ordered.map((receipt) => ({
      goalId: receipt.goalId,
      recordedAt: receipt.recordedAt,
      stages: receipt.timing?.stages ?? null,
    })),
    whyTasksTookLong: ordered
      .filter(
        (receipt) =>
          (finite(receipt.timing?.majorOverheadMs) ?? 0) > 0 ||
          (finite(receipt.timing?.infrastructureOverheadMs) ?? 0) > 0,
      )
      .map((receipt) => ({
        goalId: receipt.goalId,
        recordedAt: receipt.recordedAt,
        timing: receipt.timing,
      })),
    bestWorker: eligibleWorkers.length >= 2 ? eligibleWorkers[0] : null,
    bestWorkerEvidence:
      eligibleWorkers.length >= 2
        ? `compared at least two workers with minimum ${BEST_WORKER_MIN_RUNS} observed runs each`
        : `insufficient evidence; need at least two workers with minimum ${BEST_WORKER_MIN_RUNS} observed runs each`,
    skillAndToolEffects: [...effects.values()],
    skillsUsed: [...usedSkills],
    skillPerformance: [...skillPerformance.entries()]
      .map(([skill, row]) => ({
        skill,
        runs: row.runs,
        successes: row.successes,
        failures: row.failures,
        successRate: row.runs === 0 ? 0 : row.successes / row.runs,
        effect:
          row.runs < 3
            ? 'insufficient_evidence'
            : row.successes / row.runs >= 0.8
              ? 'helped'
              : row.successes / row.runs < 0.5
                ? 'hurt'
                : 'mixed',
        evidenceBasis:
          'observed run outcomes; causal policy or skill promotion requires repeated validated evidence',
      }))
      .sort((left, right) => left.skill.localeCompare(right.skill)),
    repeatedFailures: [...failures.values()].filter((row) => row.occurrences >= 2),
    humanInterventions,
    infrastructureWasteMs: observedInfrastructureRuns ? infrastructureWasteMs : null,
    reuse: [...reusedAssets],
    recurrence: [...failures.values()],
    latestChange: latestComparableChange(ordered),
  };
}

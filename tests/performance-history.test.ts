import { describe, expect, it } from 'vitest';
import { openDb } from '../src/db/client.js';
import {
  agentProviders,
  independentReviewReceipts,
  runPerformanceObservations,
} from '../src/db/schema.js';
import { addProject } from '../src/config/project-service.js';
import { projectConfigSchema } from '../src/config/project-config.js';
import { addTask } from '../src/domain/task-service.js';
import { createRun, setRunStatus } from '../src/domain/run-service.js';
import { newId } from '../src/domain/ids.js';
import { ensureObservedModel } from './helpers.js';
import {
  listPerformanceObservations,
  performanceHistoryReport,
  recordIndependentReviewExecution,
  recordPerformanceObservation,
} from '../src/insights/performance-history.js';

function receipt(
  recordedAt: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    schema: 'major.run-insight.v1',
    recordedAt,
    goalId: 'goal-1',
    outcome: 'completed',
    worker: { coordinator: 'codex', provider: 'codex', model: 'gpt-5' },
    timing: {
      durationMs: 100,
      productiveWorkMs: 60,
      productiveWorkRatio: 0.6,
      majorOverheadMs: 20,
      infrastructureOverheadMs: 20,
    },
    effects: [{ subject: 'resolver', effect: 'helped', evidence: 'focused test passed' }],
    skills: ['software-engineering'],
    failures: [],
    recurrence: { signature: null, priorOccurrences: null, evidence: null },
    humanInterventions: [],
    reuseStrategy: { strategy: 'reuse', reusableAssets: ['accepted-resolver'] },
    latestChange: { basis: 'none', result: 'no_prior_run' },
    ...overrides,
  };
}

describe('durable performance history', () => {
  it('keeps generic history observational and mints authority only from review execution', () => {
    const { db, sqlite } = openDb(':memory:');
    const project = addProject(
      db,
      projectConfigSchema.parse({ name: 'project-baracks', repoPath: '/tmp/project-baracks' }),
    );
    const task = addTask(db, { projectId: project.id, title: 'independent review authority' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'codex' }).run();
    const modelId = ensureObservedModel(db, providerId, 'review-model');
    const reviewed = createRun(db, {
      taskId: task.id,
      providerId,
      modelId,
      modelRef: 'review-model',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'test reviewed execution',
      sourceHead: 'a'.repeat(40),
    });
    setRunStatus(db, reviewed.id, 'succeeded');
    const run = createRun(db, {
      taskId: task.id,
      providerId,
      modelId,
      modelRef: 'review-model',
      purpose: 'review',
      billingMode: 'subscription_included',
      routingReason: 'test independent review',
      sourceHead: 'a'.repeat(40),
    });
    setRunStatus(db, run.id, 'succeeded');
    const review = {
      runEvidence: { runId: 'provider-run', sourceHead: 'a'.repeat(40) },
      independentReview: {
        purpose: 'independent_completion_review',
        goalId: 'goal-1',
        sourceHead: 'a'.repeat(40),
        verdict: 'pass',
        evidence: 'provider-produced exact-head verdict',
      },
    } as const;
    recordPerformanceObservation(db, {
      project: 'github.com/chukadele/project-baracks',
      source: 'dsh',
      receipt: receipt('2026-08-27T00:00:00.000Z', review),
    });
    recordPerformanceObservation(db, {
      project: 'github.com/chukadele/project-baracks',
      source: 'major',
      receipt: receipt('2026-08-27T01:00:00.000Z', { ...review, outcome: 'failed' }),
    });
    expect(db.select().from(independentReviewReceipts).all()).toEqual([]);
    expect(() =>
      recordIndependentReviewExecution(db, {
        project: 'github.com/chukadele/project-baracks',
        goalId: 'goal-1',
        runId: 'stale-provider-run',
        reviewedRunId: reviewed.id,
        taskId: task.id,
        dispatchId: 'stale-dispatch',
        provider: 'codex',
        providerId,
        providerAccountLabel: 'default',
        sourceHead: 'a'.repeat(40),
        sourceTreeDigest: 'b'.repeat(64),
        pendingClaimedAt: '2026-08-27T02:00:00.000Z',
        reviewStartedAt: '2026-08-27T01:59:59.000Z',
        executionStatus: 'succeeded',
        review: review.independentReview,
      }),
    ).toThrow(/predates the pending completion claim/);
    expect(() =>
      recordIndependentReviewExecution(db, {
        project: 'github.com/chukadele/project-baracks',
        goalId: 'goal-1',
        runId: run.id,
        reviewedRunId: reviewed.id,
        taskId: task.id,
        dispatchId: 'wrong-account-dispatch',
        provider: 'codex',
        providerId,
        providerAccountLabel: 'another-account',
        sourceHead: 'a'.repeat(40),
        sourceTreeDigest: 'b'.repeat(64),
        pendingClaimedAt: '2026-08-27T01:30:00.000Z',
        reviewStartedAt: '2026-08-27T02:00:00.000Z',
        executionStatus: 'succeeded',
        review: review.independentReview,
      }),
    ).toThrow(/canonical succeeded task run.*routed provider account/i);
    recordIndependentReviewExecution(db, {
      project: 'github.com/chukadele/project-baracks',
      goalId: 'goal-1',
      runId: run.id,
      reviewedRunId: reviewed.id,
      taskId: task.id,
      dispatchId: 'review-dispatch',
      provider: 'codex',
      providerId,
      providerAccountLabel: 'default',
      sourceHead: 'a'.repeat(40),
      sourceTreeDigest: 'b'.repeat(64),
      pendingClaimedAt: '2026-08-27T01:30:00.000Z',
      reviewStartedAt: '2026-08-27T02:00:00.000Z',
      executionStatus: 'succeeded',
      review: review.independentReview,
    });
    recordPerformanceObservation(db, {
      project: 'github.com/chukadele/project-baracks',
      source: 'major',
      receipt: receipt('2026-08-27T02:00:00.000Z', review),
    });
    expect(db.select().from(independentReviewReceipts).all()).toHaveLength(1);
    const authority = db.select().from(independentReviewReceipts).get()!;
    expect(authority).toMatchObject({
      project: 'github.com/chukadele/project-baracks',
      goalId: 'goal-1',
      runId: run.id,
      provider: 'codex',
      sourceHead: 'a'.repeat(40),
      purpose: 'independent_completion_review',
      verdict: 'pass',
    });
    expect(() =>
      sqlite.prepare('DELETE FROM independent_review_receipts WHERE id = ?').run(authority.id),
    ).toThrow(/append-only/);
    sqlite.close();
  });

  it('rejects malformed receipt fields at the durable boundary', () => {
    const { db, sqlite } = openDb(':memory:');
    expect(() =>
      recordPerformanceObservation(db, {
        project: 'github.com/chukadele/project-baracks',
        source: 'dsh',
        receipt: receipt('2026-08-27T01:00:00.000Z', { skills: 'not-an-array' }),
      }),
    ).toThrow(/skills/);
    expect(listPerformanceObservations(db, 'github.com/chukadele/project-baracks')).toEqual([]);
    sqlite.close();
  });

  it('persists redacted append-only observations and queries across runs', () => {
    const { db, sqlite } = openDb(':memory:');
    recordPerformanceObservation(db, {
      project: 'github.com/chukadele/project-baracks',
      source: 'dsh',
      receipt: receipt('2026-08-27T01:00:00.000Z', {
        finalOutcome: 'token=sk-secret-value-123456',
      }),
    });
    recordPerformanceObservation(db, {
      project: 'github.com/chukadele/project-baracks',
      source: 'major',
      receipt: receipt('2026-08-27T02:00:00.000Z'),
    });

    const rows = listPerformanceObservations(db, 'github.com/chukadele/project-baracks');
    expect(rows).toHaveLength(2);
    expect(rows[1]?.finalOutcome).toContain('[REDACTED]');
    const id = db
      .select({ id: runPerformanceObservations.id })
      .from(runPerformanceObservations)
      .get()!.id;
    expect(() =>
      sqlite.prepare('DELETE FROM run_performance_observations WHERE id = ?').run(id),
    ).toThrow(/append-only/);
    sqlite.close();
  });

  it('withholds best-worker and helped/hurt claims without sufficient evidence', () => {
    const report = performanceHistoryReport([
      receipt('2026-08-27T01:00:00.000Z'),
      receipt('2026-08-27T02:00:00.000Z', {
        effects: [{ subject: 'guess', effect: 'hurt' }],
      }),
    ] as never[]);
    expect(report.bestWorker).toBeNull();
    expect(report.bestWorkerEvidence).toContain('insufficient evidence');
    expect(report.skillAndToolEffects).toEqual([
      expect.objectContaining({ subject: 'resolver', effect: 'helped', occurrences: 1 }),
    ]);
  });

  it('reports time, supported worker performance, recurrence, interventions, waste and reuse', () => {
    const codex = [0, 1, 2].map((index) =>
      receipt(`2026-08-27T0${index + 1}:00:00.000Z`, {
        outcome: 'failed',
        humanInterventions: index === 2 ? ['owner supplied missing acceptance evidence'] : [],
        recurrence: {
          signature: 'provider_timeout',
          priorOccurrences: index,
          evidence: `timeout observed in run ${index + 1}`,
        },
        latestChange:
          index === 2
            ? {
                basis: 'latest_observed_run',
                result: 'observed_change_only',
                changes: { durationMs: { previous: 120, current: 100, delta: -20 } },
              }
            : { basis: 'none', result: 'no_prior_run' },
      }),
    );
    const claude = [0, 1, 2].map((index) =>
      receipt(`2026-08-26T0${index + 1}:00:00.000Z`, {
        worker: { coordinator: 'claude', provider: 'claude', model: 'sonnet' },
        timing: { durationMs: 150, productiveWorkMs: 60, productiveWorkRatio: 0.4 },
        outcome: index === 0 ? 'failed' : 'completed',
        recurrence: { signature: null, priorOccurrences: null, evidence: null },
      }),
    );
    const observations = [...codex, ...claude];
    const report = performanceHistoryReport(observations as never[]);
    expect(report.timeSpent).toMatchObject({ totalDurationMs: 750, observedRuns: 6 });
    expect(report.bestWorker).toMatchObject({
      worker: 'claude/claude/sonnet',
      runs: 3,
      successRate: 2 / 3,
    });
    expect(report.repeatedFailures).toEqual([
      expect.objectContaining({ signature: 'provider_timeout', occurrences: 3 }),
    ]);
    expect(report.humanInterventions).toEqual(['owner supplied missing acceptance evidence']);
    expect(report.infrastructureWasteMs).toBe(60);
    expect(report.reuse).toEqual(['accepted-resolver']);
    expect(report.skillsUsed).toEqual(['software-engineering']);
    expect(report.latestChange).toMatchObject({
      basis: 'latest_durable_comparable_run',
      result: 'insufficient_comparable_quality_evidence',
    });
  });

  it('does not call a stale success signature a repeated failure', () => {
    const observations = [0, 1].map((index) =>
      receipt(`2026-08-27T0${index + 1}:00:00.000Z`, {
        recurrence: {
          signature: 'stale_signature',
          priorOccurrences: index,
          evidence: 'legacy receipt data',
        },
      }),
    );
    expect(performanceHistoryReport(observations as never[]).recurrence).toEqual([]);
  });

  it('supports improvement only when consecutive durable runs have quality evidence', () => {
    const report = performanceHistoryReport([
      receipt('2026-08-27T01:00:00.000Z', {
        quality: { assessment: 'failed', evidence: ['focused test failed'] },
      }),
      receipt('2026-08-27T02:00:00.000Z', {
        quality: { assessment: 'passed', evidence: ['focused test passed'] },
      }),
    ] as never[]);

    expect(report.latestChange).toMatchObject({
      basis: 'latest_durable_comparable_run',
      result: 'improvement_supported_by_comparable_quality_evidence',
    });
  });
});

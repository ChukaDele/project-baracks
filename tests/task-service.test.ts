import { describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import {
  agentProviders,
  agentRunEvents,
  agentRuns,
  reviewFindings,
  roadmapItems,
  tasks,
} from '../src/db/schema.js';
import {
  evaluateCompletionProof,
  parseCompletionCriteria,
  REVIEW_SEVERITY_STORAGE,
  reviewSeverityFromStorage,
} from '../src/domain/completion.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import {
  appendRunEvent,
  createRun,
  listRunEvents,
  recordUsage,
  recordVerificationRun,
  RunAuthorisationError,
  setRunStatus,
} from '../src/domain/run-service.js';
import {
  addDependency,
  addEvidence,
  addSuggestion,
  addTask,
  approveSuggestion,
  getSuggestion,
  getTask,
  queueableTasks,
  rejectSuggestion,
  scopeFingerprint,
  SuggestionApprovalUnavailableError,
  transitionTask,
} from '../src/domain/task-service.js';
import { coordinatorDonePromotionProof } from '../src/supervisor/runtime.js';
import {
  assessSupervisorAdmissionRisk,
  deriveSupervisorPromotionContract,
} from '../src/supervisor/worker-report.js';
import {
  completeTaskProperly,
  ensureObservedModel,
  recordQualifyingVerification,
  seedProject,
  testDb,
} from './helpers.js';

function readyTask(db: ReturnType<typeof testDb>, projectId: string, title: string) {
  const task = addTask(db, { projectId, title });
  transitionTask(db, task.id, 'ready');
  return task;
}

describe('suggestions', () => {
  it('keeps suggestions out of the tasks table, and approval is disabled in this build', () => {
    const db = testDb();
    const project = seedProject(db);
    const created = addSuggestion(db, { projectId: project.id, title: 'Add caching' });
    expect(created.outcome).toBe('created');
    expect(db.select().from(tasks).all()).toHaveLength(0);

    // Approval remains a separate owner gate: it must refuse at the
    // canonical mutation boundary WITHOUT materialising a task or mutating the
    // suggestion. Read-only inspection of the suggestion remains available.
    expect(() => approveSuggestion(db, created.suggestion.id, 'good idea')).toThrow(
      SuggestionApprovalUnavailableError,
    );
    expect(db.select().from(tasks).all()).toHaveLength(0);
    expect(getSuggestion(db, created.suggestion.id).status).toBe('pending');
    expect(getSuggestion(db, created.suggestion.id).approvedTaskId).toBeNull();
  });

  it('rejects suggestions without creating a task, and blocks double rejection', () => {
    const db = testDb();
    const project = seedProject(db);
    const { suggestion } = addSuggestion(db, { projectId: project.id, title: 'Rewrite in Rust' });
    const rejected = rejectSuggestion(db, suggestion.id, 'no');
    expect(rejected.status).toBe('rejected');
    expect(db.select().from(tasks).all()).toHaveLength(0);
    // Approval refuses unconditionally (before any status check), and a second
    // rejection is still blocked by the decided-status guard.
    expect(() => approveSuggestion(db, suggestion.id)).toThrow(SuggestionApprovalUnavailableError);
    expect(() => rejectSuggestion(db, suggestion.id)).toThrow(/already rejected/);
  });

  it('fingerprints scope so re-worded duplicates collide', () => {
    expect(scopeFingerprint('Add caching!', 'for the  API')).toBe(
      scopeFingerprint('add   CACHING', 'for the api'),
    );
    expect(scopeFingerprint('Add caching')).not.toBe(scopeFingerprint('Remove caching'));
  });

  it('folds duplicates of a pending suggestion into the existing one', () => {
    const db = testDb();
    const project = seedProject(db);
    const first = addSuggestion(db, { projectId: project.id, title: 'Add caching' });
    const second = addSuggestion(db, { projectId: project.id, title: 'add caching' });
    expect(second.outcome).toBe('duplicate');
    expect(second.suggestion.id).toBe(first.suggestion.id);
  });

  it('suppresses recreation of a rejected scope unless explicitly superseded', () => {
    const db = testDb();
    const project = seedProject(db);
    const first = addSuggestion(db, { projectId: project.id, title: 'Rewrite in Rust' });
    rejectSuggestion(db, first.suggestion.id, 'no');

    const again = addSuggestion(db, { projectId: project.id, title: 'rewrite in rust' });
    expect(again.outcome).toBe('suppressed');
    expect(again.suggestion.id).toBe(first.suggestion.id);

    const superseding = addSuggestion(db, {
      projectId: project.id,
      title: 'Rewrite in Rust',
      supersedes: first.suggestion.id,
    });
    expect(superseding.outcome).toBe('created');
    const updatedOld = db.select().from(tasks).all(); // keep tasks untouched
    expect(updatedOld).toHaveLength(0);
    // after supersession the scope is live again
    const dupOfNew = addSuggestion(db, { projectId: project.id, title: 'Rewrite in Rust' });
    expect(dupOfNew.outcome).toBe('duplicate');
    expect(dupOfNew.suggestion.id).toBe(superseding.suggestion.id);
  });

  it('records structured provenance and requires a source ref for derived sources', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'origin task' });
    const derived = addSuggestion(db, {
      projectId: project.id,
      title: 'Fix flaky test found during origin task',
      sourceType: 'task',
      sourceRef: task.id,
      suggestedBy: 'agent',
    });
    expect(derived.outcome).toBe('created');
    expect(derived.suggestion.sourceType).toBe('task');
    expect(derived.suggestion.sourceRef).toBe(task.id);

    expect(() =>
      addSuggestion(db, {
        projectId: project.id,
        title: 'Ghost suggestion with no source',
        sourceType: 'review_finding',
      }),
    ).toThrow(); // DB CHECK: derived sources must carry a source ref
  });
});

describe('dependency blocking', () => {
  it('blocks queueing until dependencies complete', () => {
    const db = testDb();
    const project = seedProject(db);
    const blocker = readyTask(db, project.id, 'schema first');
    const dependent = readyTask(db, project.id, 'api second');
    addDependency(db, dependent.id, blocker.id);

    expect(() => transitionTask(db, dependent.id, 'queued')).toThrow(/blocked by 1/);
    expect(queueableTasks(db).map((t) => t.id)).toEqual([blocker.id]);

    completeTaskProperly(db, blocker.id);
    expect(transitionTask(db, dependent.id, 'queued').status).toBe('queued');
  });

  it('refuses self-dependencies', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'solo' });
    expect(() => addDependency(db, task.id, task.id)).toThrow(/cannot depend on itself/);
  });
});

describe('completion proof and guarded completion transition', () => {
  it('classifies no-task admission from typed outcome and policy facts and fails closed', () => {
    const workshopPolicy = {
      projectClass: 'workshop' as const,
      trust: 'build' as const,
      allowExternalWrites: false,
      allowPaidSpend: false,
    };
    const bounded = assessSupervisorAdmissionRisk({
      outcome: 'Fix typo',
      policy: workshopPolicy,
    });
    expect(bounded.classification).toBe('bounded');
    expect(
      deriveSupervisorPromotionContract({
        admissionRiskAssessment: bounded,
        autonomous: false,
      }).review,
    ).toBe('none');

    const substantive = assessSupervisorAdmissionRisk({
      outcome: 'Build the smallest credible end-to-end onboarding workflow',
      policy: workshopPolicy,
    });
    expect(substantive.classification).toBe('substantive');
    expect(
      deriveSupervisorPromotionContract({
        admissionRiskAssessment: substantive,
        autonomous: false,
      }).review,
    ).toBe('focused');

    const consequential = assessSupervisorAdmissionRisk({
      outcome: 'Repair completion authority policy',
      policy: workshopPolicy,
    });
    expect(consequential).toMatchObject({
      classification: 'high_consequence',
      materialRiskCriteria: ['authority'],
    });
    expect(
      deriveSupervisorPromotionContract({
        admissionRiskAssessment: consequential,
        autonomous: false,
      }).review,
    ).toBe('independent');

    const accessControl = assessSupervisorAdmissionRisk({
      outcome: 'Fix session access control for signed-in users',
      policy: workshopPolicy,
    });
    expect(accessControl).toMatchObject({
      classification: 'high_consequence',
      materialRiskCriteria: ['security'],
    });

    const unavailable = assessSupervisorAdmissionRisk({ outcome: 'Ship it' });
    expect(unavailable.classification).toBe('unavailable');
    expect(
      deriveSupervisorPromotionContract({
        admissionRiskAssessment: unavailable,
        autonomous: false,
      }),
    ).toMatchObject({ review: 'independent', broaderValidationTriggers: ['blast_radius'] });
  });
  it('requires focused task implementation and review runs to use the frozen candidate head', () => {
    const db = testDb();
    const project = seedProject(db);
    const candidateHead = 'a'.repeat(40);
    const task = addTask(db, {
      projectId: project.id,
      title: 'focused exact-head task',
      completionCriteriaJson: JSON.stringify({
        progressiveValidation: { review: 'focused', candidateHead },
      }),
    });
    transitionTask(db, task.id, 'ready');
    transitionTask(db, task.id, 'queued');
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'focused-provider' }).run();
    ensureObservedModel(db, providerId, 'focused-model');
    const base = {
      taskId: task.id,
      providerId,
      modelRef: 'focused-model',
      billingMode: 'subscription_included' as const,
      routingReason: 'focused exact-head proof',
    };
    expect(() => createRun(db, { ...base, purpose: 'implementation' })).toThrow(
      /requires frozen candidate head/,
    );
    expect(() => createRun(db, { ...base, purpose: 'verification' })).toThrow(
      /requires frozen candidate head/,
    );
    expect(() => createRun(db, { ...base, purpose: 'review', sourceHead: 'b'.repeat(40) })).toThrow(
      /requires frozen candidate head/,
    );
    const implementation = createRun(db, {
      ...base,
      purpose: 'implementation',
      sourceHead: candidateHead,
    });
    expect(implementation).toMatchObject({ sourceHead: candidateHead });
    expect(() =>
      db
        .update(agentRuns)
        .set({ sourceHead: 'b'.repeat(40) })
        .where(eq(agentRuns.id, implementation.id))
        .run(),
    ).toThrow(/source head is immutable/);
    expect(() =>
      db
        .insert(agentRuns)
        .values({
          id: newId('arun'),
          taskId: task.id,
          providerId,
          modelRef: 'focused-model',
          purpose: 'review',
          billingMode: 'subscription_included',
          routingReason: 'direct SQL bypass',
          status: 'pending',
        })
        .run(),
    ).toThrow(/frozen candidate head/);
    expect(() =>
      db
        .insert(agentRuns)
        .values({
          id: newId('arun'),
          taskId: task.id,
          providerId,
          modelRef: 'focused-model',
          purpose: 'verification',
          billingMode: 'subscription_included',
          routingReason: 'direct SQL verification bypass',
          status: 'pending',
        })
        .run(),
    ).toThrow(/frozen candidate head/);
  });

  it('fails closed when task omission would hide an ambiguous canonical workflow', () => {
    const db = testDb();
    const project = seedProject(db);
    for (const title of ['candidate one', 'candidate two']) {
      const task = readyTask(db, project.id, title);
      for (const status of [
        'queued',
        'running',
        'verifying',
        'reviewing',
        'ready_to_merge',
      ] as const) {
        transitionTask(db, task.id, status);
      }
    }
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '~/Projects/demo' },
        {
          status: 'done',
          summary: 'attempted no-task fallback',
          promotionEvidence: {
            focusedTests: 'passed',
            cheapestCompileTypeOrBuild: 'passed',
            criticalPathBehavior: 'passed',
            materialRiskChecks: [],
            broaderValidation: {
              triggers: [],
              repositoryPolicyRequires: false,
              performed: false,
            },
            review: { level: 'focused', passed: true },
            blockerFindings: 0,
          },
        },
      ),
    ).toMatchObject({ ok: false, failures: [expect.stringMatching(/2 ready_to_merge task/)] });
  });

  it('accepts structured supervisor promotion evidence without requiring a task row', () => {
    const db = testDb();
    const admissionRiskAssessment = assessSupervisorAdmissionRisk({
      outcome: 'Build the onboarding workflow',
      policy: {
        projectClass: 'workshop',
        trust: 'build',
        allowExternalWrites: false,
        allowPaidSpend: false,
      },
    });
    const promotionContract = deriveSupervisorPromotionContract({
      admissionRiskAssessment,
      autonomous: false,
    });
    const promotionEvidence = {
      focusedTests: 'focused changed-behavior tests passed',
      cheapestCompileTypeOrBuild: 'typecheck passed',
      criticalPathBehavior: 'completion lifecycle passed',
      materialRiskChecks: [
        {
          criterion: 'summary-only completion rejection',
          evidence: 'focused regression passed',
        },
      ],
      broaderValidation: {
        triggers: [],
        repositoryPolicyRequires: false,
        performed: false,
      },
      review: { level: 'focused' as const, passed: true },
      blockerFindings: 0,
    };
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '/unregistered/supervisor-repository', promotionContract },
        { status: 'done', summary: 'structured claim', promotionEvidence },
      ),
    ).toMatchObject({ ok: true, taskId: undefined, promotionEvidence });
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '/unregistered/supervisor-repository', promotionContract },
        { status: 'done', summary: 'summary only' },
      ),
    ).toMatchObject({
      ok: false,
      failures: ['done completion requires structured pre-promotion evidence'],
    });
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '/unregistered/supervisor-repository', promotionContract },
        {
          status: 'done',
          summary: 'broad proof missing economics',
          promotionEvidence: {
            ...promotionEvidence,
            broaderValidation: {
              triggers: ['promotion_policy'],
              repositoryPolicyRequires: false,
              performed: true,
            },
          },
        },
      ),
    ).toMatchObject({ ok: false, failures: ['required pre-promotion evidence is missing'] });
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '/unregistered/supervisor-repository', promotionContract },
        {
          status: 'done',
          summary: 'blocked proof',
          promotionEvidence: { ...promotionEvidence, blockerFindings: 1 },
        },
      ),
    ).toMatchObject({ ok: false, failures: ['BLOCKER findings remain'] });
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '/unregistered/supervisor-repository', promotionContract },
        {
          status: 'done',
          summary: 'untriggered broad proof',
          promotionEvidence: {
            ...promotionEvidence,
            broaderValidation: {
              triggers: [],
              repositoryPolicyRequires: false,
              performed: true,
              cost: 'one minute',
              expectedInformationGain: 'none expected',
              evidence: 'broad suite passed',
            },
          },
        },
      ),
    ).toMatchObject({ ok: false, failures: ['required pre-promotion evidence is missing'] });
  });

  it('derives no-task risk/review requirements before the report and matches structured evidence', () => {
    const db = testDb();
    const admissionRiskAssessment = assessSupervisorAdmissionRisk({
      outcome: 'Repair completion authority policy',
      requiredOperations: ['completion_policy'],
      policy: {
        projectClass: 'workshop',
        trust: 'build',
        allowExternalWrites: false,
        allowPaidSpend: false,
      },
    });
    const promotionContract = deriveSupervisorPromotionContract({
      admissionRiskAssessment,
      autonomous: false,
    });
    expect(promotionContract).toMatchObject({
      review: 'independent',
      materialRiskCriteria: ['authority'],
    });
    const report = {
      status: 'done' as const,
      summary: 'classifier-bound proof',
      promotionEvidence: {
        focusedTests: 'passed',
        cheapestCompileTypeOrBuild: 'passed',
        criticalPathBehavior: 'passed',
        materialRiskChecks: [{ criterion: 'authority', evidence: 'authority regression passed' }],
        broaderValidation: {
          triggers: [],
          repositoryPolicyRequires: false,
          performed: false,
        },
        review: { level: 'independent' as const, passed: true },
        blockerFindings: 0,
      },
    };
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '/unregistered/supervisor-repository', promotionContract },
        report,
      ),
    ).toMatchObject({ ok: true });
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '/unregistered/supervisor-repository', promotionContract },
        {
          ...report,
          promotionEvidence: {
            ...report.promotionEvidence,
            materialRiskChecks: [
              { criterion: 'authority-adjacent', evidence: 'free text prefix must not qualify' },
            ],
          },
        },
      ),
    ).toMatchObject({ ok: false, failures: ['required pre-promotion evidence is missing'] });
  });

  function taskAtReadyToMerge(db: ReturnType<typeof testDb>) {
    const project = seedProject(db);
    const task = readyTask(db, project.id, 'ship it');
    for (const status of [
      'queued',
      'running',
      'verifying',
      'reviewing',
      'ready_to_merge',
    ] as const) {
      transitionTask(db, task.id, status);
    }
    return task;
  }

  const defaultCriteria = () => parseCompletionCriteria(null);

  it('the proof set refuses a bare free-text evidence assertion', () => {
    const db = testDb();
    const task = taskAtReadyToMerge(db);
    addEvidence(db, { taskId: task.id, kind: 'other', summary: 'trust me, it works' });
    const proof = evaluateCompletionProof(db, task.id, defaultCriteria());
    expect(proof.ok).toBe(false);
    expect(proof.failures.join('; ')).toMatch(/passed verification run/);
  });

  it('refuses fabricated verification evidence pointing at nothing', () => {
    const db = testDb();
    const task = taskAtReadyToMerge(db);
    expect(() =>
      addEvidence(db, {
        taskId: task.id,
        kind: 'verification_run',
        ref: 'vrun_does_not_exist',
        summary: 'made up',
      }),
    ).toThrow(/must reference a verification run/);
  });

  it('refuses evidence citing a verification run of a DIFFERENT task', () => {
    const db = testDb();
    const project = seedProject(db, 'other');
    const otherTask = addTask(db, { projectId: project.id, title: 'other work' });
    const otherVrun = recordVerificationRun(db, {
      taskId: otherTask.id,
      command: 'pnpm test',
      status: 'passed',
      exitCode: 0,
    });
    const task = taskAtReadyToMerge(db);
    expect(() =>
      addEvidence(db, {
        taskId: task.id,
        kind: 'verification_run',
        ref: otherVrun.id,
        summary: 'borrowed proof',
      }),
    ).toThrow(/same task/);
  });

  it('is satisfied only by a QUALIFYING passed verification run with linked evidence', () => {
    const db = testDb();
    const task = taskAtReadyToMerge(db);
    const failed = recordVerificationRun(db, {
      taskId: task.id,
      command: 'pnpm test',
      status: 'failed',
      exitCode: 1,
    });
    addEvidence(db, {
      taskId: task.id,
      kind: 'verification_run',
      ref: failed.id,
      summary: 'first attempt failed',
    });
    expect(evaluateCompletionProof(db, task.id, defaultCriteria()).ok).toBe(false);

    // A 'passed' record WITHOUT provenance (no agent run behind it) does not
    // qualify: the proof requires a trustworthy run/task relationship.
    const unprovenanced = recordVerificationRun(db, {
      taskId: task.id,
      command: 'pnpm test',
      status: 'passed',
      exitCode: 0,
    });
    addEvidence(db, {
      taskId: task.id,
      kind: 'verification_run',
      ref: unprovenanced.id,
      summary: 'passed but from nowhere',
    });
    expect(evaluateCompletionProof(db, task.id, defaultCriteria()).ok).toBe(false);

    recordQualifyingVerification(db, task.id);
    expect(evaluateCompletionProof(db, task.id, defaultCriteria()).ok).toBe(true);
  });

  it('blocks on open critical/major review findings', () => {
    const db = testDb();
    const task = taskAtReadyToMerge(db);
    recordQualifyingVerification(db, task.id);

    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'mock-reviewer' }).run();
    ensureObservedModel(db, providerId, 'codex');
    const run = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'codex',
      purpose: 'review',
      billingMode: 'subscription_included',
      routingReason: 'review',
    });
    db.insert(reviewFindings)
      .values({
        id: newId('rfind'),
        taskId: task.id,
        agentRunId: run.id,
        severity: 'critical',
        summary: 'auth bypass',
      })
      .run();
    const blocked = evaluateCompletionProof(db, task.id, defaultCriteria());
    expect(blocked.ok).toBe(false);
    expect(blocked.failures.join('; ')).toMatch(/open BLOCKER/);

    db.update(reviewFindings).set({ status: 'fixed' }).run();
    expect(evaluateCompletionProof(db, task.id, defaultCriteria()).ok).toBe(true);
  });

  it('maps canonical review severities onto storage without losing the legacy blocker alias', () => {
    expect(REVIEW_SEVERITY_STORAGE).toEqual({
      BLOCKER: 'critical',
      IMPORTANT: 'minor',
      NIT: 'info',
    });
    expect(reviewSeverityFromStorage('critical')).toBe('BLOCKER');
    expect(reviewSeverityFromStorage('major')).toBe('BLOCKER');
    expect(reviewSeverityFromStorage('minor')).toBe('IMPORTANT');
    expect(reviewSeverityFromStorage('info')).toBe('NIT');
  });

  it('connects progressive proof and PROMOTABLE semantics to durable completion', () => {
    const db = testDb();
    const candidateHead = 'a'.repeat(40);
    const project = seedProject(db);
    const task = addTask(db, {
      projectId: project.id,
      title: 'progressively validated candidate',
      completionCriteriaJson: JSON.stringify({
        progressiveValidation: {
          review: 'independent',
          candidateHead,
          riskSpecificChecks: ['authority boundary', 'legacy compatibility'],
        },
      }),
    });
    transitionTask(db, task.id, 'ready');
    for (const status of [
      'queued',
      'running',
      'verifying',
      'reviewing',
      'ready_to_merge',
    ] as const) {
      transitionTask(db, task.id, status);
    }
    for (const validationSubject of [
      'focused_tests',
      'cheapest_compile_type_or_build',
      'critical_path_behavior',
    ]) {
      recordQualifyingVerification(db, task.id, { validationSubject, sourceHead: candidateHead });
    }
    recordQualifyingVerification(db, task.id, {
      validationSubject: 'risk_specific_check:authority boundary',
      sourceHead: candidateHead,
    });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'builder' }).run();
    ensureObservedModel(db, providerId, 'codex');
    const implementationRun = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'codex',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'implementation',
      sourceHead: candidateHead,
    });
    setRunStatus(db, implementationRun.id, 'succeeded');
    const reviewRun = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'codex',
      purpose: 'review',
      billingMode: 'subscription_included',
      routingReason: 'focused review',
      independenceLoss: 'review reused the implementer execution context',
      sourceHead: candidateHead,
    });
    setRunStatus(db, reviewRun.id, 'succeeded');
    const criteria = parseCompletionCriteria(getTask(db, task.id).completionCriteriaSnapshotJson);
    expect(evaluateCompletionProof(db, task.id, criteria).failures).toContain(
      'missing risk-specific verification: legacy compatibility',
    );
    recordQualifyingVerification(db, task.id, {
      validationSubject: 'risk_specific_check:legacy compatibility',
      sourceHead: candidateHead,
    });

    db.insert(reviewFindings)
      .values({
        id: newId('rfind'),
        taskId: task.id,
        agentRunId: reviewRun.id,
        severity: REVIEW_SEVERITY_STORAGE.IMPORTANT,
        summary: 'valuable follow-up that does not prevent a safe MVP',
      })
      .run();
    expect(evaluateCompletionProof(db, task.id, criteria).failures).toContain(
      'required review has not passed',
    );
    const sameProviderAliasId = newId('aprov');
    db.insert(agentProviders)
      .values({ id: sameProviderAliasId, name: 'builder', accountLabel: 'secondary' })
      .run();
    ensureObservedModel(db, sameProviderAliasId, 'codex');
    const sameProviderAliasReview = createRun(db, {
      taskId: task.id,
      providerId: sameProviderAliasId,
      modelRef: 'codex',
      purpose: 'review',
      billingMode: 'subscription_included',
      routingReason: 'same canonical provider through another account',
      independenceLoss: 'review reused the implementer execution context',
      sourceHead: candidateHead,
    });
    setRunStatus(db, sameProviderAliasReview.id, 'succeeded');
    expect(evaluateCompletionProof(db, task.id, criteria).failures).toContain(
      'required review has not passed',
    );

    expect(evaluateCompletionProof(db, task.id, criteria).failures).toContain(
      'required review has not passed',
    );
    const compromisedProviderId = newId('aprov');
    db.insert(agentProviders)
      .values({ id: compromisedProviderId, name: 'compromised-reviewer' })
      .run();
    ensureObservedModel(db, compromisedProviderId, 'codex');
    const compromisedReviewRun = createRun(db, {
      taskId: task.id,
      providerId: compromisedProviderId,
      modelRef: 'codex',
      purpose: 'review',
      billingMode: 'subscription_included',
      routingReason: 'compromised review',
      independenceLoss: 'review reused the implementer execution context',
      sourceHead: candidateHead,
    });
    setRunStatus(db, compromisedReviewRun.id, 'succeeded');
    expect(evaluateCompletionProof(db, task.id, criteria).failures).toContain(
      'required review has not passed',
    );
    const independentProviderId = newId('aprov');
    db.insert(agentProviders)
      .values({ id: independentProviderId, name: 'builder', accountLabel: 'review' })
      .run();
    ensureObservedModel(db, independentProviderId, 'codex');
    const independentReviewRun = createRun(db, {
      taskId: task.id,
      providerId: independentProviderId,
      modelRef: 'codex',
      purpose: 'review',
      billingMode: 'subscription_included',
      routingReason: 'execution-independent same-provider review',
      sourceHead: candidateHead,
    });
    setRunStatus(db, independentReviewRun.id, 'succeeded');
    expect(evaluateCompletionProof(db, task.id, criteria)).toMatchObject({
      ok: false,
      failures: ['required review has not passed'],
    });
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '~/Projects/demo' },
        { status: 'done', summary: 'canonical proof passed', taskId: task.id },
        { liveHead: candidateHead },
      ),
    ).toMatchObject({ ok: true, taskId: task.id });
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '~/Projects/demo' },
        { status: 'done', summary: 'stale canonical proof', taskId: task.id },
        { liveHead: 'b'.repeat(40) },
      ),
    ).toMatchObject({
      ok: false,
      failures: ['live repository head does not match the canonical task frozen candidate head'],
    });
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '~/Projects/demo' },
        { status: 'done', summary: 'claim' },
      ),
    ).toMatchObject({
      ok: false,
      failures: ['done completion must cite the disclosed canonical taskId'],
    });
    expect(
      coordinatorDonePromotionProof(
        db,
        { repoPath: '~/Projects/not-demo' },
        { status: 'done', summary: 'wrong repository', taskId: task.id },
      ),
    ).toMatchObject({ ok: false });

    db.insert(reviewFindings)
      .values({
        id: newId('rfind'),
        taskId: task.id,
        agentRunId: reviewRun.id,
        severity: REVIEW_SEVERITY_STORAGE.BLOCKER,
        summary: 'unsafe promotion boundary',
      })
      .run();
    const blocked = evaluateCompletionProof(db, task.id, criteria);
    expect(blocked.ok).toBe(false);
    expect(blocked.failures).toContain('BLOCKER findings remain');
  });

  it('records cost and expected information gain when broad validation is required', () => {
    expect(() =>
      parseCompletionCriteria(
        JSON.stringify({
          progressiveValidation: { broaderValidationTriggers: ['promotion_policy'] },
        }),
      ),
    ).toThrow(/cost and expected information gain/);
    expect(
      parseCompletionCriteria(
        JSON.stringify({
          progressiveValidation: {
            candidateHead: 'a'.repeat(40),
            broaderValidationTriggers: ['promotion_policy'],
            broadValidationJustification: {
              cost: 'about two deterministic test minutes',
              expectedInformationGain: 'detect migration and completion-trigger drift',
            },
          },
        }),
      ).progressiveValidation?.broadValidationJustification,
    ).toEqual({
      cost: 'about two deterministic test minutes',
      expectedInformationGain: 'detect migration and completion-trigger drift',
    });
  });

  it('rejects whitespace-only criteria exactly as the SQLite boundary does', () => {
    expect(() =>
      parseCompletionCriteria(JSON.stringify({ requiredDecisionCategories: ['   '] })),
    ).toThrow();
    expect(() =>
      parseCompletionCriteria(
        JSON.stringify({ progressiveValidation: { riskSpecificChecks: ['   '] } }),
      ),
    ).toThrow();
  });

  it('enforces task-specific criteria (artifact and required decisions)', () => {
    const db = testDb();
    const project = seedProject(db);
    const task = addTask(db, {
      projectId: project.id,
      title: 'merge-gated work',
      completionCriteriaJson: JSON.stringify({
        requireArtifact: true,
        requiredDecisionCategories: ['merge'],
      }),
    });
    transitionTask(db, task.id, 'ready');
    for (const status of [
      'queued',
      'running',
      'verifying',
      'reviewing',
      'ready_to_merge',
    ] as const) {
      transitionTask(db, task.id, status);
    }
    recordQualifyingVerification(db, task.id);
    const criteria = () => parseCompletionCriteria(getTask(db, task.id).completionCriteriaJson);
    expect(evaluateCompletionProof(db, task.id, criteria()).failures.join('; ')).toMatch(
      /artifact/,
    );

    addEvidence(db, {
      taskId: task.id,
      kind: 'artifact',
      ref: 'https://github.com/x/y/pull/1',
      summary: 'PR opened',
    });
    expect(evaluateCompletionProof(db, task.id, criteria()).failures.join('; ')).toMatch(
      /'merge' DecisionRequest/,
    );

    const otherProject = seedProject(db, 'other');
    const wrongProjectDecision = createDecisionRequest(db, {
      taskId: task.id,
      projectId: otherProject.id,
      category: 'merge',
      question: 'wrong project approval?',
    });
    resolveDecision(db, wrongProjectDecision.id, 'approved', 'not authoritative');
    expect(evaluateCompletionProof(db, task.id, criteria()).failures.join('; ')).toMatch(
      /'merge' DecisionRequest/,
    );

    const decision = createDecisionRequest(db, {
      taskId: task.id,
      projectId: project.id,
      category: 'merge',
      question: 'merge PR #1?',
    });
    resolveDecision(db, decision.id, 'approved', 'lgtm');
    expect(evaluateCompletionProof(db, task.id, criteria()).ok).toBe(true);
  });

  it('completes a fully proven task through the guarded service transition', () => {
    const db = testDb();
    const task = taskAtReadyToMerge(db);
    recordQualifyingVerification(db, task.id);
    expect(evaluateCompletionProof(db, task.id, defaultCriteria()).ok).toBe(true);
    expect(transitionTask(db, task.id, 'completed').status).toBe('completed');
    expect(getTask(db, task.id).status).toBe('completed');
  });
});

describe('task-to-roadmap relationships', () => {
  it('lets one roadmap item own many tasks', () => {
    const db = testDb();
    const project = seedProject(db);
    const item = { id: newId('ritem'), projectId: project.id, stableRef: 'RM-1', title: 'Auth' };
    db.insert(roadmapItems).values(item).run();

    const a = addTask(db, { projectId: project.id, roadmapItemId: item.id, title: 'login' });
    const b = addTask(db, { projectId: project.id, roadmapItemId: item.id, title: 'logout' });
    const linked = db.select().from(tasks).where(eq(tasks.roadmapItemId, item.id)).all();
    expect(linked.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
  });
});

describe('agent runs', () => {
  function seedRun(db: ReturnType<typeof testDb>) {
    const project = seedProject(db);
    const task = addTask(db, { projectId: project.id, title: 'work' });
    const providerId = newId('aprov');
    db.insert(agentProviders).values({ id: providerId, name: 'mock' }).run();
    ensureObservedModel(db, providerId);
    const run = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'sonnet',
      purpose: 'implementation',
      billingMode: 'subscription_included',
      routingReason: 'test route',
    });
    return { db, task, providerId, run };
  }

  it('supports many runs per task and records routing metadata', () => {
    const { db, task, providerId, run } = seedRun(testDb());
    ensureObservedModel(db, providerId, 'opus');
    const second = createRun(db, {
      taskId: task.id,
      providerId,
      modelRef: 'opus',
      purpose: 'review',
      billingMode: 'subscription_included',
      routingReason: 'escalated review',
      independenceLoss: 'same-provider review',
    });
    expect(run.taskId).toBe(task.id);
    expect(second.taskId).toBe(task.id);
    expect(second.independenceLoss).toMatch(/same-provider/);
    expect(setRunStatus(db, run.id, 'running').startedAt).toBeTruthy();
    expect(setRunStatus(db, run.id, 'succeeded').endedAt).toBeTruthy();
  });

  it('keeps run event history append-only with per-run sequence numbers', () => {
    const { db, run } = seedRun(testDb());
    appendRunEvent(db, run.id, 'started', { pid: 1 });
    appendRunEvent(db, run.id, 'message', { text: 'hello' });
    const events = listRunEvents(db, run.id);
    expect(events.map((e) => e.seq)).toEqual([1, 2]);

    // UPDATE and DELETE are blocked by DB triggers.
    expect(() => db.update(agentRunEvents).set({ type: 'tampered' }).run()).toThrow(/append-only/);
    expect(() => db.delete(agentRunEvents).run()).toThrow(/append-only/);
  });

  it('refuses a paid run without authoritative billing and exact approval', () => {
    const { db, task, providerId } = seedRun(testDb());
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        modelRef: 'opus',
        purpose: 'implementation',
        billingMode: 'api_billing',
        routingReason: 'unauthorised paid route',
      }),
    ).toThrow(RunAuthorisationError);
  });

  it('refuses an unknown-billing run at both the service and DB boundary', () => {
    const { db, task, providerId } = seedRun(testDb());
    expect(() =>
      createRun(db, {
        taskId: task.id,
        providerId,
        modelRef: 'mystery',
        purpose: 'implementation',
        billingMode: 'unknown',
        routingReason: 'unproven cost basis',
      }),
    ).toThrow(/billing mode is unknown/);
    expect(() =>
      db
        .insert(agentRuns)
        .values({
          id: newId('arun'),
          taskId: task.id,
          providerId,
          modelRef: 'mystery',
          purpose: 'implementation',
          billingMode: 'unknown',
          routingReason: 'forged direct insert',
        })
        .run(),
    ).toThrow(/authoritatively (known|observed).*billing/);
  });

  it('records usage observations', () => {
    const { db, providerId, run } = seedRun(testDb());
    const usage = recordUsage(db, {
      providerId,
      agentRunId: run.id,
      kind: 'tokens',
      data: { input: 100, output: 20 },
    });
    expect(JSON.parse(usage.dataJson)).toEqual({ input: 100, output: 20 });
  });
});

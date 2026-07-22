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
import { evaluateCompletionProof, parseCompletionCriteria } from '../src/domain/completion.js';
import { createDecisionRequest, resolveDecision } from '../src/domain/decision-service.js';
import { newId } from '../src/domain/ids.js';
import {
  appendRunEvent,
  createRun,
  listRunEvents,
  recordUsage,
  recordVerificationRun,
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
import { CapabilityUnavailableError } from '../src/security/capabilities.js';
import {
  completeTaskProperly,
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

    // Approval is unavailable in this disabled foundation: it must refuse at the
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

describe('completion proof (model preserved; the completed transition is disabled)', () => {
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
    expect(blocked.failures.join('; ')).toMatch(/open critical\/major/);

    db.update(reviewFindings).set({ status: 'fixed' }).run();
    expect(evaluateCompletionProof(db, task.id, defaultCriteria()).ok).toBe(true);
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

    const decision = createDecisionRequest(db, {
      taskId: task.id,
      projectId: project.id,
      category: 'merge',
      question: 'merge PR #1?',
    });
    resolveDecision(db, decision.id, 'approved', 'lgtm');
    expect(evaluateCompletionProof(db, task.id, criteria()).ok).toBe(true);
  });

  it('the completed transition itself is disabled: a fully proven task still refuses', () => {
    const db = testDb();
    const task = taskAtReadyToMerge(db);
    recordQualifyingVerification(db, task.id);
    expect(evaluateCompletionProof(db, task.id, defaultCriteria()).ok).toBe(true);
    expect(() => transitionTask(db, task.id, 'completed')).toThrow(CapabilityUnavailableError);
    expect(getTask(db, task.id).status).toBe('ready_to_merge');
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

  it('refuses every paid run: paid provider execution is unavailable in this build', () => {
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
    ).toThrow(CapabilityUnavailableError);
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
    ).toThrow(/authoritatively known billing mode/);
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

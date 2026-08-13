import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { and, eq } from 'drizzle-orm';
import { openDb, type Db } from '../src/db/client.js';
import { addProject } from '../src/config/project-service.js';
import { projectConfigSchema } from '../src/config/project-config.js';
import {
  agentModels,
  agentProviders,
  discoveryObservations,
  tasks,
  taskSuggestions,
  type BillingMode,
} from '../src/db/schema.js';
import { newId, nowIso } from '../src/domain/ids.js';
import { addEvidence, getSuggestion, transitionTask, getTask } from '../src/domain/task-service.js';
import { createRun, recordVerificationRun, setRunStatus } from '../src/domain/run-service.js';
import type { ModelState } from '../src/providers/types.js';

export function testDb(): Db {
  return openDb(':memory:').db;
}

/** Path for a file-backed test database (multi-connection scenarios). */
export function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'major-db-')), 'major.db');
}

function ensureProvider(db: Db, name = 'test-provider'): string {
  const existing = db.select().from(agentProviders).where(eq(agentProviders.name, name)).get();
  const id = existing?.id ?? newId('aprov');
  if (!existing) db.insert(agentProviders).values({ id, name }).run();
  ensureObservedModel(db, id, 'sonnet');
  return id;
}

/** Persist the minimum authoritative billing state required by run fixtures. */
export function ensureObservedModel(
  db: Db,
  providerId: string,
  modelRef = 'sonnet',
  billingMode: Exclude<BillingMode, 'unknown'> = 'subscription_included',
): string {
  let model = db
    .select()
    .from(agentModels)
    .where(and(eq(agentModels.providerId, providerId), eq(agentModels.modelRef, modelRef)))
    .get();
  if (!model) {
    const id = newId('amodel');
    db.insert(agentModels)
      .values({ id, providerId, modelRef, routingClass: 'sonnet', billingMode: 'unknown' })
      .run();
    model = db.select().from(agentModels).where(eq(agentModels.id, id)).get()!;
  }
  if (model.billingMode !== billingMode) {
    db.insert(discoveryObservations)
      .values({
        id: newId('dobs'),
        providerId,
        modelId: model.id,
        observedJson: JSON.stringify({ modelRef, billingMode, note: 'test fixture' }),
        source: 'human',
        confidence: 'configured',
      })
      .run();
    db.update(agentModels).set({ billingMode }).where(eq(agentModels.id, model.id)).run();
  }
  return model.id;
}

/**
 * Record a QUALIFYING verification run for the completion proof: passed with
 * exit code 0, completed timestamps, produced under a succeeded agent run of
 * the same task, and cited by an evidence row.
 */
export function recordQualifyingVerification(db: Db, taskId: string) {
  const providerId = ensureProvider(db);
  const run = createRun(db, {
    taskId,
    providerId,
    modelRef: 'sonnet',
    purpose: 'verification',
    billingMode: 'subscription_included',
    routingReason: 'test verification',
  });
  setRunStatus(db, run.id, 'succeeded');
  const vrun = recordVerificationRun(db, {
    taskId,
    command: 'pnpm test',
    status: 'passed',
    exitCode: 0,
    agentRunId: run.id,
  });
  const proof = addEvidence(db, {
    taskId,
    kind: 'verification_run',
    ref: vrun.id,
    summary: 'verification passed',
  });
  return { run, vrun, proof };
}

/** Drive a task through the production proof-bound completion transition. */
export function completeTaskProperly(db: Db, taskId: string) {
  if (getTask(db, taskId).status === 'draft') transitionTask(db, taskId, 'ready');
  for (const status of ['queued', 'running', 'verifying', 'reviewing', 'ready_to_merge'] as const) {
    transitionTask(db, taskId, status);
  }
  recordQualifyingVerification(db, taskId);
  transitionTask(db, taskId, 'completed');
  return getTask(db, taskId);
}

/**
 * TEST FIXTURE ONLY: materialise a pending suggestion into an approved draft
 * task. Production approval (approveSuggestion) is disabled in this build
 * (SuggestionApprovalUnavailableError), so this fixture performs the same
 * relational writes directly to set up the DB state that the retained
 * relational-model invariants are asserted against. It is not a production
 * path — production code cannot approve a suggestion at all.
 */
export function materialiseApprovedSuggestion(db: Db, suggestionId: string, note?: string) {
  const suggestion = getSuggestion(db, suggestionId);
  // Raw insert: production task creation (addTask) now refuses any task carrying
  // suggestion provenance while approval is disabled, so this fixture writes the
  // approved-materialisation state directly at the relational level.
  const taskId = newId('task');
  db.insert(tasks)
    .values({
      id: taskId,
      projectId: suggestion.projectId,
      roadmapItemId: suggestion.roadmapItemId,
      suggestionId: suggestion.id,
      title: suggestion.title,
      description: suggestion.description,
      status: 'draft',
    })
    .run();
  db.update(taskSuggestions)
    .set({
      status: 'approved',
      approvedTaskId: taskId,
      decidedAt: nowIso(),
      decisionNote: note ?? null,
    })
    .where(eq(taskSuggestions.id, suggestionId))
    .run();
  return { suggestion: getSuggestion(db, suggestionId), task: getTask(db, taskId) };
}

export function seedProject(db: Db, name = 'demo') {
  return addProject(db, projectConfigSchema.parse({ name, repoPath: '~/Projects/demo' }));
}

export function model(overrides: Partial<ModelState> & { modelRef: string }): ModelState {
  return {
    routingClass: 'sonnet',
    visible: true,
    authenticated: true,
    availability: 'available',
    billingMode: 'subscription_included',
    prohibited: false,
    source: 'registry',
    ...overrides,
  };
}

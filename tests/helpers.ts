import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq, sql } from 'drizzle-orm';
import { openDb, type Db } from '../src/db/client.js';
import { addProject } from '../src/config/project-service.js';
import { projectConfigSchema } from '../src/config/project-config.js';
import { agentProviders, tasks, taskSuggestions } from '../src/db/schema.js';
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
  if (existing) return existing.id;
  const id = newId('aprov');
  db.insert(agentProviders).values({ id, name }).run();
  return id;
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

/**
 * TEST FIXTURE ONLY: drive a task to 'completed'. The service-layer
 * completion transition is disabled in this build (automated-task-completion
 * is an unavailable capability), so after satisfying the DB backstop's proof
 * requirements (lifecycle to ready_to_merge, qualifying verification with
 * linked evidence) the final status write happens at the SQLite level. This
 * is not a production path — production code cannot complete a task at all.
 */
export function completeTaskProperly(db: Db, taskId: string) {
  if (getTask(db, taskId).status === 'draft') transitionTask(db, taskId, 'ready');
  for (const status of ['queued', 'running', 'verifying', 'reviewing', 'ready_to_merge'] as const) {
    transitionTask(db, taskId, status);
  }
  recordQualifyingVerification(db, taskId);
  db.run(sql`UPDATE tasks SET status = 'completed', version = version + 1 WHERE id = ${taskId}`);
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

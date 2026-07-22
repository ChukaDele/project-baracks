import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { openDb, type Db } from '../src/db/client.js';
import { addProject } from '../src/config/project-service.js';
import { projectConfigSchema } from '../src/config/project-config.js';
import { agentProviders } from '../src/db/schema.js';
import { newId } from '../src/domain/ids.js';
import { addEvidence, transitionTask, getTask } from '../src/domain/task-service.js';
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
 * Drive a task to 'completed' the legitimate way: through the lifecycle with
 * a qualifying passed verification run and linked evidence.
 */
export function completeTaskProperly(db: Db, taskId: string) {
  if (getTask(db, taskId).status === 'draft') transitionTask(db, taskId, 'ready');
  for (const status of ['queued', 'running', 'verifying', 'reviewing', 'ready_to_merge'] as const) {
    transitionTask(db, taskId, status);
  }
  recordQualifyingVerification(db, taskId);
  return transitionTask(db, taskId, 'completed');
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

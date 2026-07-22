import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb, type Db } from '../src/db/client.js';
import { addProject } from '../src/config/project-service.js';
import { projectConfigSchema } from '../src/config/project-config.js';
import { addEvidence, transitionTask, getTask } from '../src/domain/task-service.js';
import { recordVerificationRun } from '../src/domain/run-service.js';
import type { ModelState } from '../src/providers/types.js';

export function testDb(): Db {
  return openDb(':memory:').db;
}

/** Path for a file-backed test database (multi-connection scenarios). */
export function tempDbPath(): string {
  return join(mkdtempSync(join(tmpdir(), 'major-db-')), 'major.db');
}

/**
 * Drive a task to 'completed' the legitimate way: through the lifecycle with
 * a passed verification run and linked evidence.
 */
export function completeTaskProperly(db: Db, taskId: string) {
  if (getTask(db, taskId).status === 'draft') transitionTask(db, taskId, 'ready');
  for (const status of ['queued', 'running', 'verifying', 'reviewing', 'ready_to_merge'] as const) {
    transitionTask(db, taskId, status);
  }
  const vrun = recordVerificationRun(db, {
    taskId,
    command: 'pnpm test',
    status: 'passed',
    exitCode: 0,
  });
  addEvidence(db, {
    taskId,
    kind: 'verification_run',
    ref: vrun.id,
    summary: 'verification passed',
  });
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

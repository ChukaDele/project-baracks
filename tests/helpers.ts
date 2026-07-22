import { openDb, type Db } from '../src/db/client.js';
import { addProject } from '../src/config/project-service.js';
import { projectConfigSchema } from '../src/config/project-config.js';
import type { ModelState } from '../src/providers/types.js';

export function testDb(): Db {
  return openDb(':memory:').db;
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

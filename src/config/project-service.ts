import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { projects } from '../db/schema.js';
import { newId } from '../domain/ids.js';
import { projectConfigSchema, type ProjectConfig } from './project-config.js';

export function addProject(db: Db, config: ProjectConfig) {
  const validated = projectConfigSchema.parse(config);
  const row = {
    id: newId('proj'),
    name: validated.name,
    repoPath: validated.repoPath,
    githubRepo: validated.githubRepo ?? null,
    configJson: JSON.stringify(validated),
  };
  db.insert(projects).values(row).run();
  return row;
}

export function listProjects(db: Db) {
  return db.select().from(projects).all();
}

export function getProjectByName(db: Db, name: string) {
  const row = db.select().from(projects).where(eq(projects.name, name)).get();
  if (!row) throw new Error(`project not found: ${name}`);
  return row;
}

export function projectConfig(row: { configJson: string }): ProjectConfig {
  return projectConfigSchema.parse(JSON.parse(row.configJson));
}

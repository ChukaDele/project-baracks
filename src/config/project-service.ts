import { eq } from 'drizzle-orm';
import { resolve } from 'node:path';
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

export function getProjectByRepoPath(db: Db, repoPath: string) {
  const normalized = resolve(repoPath);
  const row = listProjects(db).find((candidate) => resolve(candidate.repoPath) === normalized);
  if (!row) throw new Error(`project not found for repository: ${normalized}`);
  return row;
}

/**
 * Runtime execution may move between worktrees of one repository identity.
 * Reuse the existing project row by path first, then by its stable name,
 * instead of attempting a duplicate insert for every worktree.
 */
export function getOrAddProject(db: Db, config: ProjectConfig) {
  const validated = projectConfigSchema.parse(config);
  const byPath = listProjects(db).find(
    (candidate) => resolve(candidate.repoPath) === resolve(validated.repoPath),
  );
  if (byPath) return byPath;

  const byName = db.select().from(projects).where(eq(projects.name, validated.name)).get();
  if (byName) return byName;

  return addProject(db, validated);
}

export function projectConfig(row: { configJson: string }): ProjectConfig {
  return projectConfigSchema.parse(JSON.parse(row.configJson));
}

import { describe, expect, it } from 'vitest';
import { projectConfigSchema } from '../src/config/project-config.js';
import { openDb } from '../src/db/client.js';
import { addProject, getOrAddProject } from '../src/config/project-service.js';
import { projects } from '../src/db/schema.js';

describe('runtime project registration', () => {
  it('reuses a project identity when execution moves to another worktree', () => {
    const { db, sqlite } = openDb(':memory:');
    try {
      const existing = addProject(
        db,
        projectConfigSchema.parse({
          name: 'github.com/example/project',
          repoPath: '/tmp/project-old-worktree',
        }),
      );

      const reused = getOrAddProject(
        db,
        projectConfigSchema.parse({
          name: 'github.com/example/project',
          repoPath: '/tmp/project-new-worktree',
        }),
      );

      expect(reused.id).toBe(existing.id);
      expect(db.select().from(projects).all()).toHaveLength(1);
    } finally {
      sqlite.close();
    }
  });
});

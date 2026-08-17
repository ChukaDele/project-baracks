import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { priorArtDiscoveryDirective } from '../src/capabilities/discovery.js';
import { isCapabilitySourceCurrent } from '../src/capabilities/verifier.js';
import { projectConfigSchema } from '../src/config/project-config.js';
import { addProject } from '../src/config/project-service.js';
import { openDb } from '../src/db/client.js';
import { resolveSkills } from '../src/skills/resolver.js';
import { resolveGoalCapabilities } from '../src/supervisor/runtime.js';
import type { SupervisorGoal } from '../src/supervisor/state.js';

const roots: string[] = [];
let priorDbPath: string | undefined;

afterEach(() => {
  if (priorDbPath === undefined) delete process.env.MAJOR_DB_PATH;
  else process.env.MAJOR_DB_PATH = priorDbPath;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

function setupUnknownOperation(): SupervisorGoal {
  const root = mkdtempSync(join(tmpdir(), 'major-prior-art-'));
  roots.push(root);
  priorDbPath = process.env.MAJOR_DB_PATH;
  process.env.MAJOR_DB_PATH = join(root, 'major.db');
  const { db, sqlite } = openDb();
  const repoPath = resolve(root, 'repo');
  mkdirSync(repoPath, { recursive: true });
  addProject(db, projectConfigSchema.parse({ name: 'prior-art-runtime', repoPath }));
  sqlite.close();
  return {
    id: 'goal-prior-art',
    project: 'prior-art-runtime',
    repoPath,
    goal: 'Prove a capability the local catalogue does not have.',
    autonomous: false,
    status: 'active',
    preferredCoordinator: 'codex',
    cycle: 0,
    consecutiveFailures: 0,
    requiredOperations: ['isolated-local-runtime'],
    createdAt: '2026-08-17T00:00:00.000Z',
    updatedAt: '2026-08-17T00:00:00.000Z',
  };
}

describe('prior-art discovery gate', () => {
  it('resolves prior-art-discovery for infrastructure work and not ordinary features', () => {
    expect(
      resolveSkills({
        task: 'Implement a new agent runtime sandbox with MCP integration.',
      }).skills.map((skill) => skill.id),
    ).toContain('prior-art-discovery');
    expect(
      resolveSkills({
        task: 'Fix a CSS spacing issue.',
      }).skills.map((skill) => skill.id),
    ).not.toContain('prior-art-discovery');
  });

  it('returns the ordered process and decision-record requirement', () => {
    const directive = priorArtDiscoveryDirective('isolated-local-runtime');
    expect(directive).toContain('DEFINE CAPABILITY');
    expect(directive).toContain('CHECK EXISTING MAJOR');
    expect(directive).toContain('CHECK GBRAIN/SKILLS');
    expect(directive).toContain('CHECK OFFICIAL PROVIDER TOOLS');
    expect(directive).toContain('CHECK MCP/ACP ECOSYSTEM');
    expect(directive).toContain('CHECK MATURE OSS');
    expect(directive).toContain('CHECK PACKAGE ECOSYSTEM');
    expect(directive).toContain('COMPARE');
    expect(directive).toContain('DECIDE');
    expect(directive).toContain('docs/prior-art-decisions.md');
  });

  it('names prior-art discovery on a Toolsmith checkpoint with no local candidate', () => {
    const goal = setupUnknownOperation();
    const resolved = resolveGoalCapabilities(goal, {
      discover: () => [],
      sourceCurrent: isCapabilitySourceCurrent,
    });
    expect(resolved.kind).toBe('checkpoint');
    if (resolved.kind !== 'checkpoint') throw new Error('expected checkpoint');
    expect(resolved.reason).toContain('no candidate supports the requested operation');
    expect(resolved.reason).toContain(priorArtDiscoveryDirective('isolated-local-runtime'));
  });
});

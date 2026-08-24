import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { observeReusableAssetCandidate, retrieveReusableAssets } from '../src/skills/assets.js';

const roots: string[] = [];

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('reusable asset lifecycle', () => {
  it('records a successful implementation only as a project-local reuse candidate', () => {
    const project = mkdtempSync(join(tmpdir(), 'major-asset-candidate-'));
    roots.push(project);
    copyFileSync(
      join(process.cwd(), 'templates', 'project', 'GOAL_STATE.md'),
      join(project, 'goal-state.md'),
    );

    const candidate = observeReusableAssetCandidate({
      id: 'goal-state-variant',
      kind: 'template',
      summary: 'Project-local goal state variant.',
      locator: 'goal-state.md',
      tags: ['goal', 'state'],
      scope: 'shared',
      sourceProject: project,
      narrative: 'The worker reported a reusable project-local implementation.',
    });

    expect(candidate.lifecycle).toBe('REUSE_CANDIDATE');
    expect(candidate.scope).toBe('project-local');
    expect(candidate.provenance.sourceVersion).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(candidate.evidence.tests).toEqual([]);
    const record = join(project, '.major', 'reusable-assets.registry.json');
    expect(existsSync(record)).toBe(true);
    expect(JSON.parse(readFileSync(record, 'utf8')).assets[0].lifecycle).toBe('REUSE_CANDIDATE');
    expect(
      retrieveReusableAssets({ task: 'goal state variant', cwd: project }).assets,
    ).not.toContainEqual(expect.objectContaining({ id: 'goal-state-variant' }));
  });
});

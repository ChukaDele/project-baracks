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
  it('retrieves Lenis only for relevant scroll orchestration', () => {
    const previous = process.env.MAJOR_GBRAIN_ASSET_INDEX;
    const indexPath = join(process.cwd(), 'guidance', 'gbrain-reusable-assets.index.json');
    process.env.MAJOR_GBRAIN_ASSET_INDEX = indexPath;
    try {
      const relevant = retrieveReusableAssets({
        task: 'Integrate Lenis with GSAP ScrollTrigger',
        cwd: process.cwd(),
      });
      const match = relevant.assets.find((asset) => asset.id === 'lenis-scroll-orchestration');
      expect(match?.source).toBe('gbrain-org-index');

      const unrelated = retrieveReusableAssets({
        task: 'Audit static business homepage SEO',
        cwd: process.cwd(),
      });
      expect(unrelated.assets.map((asset) => asset.id)).not.toContain('lenis-scroll-orchestration');

      const writing = retrieveReusableAssets({
        task: 'Make this reference letter sound smooth and polished',
        cwd: process.cwd(),
      });
      expect(writing.assets.map((asset) => asset.id)).not.toContain('lenis-scroll-orchestration');
    } finally {
      if (previous === undefined) delete process.env.MAJOR_GBRAIN_ASSET_INDEX;
      else process.env.MAJOR_GBRAIN_ASSET_INDEX = previous;
    }
  });

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

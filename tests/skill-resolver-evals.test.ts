import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveSkills } from '../src/skills/resolver.js';

interface Fixture {
  skill: string;
  should_trigger: string[];
  should_not_trigger: string[];
}

const root = join(process.cwd(), 'evals', 'skill-resolver');
const registry = join(process.cwd(), 'guidance', 'skills.registry.json');
const priorRegistry = process.env.MAJOR_SKILLS_REGISTRY;
const priorEvals = process.env.MAJOR_SKILLS_EVALS;
const priorMajorHome = process.env.MAJOR_HOME;
const majorHome = mkdtempSync(join(tmpdir(), 'major-resolver-evals-home-'));
const fixtures = readdirSync(root)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(root, name), 'utf8')) as Fixture);

function skillIds(task: string): string[] {
  return resolveSkills({ task, limit: 12 }).skills.map((skill) => skill.id);
}

beforeEach(() => {
  process.env.MAJOR_HOME = majorHome;
  process.env.MAJOR_SKILLS_REGISTRY = registry;
  process.env.MAJOR_SKILLS_EVALS = root;
});

afterAll(() => {
  rmSync(majorHome, { recursive: true, force: true });
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  if (priorRegistry === undefined) delete process.env.MAJOR_SKILLS_REGISTRY;
  else process.env.MAJOR_SKILLS_REGISTRY = priorRegistry;
  if (priorEvals === undefined) delete process.env.MAJOR_SKILLS_EVALS;
  else process.env.MAJOR_SKILLS_EVALS = priorEvals;
});

describe('skill resolver fixtures', () => {
  it.each(fixtures)(
    'retrieves $skill for every positive and excludes every negative',
    (fixture) => {
      for (const task of fixture.should_trigger) {
        const ids = skillIds(task);
        expect(ids, task).toContain(fixture.skill);
      }
      for (const task of fixture.should_not_trigger) {
        const ids = skillIds(task);
        expect(ids, task).not.toContain(fixture.skill);
      }
    },
  );

  it('excludes both specialist skills for ShapeR reconstruction and analytics for network shaping', () => {
    const shapeRTasks = [
      'Use ShapeR to reconstruct a sculpture.',
      'Use 3D ShapeR to reconstruct a sculpture.',
    ];
    for (const task of shapeRTasks) {
      const ids = skillIds(task);
      expect(ids, task).not.toContain('analytics-with-shaper');
      expect(ids, task).not.toContain('gaussian-splatting-spatial-reconstruction');
    }

    const networkShaperTask = 'Use a network shaper to cap telemetry packet bandwidth.';
    const ids = skillIds(networkShaperTask);
    expect(ids, networkShaperTask).not.toContain('analytics-with-shaper');
  });

  it('disambiguates the required held-out Shaper and Gaussian phrases', () => {
    const gaussianPositive = resolveSkills({
      task: 'Reconstruct a consented room capture with 3D Gaussian Splatting and render novel views.',
      limit: 12,
    }).skills.map((skill) => skill.id);
    expect(gaussianPositive).toContain('gaussian-splatting-spatial-reconstruction');
    expect(gaussianPositive).not.toContain('analytics-with-shaper');

    const shaperPositive = resolveSkills({
      task: 'Build a Taleshape Shaper dashboard over Major telemetry without adding a runtime dependency.',
      limit: 12,
    }).skills.map((skill) => skill.id);
    expect(shaperPositive).toContain('analytics-with-shaper');
    expect(shaperPositive).not.toContain('gaussian-splatting-spatial-reconstruction');

    const metaShapeR = resolveSkills({
      task: 'Reconstruct a sculpture with Meta ShapeR.',
      limit: 12,
    }).skills.map((skill) => skill.id);
    expect(metaShapeR).not.toContain('analytics-with-shaper');
    expect(metaShapeR).not.toContain('gaussian-splatting-spatial-reconstruction');

    const gaussianBlur = resolveSkills({
      task: 'Apply Gaussian blur to the uploaded photo.',
      limit: 12,
    }).skills.map((skill) => skill.id);
    expect(gaussianBlur).not.toContain('gaussian-splatting-spatial-reconstruction');

    const scatterPlot = resolveSkills({
      task: 'Chart provider latency as a scatter plot.',
      limit: 12,
    }).skills.map((skill) => skill.id);
    expect(scatterPlot).not.toContain('analytics-with-shaper');
  });

  it('guards negative spatial intent and generic ShapeR generation semantically', () => {
    const cases = [
      [
        'Create a point cloud of a sculpture without reconstruction or rendering.',
        ['concept-synthesis', 'worktree'],
      ],
      ['No reconstruction is needed; inspect a sculpture point cloud.', []],
      ['Do not reconstruct the sculpture; export its point cloud.', ['presentation-storylining']],
      ['Reconstruction is unnecessary; inspect the point cloud.', []],
      ['Do not use splatting or novel-view rendering; export the point cloud.', ['idea-lineage']],
      [
        'Do not use COLMAP; inspect the existing point cloud.',
        ['project-context-integrity', 'seo-os', 'skill-harvest', 'skill-resolver'],
      ],
      ['Use ShapeR to make a 3D model.', []],
      ['Generate a 3D asset with ShapeR from a text prompt.', ['reusable-asset-discovery']],
    ] as const;

    for (const [task, expected] of cases) {
      expect(skillIds(task), task).toEqual(expected);
    }

    const shapeRWithGaussianTasks = [
      'Use ShapeR to reconstruct a sculpture with 3D Gaussian Splatting.',
      'Generate a 3D asset with ShapeR and Gaussian Splatting.',
      'Use ShapeR to build a 3D model, then apply Gaussian Splatting for novel views.',
    ];
    for (const task of shapeRWithGaussianTasks) {
      const ids = skillIds(task);
      expect(ids, task).toContain('gaussian-splatting-spatial-reconstruction');
      expect(ids, task).not.toContain('analytics-with-shaper');
    }
  });
});

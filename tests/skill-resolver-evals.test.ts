import { readFileSync, readdirSync } from 'node:fs';
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
const fixtures = readdirSync(root)
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => JSON.parse(readFileSync(join(root, name), 'utf8')) as Fixture);

beforeEach(() => {
  process.env.MAJOR_SKILLS_REGISTRY = registry;
  process.env.MAJOR_SKILLS_EVALS = root;
});

afterAll(() => {
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
        const ids = resolveSkills({ task, limit: 12 }).skills.map((skill) => skill.id);
        expect(ids, task).toContain(fixture.skill);
      }
      for (const task of fixture.should_not_trigger) {
        const ids = resolveSkills({ task, limit: 12 }).skills.map((skill) => skill.id);
        expect(ids, task).not.toContain(fixture.skill);
      }
    },
  );

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
});

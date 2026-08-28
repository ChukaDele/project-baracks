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

  it.each([
    [
      'Shape outbound network traffic with qdisc so packet bursts stay below the bandwidth cap.',
      'analytics-with-shaper',
    ],
    [
      'Use SHAP explanations to show which features drove the fraud prediction.',
      'analytics-with-shaper',
    ],
    [
      'Run a Gaussian noise filter over the scanned image before OCR.',
      'gaussian-splatting-spatial-reconstruction',
    ],
    [
      'Plot a fitted Gaussian distribution for the response-time sample.',
      'gaussian-splatting-spatial-reconstruction',
    ],
  ])('rejects held-out near-neighbour paraphrase: %s', (task, excludedSkill) => {
    const ids = resolveSkills({ task, limit: 12 }).skills.map((skill) => skill.id);
    expect(ids, task).not.toContain(excludedSkill);
  });
});

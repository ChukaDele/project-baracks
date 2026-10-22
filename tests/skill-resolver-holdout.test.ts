import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveSkills } from '../src/skills/resolver.js';

interface HoldoutCase {
  id: string;
  task: string;
  expect?: string[];
  forbid?: string[];
  maxSkills?: number;
}

// The resolver reads evals/skill-resolver as routing examples. These cases live
// elsewhere so they measure natural wording the resolver has never seen.
const { cases } = JSON.parse(
  readFileSync(join(process.cwd(), 'evals', 'skill-resolver-holdout', 'cases.json'), 'utf8'),
) as { cases: HoldoutCase[] };
const prior = {
  MAJOR_HOME: process.env.MAJOR_HOME,
  MAJOR_SKILLS_REGISTRY: process.env.MAJOR_SKILLS_REGISTRY,
  MAJOR_SKILLS_EVALS: process.env.MAJOR_SKILLS_EVALS,
  MAJOR_SHARED_SKILLS_ROOT: process.env.MAJOR_SHARED_SKILLS_ROOT,
};
const majorHome = mkdtempSync(join(tmpdir(), 'major-resolver-holdout-home-'));

beforeEach(() => {
  process.env.MAJOR_HOME = majorHome;
  process.env.MAJOR_SKILLS_REGISTRY = join(process.cwd(), 'guidance', 'skills.registry.json');
  process.env.MAJOR_SKILLS_EVALS = join(process.cwd(), 'evals', 'skill-resolver');
  process.env.MAJOR_SHARED_SKILLS_ROOT = join(process.cwd(), 'tests', 'fixtures', 'shared-skills');
});

afterAll(() => {
  rmSync(majorHome, { recursive: true, force: true });
  for (const [key, value] of Object.entries(prior)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('held-out natural-language skill routing', () => {
  it.each(cases)('$id', ({ task, expect: expected = [], forbid = [], maxSkills }) => {
    const ids = resolveSkills({ task, limit: 12 }).skills.map((skill) => skill.id);
    for (const id of expected) expect(ids, `${task} -> ${ids.join(', ')}`).toContain(id);
    for (const id of forbid) expect(ids, `${task} -> ${ids.join(', ')}`).not.toContain(id);
    if (maxSkills !== undefined)
      expect(ids.length, `${task} -> ${ids.join(', ')}`).toBeLessThanOrEqual(maxSkills);
  });
});

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveSkills } from '../src/skills/resolver.js';

const priorEnv = {
  MAJOR_HOME: process.env.MAJOR_HOME,
  MAJOR_SKILLS_REGISTRY: process.env.MAJOR_SKILLS_REGISTRY,
  MAJOR_SKILLS_EVALS: process.env.MAJOR_SKILLS_EVALS,
  MAJOR_SHARED_SKILLS_ROOT: process.env.MAJOR_SHARED_SKILLS_ROOT,
};
const home = mkdtempSync(join(tmpdir(), 'major-emil-routing-'));

beforeEach(() => {
  process.env.MAJOR_HOME = home;
  process.env.MAJOR_SKILLS_REGISTRY = join(process.cwd(), 'guidance', 'skills.registry.json');
  process.env.MAJOR_SKILLS_EVALS = join(process.cwd(), 'evals', 'skill-resolver');
  process.env.MAJOR_SHARED_SKILLS_ROOT = join(process.cwd(), 'tests', 'fixtures', 'shared-skills');
});

afterAll(() => {
  rmSync(home, { recursive: true, force: true });
  for (const [key, value] of Object.entries(priorEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const ids = (task: string) => resolveSkills({ task }).skills.map((skill) => skill.id);

describe('Emil craft specialists at the default resolver limit', () => {
  it.each([
    [
      'mobile-native fixes',
      'Fix the 100vh bug and sticky hover on my iPhone web app so it feels native',
      'emil-mobile-native',
    ],
    [
      'animation and easing review',
      'Review the easing and duration on this drawer animation',
      'emil-animations',
    ],
    [
      'forms and inputs',
      'Build a signup form with validation and no double submit',
      'emil-forms-and-inputs',
    ],
    [
      'marketing and landing pages',
      'Build a landing page with a hero section and pricing page for our website',
      'emil-marketing-pages',
    ],
    [
      'pre-launch sweep',
      'Run a pre-launch sweep of this web app before we go live',
      'emil-prep-for-prod',
    ],
    ['UI diff review', 'Review this UI diff for polish mistakes', 'emil-ui-review'],
    ['Lapse questions', 'Use Lapse to slow down the page animations', 'emil-ask-lapse'],
  ])('%s resolves to %s', (_name, task, skill) => {
    expect(ids(task)).toContain(skill);
  });

  it.each([
    [
      'design-direction-and-taste stays the taste authority',
      'Redesign this landing page; it still looks like generic AI SaaS.',
      ['design-direction-and-taste', 'remote-first-web-development'],
    ],
    [
      'website-design-qa keeps release QA',
      'Do a full responsive and visual QA of this marketing website before launch.',
      ['website-design-qa', 'design-direction-and-taste', 'remote-first-web-development'],
    ],
    [
      'website-design-qa keeps pre-launch ownership',
      'Run a pre-launch sweep of this web app before we go live',
      ['website-design-qa'],
    ],
    [
      'responsive-motion-systems keeps scroll motion',
      'Debug this ScrollTrigger sticky pinned overlap on mobile',
      [
        'responsive-motion-systems',
        'website-design-qa',
        'remote-first-web-development',
        'root-cause-qa',
      ],
    ],
    [
      'GSAP and hero video work is untouched',
      'Make this website Awwwards-level with GSAP scroll animation and a hero video',
      ['responsive-motion-systems', 'website-design-qa', 'remote-first-web-development'],
    ],
  ])('%s', (_name, task, existing) => {
    const resolved = ids(task);
    expect(resolved.slice(0, existing.length)).toEqual(existing);
    expect(resolved.slice(existing.length).every((id) => id.startsWith('emil-'))).toBe(true);
  });

  it('adds no Emil skill to scroll-motion work', () => {
    expect(
      ids('Make this website Awwwards-level with GSAP scroll animation and a hero video').filter(
        (id) => id.startsWith('emil-'),
      ),
    ).toEqual([]);
  });

  it('does not route non-UI tasks to Emil skills', () => {
    for (const task of [
      'Fix this backend SQL query.',
      'Draft a quarterly revenue forecast.',
      'Reconcile the bank statement.',
    ]) {
      expect(
        ids(task).filter((id) => id.startsWith('emil-')),
        task,
      ).toEqual([]);
    }
  });
});

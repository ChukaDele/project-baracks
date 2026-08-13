import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { auditSkillReachability, resolveSkills } from '../src/skills/resolver.js';
import { runSkillCli } from '../src/skills/cli.js';

const roots: string[] = [];
const priorMajorHome = process.env.MAJOR_HOME;
const priorSkillsRegistry = process.env.MAJOR_SKILLS_REGISTRY;

afterEach(() => {
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  if (priorSkillsRegistry === undefined) delete process.env.MAJOR_SKILLS_REGISTRY;
  else process.env.MAJOR_SKILLS_REGISTRY = priorSkillsRegistry;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('runtime skill resolver', () => {
  const consolidatedRoutingScenarios: {
    task: string;
    includes: string[];
    excludes: string[];
  }[] = [
    {
      task: 'Build a new dashboard with a material visual direction.',
      includes: ['craft-web-interfaces'],
      excludes: ['verify-in-browser'],
    },
    {
      task: 'Fix a small API bug using the established project helper.',
      includes: [],
      excludes: ['research-before-build', 'craft-web-interfaces'],
    },
    {
      task: 'Add an interaction-heavy reusable form component with loading and error states.',
      includes: ['test-components'],
      excludes: ['research-product-patterns'],
    },
    {
      task: 'Redesign a dense product table after researching production workflow patterns.',
      includes: ['research-product-patterns', 'craft-web-interfaces'],
      excludes: [],
    },
    {
      task: 'Create a marketing landing page with three distinct visual directions.',
      includes: ['craft-web-interfaces'],
      excludes: ['test-components'],
    },
    {
      task: 'Add a GSAP ScrollTrigger animation with reduced-motion behavior.',
      includes: ['responsive-motion-systems'],
      excludes: ['test-components'],
    },
    {
      task: 'Investigate a failing GitHub Actions deployment check.',
      includes: ['ci-recovery'],
      excludes: ['craft-web-interfaces'],
    },
    {
      task: 'Add a third-party connector integration after comparing official and maintained options.',
      includes: ['research-before-build', 'mcp-integration-ops'],
      excludes: ['craft-web-interfaces'],
    },
    {
      task: 'Build a long-running complex workflow pipeline and compare existing workflow engines.',
      includes: ['research-before-build', 'lean-graph-engineering'],
      excludes: ['verify-in-browser'],
    },
    {
      task: 'Execute unfamiliar third-party code in an isolated sandbox after evaluating maintained tools.',
      includes: ['research-before-build'],
      excludes: ['craft-web-interfaces'],
    },
    {
      task: 'Research how competitors implement recruiter onboarding in Mobbin.',
      includes: ['research-product-patterns'],
      excludes: ['verify-in-browser'],
    },
    {
      task: 'Review a static Markdown document for factual clarity.',
      includes: [],
      excludes: ['craft-web-interfaces', 'verify-in-browser', 'test-components'],
    },
    {
      task: 'Change a database schema using the existing migration pattern.',
      includes: [],
      excludes: ['research-before-build', 'craft-web-interfaces', 'test-components'],
    },
    {
      task: 'Handle client PII under the existing project-local data policy.',
      includes: [],
      excludes: ['research-product-patterns', 'craft-web-interfaces'],
    },
    {
      task: 'Retry a failed external API call in the existing source adapter.',
      includes: ['root-cause-qa'],
      excludes: ['craft-web-interfaces'],
    },
    {
      task: 'Wait for human-only approval before the irreversible external action.',
      includes: ['human-blocker-orchestration'],
      excludes: ['research-before-build', 'research-product-patterns'],
    },
    {
      task: 'Resume a complex autonomous workflow after interruption and preserve dependencies.',
      includes: ['lean-graph-engineering'],
      excludes: ['craft-web-interfaces'],
    },
    {
      task: 'Compare existing maintained libraries before custom implementation.',
      includes: ['research-before-build'],
      excludes: ['craft-web-interfaces'],
    },
    {
      task: 'Run visual regression in a real browser at mobile and desktop viewports.',
      includes: ['verify-in-browser'],
      excludes: ['research-product-patterns'],
    },
    {
      task: 'Publish a production web change after exact-head review and browser acceptance.',
      includes: ['exact-head-pr-review', 'verify-in-browser'],
      excludes: ['craft-web-interfaces'],
    },
  ];

  it('routes the 20-scenario consolidated capability matrix', () => {
    for (const scenario of consolidatedRoutingScenarios) {
      const resolved = resolveSkills({ task: scenario.task }).skills.map((skill) => skill.id);
      for (const expected of scenario.includes) {
        expect(resolved, scenario.task).toContain(expected);
      }
      for (const irrelevant of scenario.excludes) {
        expect(resolved, scenario.task).not.toContain(irrelevant);
      }
    }
  });

  it('routes natural paraphrases without generic research or approval false positives', () => {
    const browser = resolveSkills({
      task: 'Run browser QA against the approved design.',
    }).skills.map((skill) => skill.id);
    expect(browser).toContain('verify-in-browser');

    const library = resolveSkills({
      task: 'Research whether we need a maintained auth library before coding.',
    }).skills.map((skill) => skill.id);
    expect(library).toContain('research-before-build');
    expect(library).not.toContain('research-product-patterns');

    const dns = resolveSkills({ task: 'Wait for owner approval on DNS transfer.' }).skills.map(
      (skill) => skill.id,
    );
    expect(dns).toContain('human-blocker-orchestration');
  });

  it('reaches every registered internal skill with no duplicate or orphan ids', () => {
    const audit = auditSkillReachability(process.cwd());
    expect(audit.duplicateIds).toEqual([]);
    expect(audit.orphanInternalSkills).toEqual([]);
    expect(audit.internal.length).toBeGreaterThan(30);
    expect(audit.internal.every((entry) => entry.reachable)).toBe(true);
    for (const entry of audit.internal) {
      const resolved = resolveSkills({ task: `Use ${entry.id} for this task.`, limit: 1 });
      expect(resolved.skills[0]?.id).toBe(entry.id);
    }
  });

  it('passes every positive and negative resolver eval for the named skill', () => {
    const root = join(process.cwd(), 'evals', 'skill-resolver');
    for (const name of readdirSync(root).filter((file) => file.endsWith('.json'))) {
      const fixture = JSON.parse(readFileSync(join(root, name), 'utf8')) as {
        skill: string;
        should_trigger: string[];
        should_not_trigger: string[];
      };
      for (const prompt of fixture.should_trigger) {
        expect(
          resolveSkills({ task: prompt }).skills.map((skill) => skill.id),
          prompt,
        ).toContain(fixture.skill);
      }
      for (const prompt of fixture.should_not_trigger) {
        expect(
          resolveSkills({ task: prompt }).skills.map((skill) => skill.id),
          prompt,
        ).not.toContain(fixture.skill);
      }
    }
  });

  it('prefers the immutable runtime skill over a mutable global copy', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-mutable-skills-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;
    const mutable = join(home, 'skills', 'internal', 'skill-resolver', 'SKILL.md');
    mkdirSync(join(home, 'skills', 'internal', 'skill-resolver'), { recursive: true });
    writeFileSync(mutable, '# stale mutable copy\n');
    const resolved = resolveSkills({ task: 'Use skill-resolver for this task.', limit: 1 });
    expect(resolved.skills[0]?.path).not.toBe(mutable);
    expect(resolved.skills[0]?.path).toContain('/skills/internal/skill-resolver/SKILL.md');
  });

  it('does not let a project shadow a registered Major-internal skill id', () => {
    const project = mkdtempSync(join(tmpdir(), 'major-project-skill-shadow-'));
    roots.push(project);
    const shadow = join(project, '.claude', 'skills', 'skill-resolver', 'SKILL.md');
    mkdirSync(join(project, '.claude', 'skills', 'skill-resolver'), { recursive: true });
    writeFileSync(shadow, '# hostile project shadow\n');
    const resolved = resolveSkills({
      task: 'Use skill-resolver for this task.',
      cwd: project,
      limit: 1,
    });
    expect(resolved.skills[0]?.path).not.toBe(shadow);
    expect(resolved.skills[0]?.source).toBe('major-internal');
  });

  it('fails a strict audit when a registered internal skill is unreachable', async () => {
    const root = mkdtempSync(join(tmpdir(), 'major-strict-skill-audit-'));
    roots.push(root);
    const registry = join(root, 'skills.registry.json');
    writeFileSync(
      registry,
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: 'definitely-missing-skill',
            source: 'major-internal',
            availability: 'installed',
            load: 'missing fixture',
          },
        ],
      }),
    );
    process.env.MAJOR_SKILLS_REGISTRY = registry;
    await expect(runSkillCli(['skill', 'audit', '--strict', '--json'])).rejects.toThrow(
      /skill audit failed/,
    );
  });
});

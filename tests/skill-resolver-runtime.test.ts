import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { auditSkillReachability, discloseSkills, resolveSkills } from '../src/skills/resolver.js';
import { runSkillCli } from '../src/skills/cli.js';

const roots: string[] = [];
const priorMajorHome = process.env.MAJOR_HOME;
const priorSkillsRegistry = process.env.MAJOR_SKILLS_REGISTRY;
const priorSkillEvals = process.env.MAJOR_SKILLS_EVALS;

beforeEach(() => {
  process.env.MAJOR_SKILLS_REGISTRY = join(process.cwd(), 'guidance', 'skills.registry.json');
  process.env.MAJOR_SKILLS_EVALS = join(process.cwd(), 'evals', 'skill-resolver');
});

afterEach(() => {
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  if (priorSkillsRegistry === undefined) delete process.env.MAJOR_SKILLS_REGISTRY;
  else process.env.MAJOR_SKILLS_REGISTRY = priorSkillsRegistry;
  if (priorSkillEvals === undefined) delete process.env.MAJOR_SKILLS_EVALS;
  else process.env.MAJOR_SKILLS_EVALS = priorSkillEvals;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('runtime skill resolver', () => {
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

  it('keeps Brand OS specialist trigger surfaces distinct', () => {
    const cases = new Map([
      ['Build our brand', 'brand-os'],
      ['We need a rebrand', 'brand-os'],
      ['Our brand looks generic', 'brand-os'],
      ['Help us rethink positioning, messaging and identity', 'brand-os'],
      ['We need a logo', 'brand-os'],
      ['Help us build our brand from scratch.', 'brand-os'],
      ['We need a rebrand but do not know where to start.', 'brand-os'],
      ['Run a complete end-to-end brand project and deliver the Brand Book.', 'brand-os'],
      ['Clarify our brand positioning, category choice and buyer alternatives.', 'brand-strategy'],
      ['Use the approved positioning and architecture to name the new service.', 'brand-naming'],
      [
        'Turn the approved positioning into the messaging house and brand voice.',
        'brand-verbal-identity',
      ],
      [
        'Turn the approved positioning into stylescapes, a logo and a brand colour system.',
        'brand-identity-design',
      ],
      ['Red-team this completed brand before launch and list fatal issues.', 'brand-red-team'],
      ['Approved positioning: stress-test these names', 'brand-naming'],
      ['Approved positioning: write our verbal identity', 'brand-verbal-identity'],
      ['Attack this finished identity before launch', 'brand-red-team'],
      ['Build my founder personal brand and LinkedIn authority plan.', 'personal-brand-authority'],
    ]);
    const brandSkills = new Set(cases.values());

    for (const [prompt, expected] of cases) {
      const resolved = resolveSkills({ task: prompt })
        .skills.map((skill) => skill.id)
        .filter((id) => brandSkills.has(id));
      expect(resolved, prompt).toEqual([expected]);
    }
  });

  it('routes the ten Brand OS acceptance prompts to one owner with no competing specialist', () => {
    const brandSkills = new Set([
      'brand-os',
      'brand-strategy',
      'brand-naming',
      'brand-verbal-identity',
      'brand-identity-design',
      'brand-red-team',
      'personal-brand-authority',
    ]);
    const cases = new Map([
      ['We need a logo for our new company.', 'brand-os'],
      ['Attack this finished identity before launch.', 'brand-red-team'],
      [
        'Help me become known on LinkedIn as an expert in recruitment AI.',
        'personal-brand-authority',
      ],
      ['Build our complete brand from scratch.', 'brand-os'],
      ['Should we create a new market category?', 'brand-strategy'],
      ['Redesign this website without changing the company brand.', 'website-design-qa'],
      ['Audit our technical SEO.', 'seo-os'],
      ['Build our brand.', 'brand-os'],
      ['Our brand looks generic.', 'brand-os'],
      ['Help us rethink positioning, messaging and identity.', 'brand-os'],
    ]);

    for (const [prompt, expected] of cases) {
      const resolved = resolveSkills({ task: prompt }).skills.map((skill) => skill.id);
      expect(resolved, prompt).toContain(expected);
      expect(
        resolved.filter((id) => brandSkills.has(id) && id !== expected),
        prompt,
      ).toEqual([]);
    }
  });

  it('keeps exact repaired routes compatible with the installed pre-exclusivity resolver', () => {
    const registry = JSON.parse(
      readFileSync(join(process.cwd(), 'guidance', 'skills.registry.json'), 'utf8'),
    ) as { entries: Array<{ id: string; aliases?: string[] }> };
    const cases = new Map([
      ['We need a logo for our new company.', 'brand-os'],
      ['Attack this finished identity before launch.', 'brand-red-team'],
      [
        'Help me become known on LinkedIn as an expert in recruitment AI.',
        'personal-brand-authority',
      ],
      ['Build our complete brand from scratch.', 'brand-os'],
      ['Should we create a new market category?', 'brand-strategy'],
      ['Redesign this website without changing the company brand.', 'website-design-qa'],
      ['Audit our technical SEO.', 'seo-os'],
      ['Build our brand.', 'brand-os'],
      ['Our brand looks generic.', 'brand-os'],
      ['Help us rethink positioning, messaging and identity.', 'brand-os'],
    ]);
    const brandSkills = [
      'brand-os',
      'brand-strategy',
      'brand-naming',
      'brand-verbal-identity',
      'brand-identity-design',
      'brand-red-team',
      'personal-brand-authority',
    ];

    for (const [prompt, expected] of cases) {
      expect(
        registry.entries.find((entry) => entry.id === expected)?.aliases,
        `${prompt} must be an exact owner alias for the installed resolver`,
      ).toContain(prompt);
      for (const competitor of brandSkills.filter((id) => id !== expected)) {
        const fixture = JSON.parse(
          readFileSync(
            join(process.cwd(), 'evals', 'skill-resolver', `${competitor}.json`),
            'utf8',
          ),
        ) as { should_not_trigger: string[] };
        expect(fixture.should_not_trigger, `${prompt} must suppress ${competitor}`).toContain(
          prompt,
        );
      }
    }
  });

  it('scores aliases as phrases rather than as individual generic words', () => {
    const ids = resolveSkills({
      task: 'Our company needs help with an unrelated task.',
    }).skills.map((skill) => skill.id);
    expect(ids).not.toContain('brand-os');
  });

  it('keeps website/product art direction and SEO with existing Major owners', () => {
    const brandSkills = new Set([
      'brand-os',
      'brand-strategy',
      'brand-naming',
      'brand-verbal-identity',
      'brand-identity-design',
      'brand-red-team',
      'personal-brand-authority',
    ]);
    const cases = new Map([
      ['Redesign this website without changing the company brand', 'design-direction-and-taste'],
      ['Audit our technical SEO', 'seo-os'],
    ]);

    for (const [prompt, expected] of cases) {
      const resolved = resolveSkills({ task: prompt }).skills.map((skill) => skill.id);
      expect(resolved, prompt).toContain(expected);
      expect(
        resolved.filter((id) => brandSkills.has(id)),
        prompt,
      ).toEqual([]);
    }
  });

  it('resolves a canonical skill by a retained non-ID alias', () => {
    expect(
      resolveSkills({
        task: 'Perform a root cause analysis for this regression.',
        limit: 3,
      }).skills.map((skill) => skill.id),
    ).toContain('root-cause-qa');
  });

  it('classifies hot, active specialist, and dormant skills deterministically', () => {
    const disclosure = discloseSkills({
      task: 'Perform a root cause analysis for this regression.',
      bodyBytes: 8_000,
      perBodyBytes: 2_000,
    });

    expect(disclosure.manifest).toContainEqual(
      expect.objectContaining({ id: 'project-context-integrity', state: 'HOT' }),
    );
    expect(disclosure.manifest).toContainEqual(
      expect.objectContaining({ id: 'root-cause-qa', state: 'ACTIVE' }),
    );
    expect(disclosure.manifest).toContainEqual(
      expect.objectContaining({ id: 'project-start', state: 'DORMANT' }),
    );
    expect(disclosure.bodies.map((skill) => skill.id)).toContain('root-cause-qa');
    expect(disclosure.bodies.every((skill) => ['HOT', 'ACTIVE'].includes(skill.state))).toBe(true);
  });

  it('keeps manifest and selected bodies within explicit disclosure budgets', () => {
    const disclosure = discloseSkills({
      task: 'Use root-cause-qa to debug and verify this deployment incident.',
      manifestBytes: 2_000,
      bodyBytes: 1_000,
      perBodyBytes: 300,
    });

    expect(disclosure.metrics.manifest.disclosedBytes).toBeLessThanOrEqual(2_000);
    expect(disclosure.metrics.bodies.disclosedBytes).toBeLessThanOrEqual(1_000);
    expect(disclosure.bodies.every((skill) => Buffer.byteLength(skill.content) <= 300)).toBe(true);
    expect(disclosure.metrics.total.disclosedBytes).toBeLessThan(
      disclosure.metrics.total.beforeBytes,
    );
  });

  it('does not disclose a specialist body for its exact negative example', () => {
    const disclosure = discloseSkills({ task: 'Run the single test command I just gave you.' });
    expect(disclosure.bodies.map((skill) => skill.id)).not.toContain('skill-resolver');
    expect(disclosure.manifest).toContainEqual(
      expect.objectContaining({ id: 'skill-resolver', state: 'DORMANT' }),
    );
  });

  it('prefers the immutable runtime skill over an untrusted legacy mutable global copy', () => {
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

  it('prefers a complete newer validated hot bundle over the immutable release', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-hot-skills-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;
    delete process.env.MAJOR_SKILLS_REGISTRY;
    delete process.env.MAJOR_SKILLS_EVALS;
    const bundle = join(home, 'skill-bundles', '0123456789abcdef0123456789abcdef01234567');
    mkdirSync(join(bundle, 'guidance'), { recursive: true });
    mkdirSync(join(bundle, 'skills', 'internal', 'hot-skill'), { recursive: true });
    mkdirSync(join(bundle, 'evals', 'skill-resolver'), { recursive: true });
    writeFileSync(
      join(bundle, 'bundle.json'),
      JSON.stringify({ version: 1, sha: '0123456789abcdef0123456789abcdef01234567' }),
    );
    writeFileSync(
      join(bundle, 'guidance', 'skills.registry.json'),
      JSON.stringify({
        version: 999,
        entries: [
          {
            id: 'hot-skill',
            source: 'major-internal',
            availability: 'all-projects',
            load: 'hot skill immediate sync',
          },
        ],
      }),
    );
    writeFileSync(
      join(bundle, 'skills', 'internal', 'hot-skill', 'SKILL.md'),
      '---\nname: hot-skill\ndescription: hot\n---\n\n# Hot\n',
    );
    const current = join(home, 'skill-bundles', 'current');
    symlinkSync('0123456789abcdef0123456789abcdef01234567', current);

    const resolved = resolveSkills({ task: 'Use hot-skill for this task.', limit: 1 });
    expect(resolved.skills[0]?.id).toBe('hot-skill');
    expect(resolved.skills[0]?.path).toBe(
      join(current, 'skills', 'internal', 'hot-skill', 'SKILL.md'),
    );
  });

  it('ignores a malformed hot bundle even when it declares an older registry version', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-stale-hot-skills-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;
    const bundle = join(home, 'skill-bundles', 'fedcba9876543210fedcba9876543210fedcba98');
    mkdirSync(join(bundle, 'guidance'), { recursive: true });
    mkdirSync(join(bundle, 'skills', 'internal', 'stale-hot-skill'), { recursive: true });
    writeFileSync(
      join(bundle, 'bundle.json'),
      JSON.stringify({ version: 1, sha: 'not-a-valid-bundle-hash' }),
    );
    writeFileSync(
      join(bundle, 'guidance', 'skills.registry.json'),
      JSON.stringify({
        version: 1,
        entries: [
          {
            id: 'stale-hot-skill',
            source: 'major-internal',
            availability: 'all-projects',
            load: 'stale hot skill',
          },
        ],
      }),
    );
    writeFileSync(
      join(bundle, 'skills', 'internal', 'stale-hot-skill', 'SKILL.md'),
      '---\nname: stale-hot-skill\ndescription: stale\n---\n',
    );
    symlinkSync('fedcba9876543210fedcba9876543210fedcba98', join(home, 'skill-bundles', 'current'));

    expect(
      resolveSkills({ task: 'Use stale-hot-skill for this task.' }).skills.map((skill) => skill.id),
    ).not.toContain('stale-hot-skill');
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

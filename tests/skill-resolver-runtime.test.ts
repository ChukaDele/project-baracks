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

  it('ignores a stale hot bundle whose registry predates the immutable release', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-stale-hot-skills-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;
    const bundle = join(home, 'skill-bundles', 'fedcba9876543210fedcba9876543210fedcba98');
    mkdirSync(join(bundle, 'guidance'), { recursive: true });
    mkdirSync(join(bundle, 'skills', 'internal', 'stale-hot-skill'), { recursive: true });
    writeFileSync(
      join(bundle, 'bundle.json'),
      JSON.stringify({ version: 1, sha: 'fedcba9876543210fedcba9876543210fedcba98' }),
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

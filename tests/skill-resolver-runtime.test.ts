import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { auditSkillReachability, resolveSkills } from '../src/skills/resolver.js';

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
});

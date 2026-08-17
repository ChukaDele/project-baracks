import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runSkillCli } from '../src/skills/cli.js';
import { resolveSkills } from '../src/skills/resolver.js';

const roots: string[] = [];
const priorMajorHome = process.env.MAJOR_HOME;

afterEach(() => {
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('Major hot skill sync', () => {
  it('activates all current internal skills without a runtime reinstall', async () => {
    const home = mkdtempSync(join(tmpdir(), 'major-skill-sync-home-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;

    const synced = await runSkillCli(['skill', 'sync', '--source', process.cwd(), '--json']);
    expect(synced).toBe(true);

    const current = join(home, 'skill-bundles', 'current');
    expect(existsSync(join(current, 'bundle.json'))).toBe(true);
    expect(existsSync(join(current, 'guidance', 'skills.registry.json'))).toBe(true);
    expect(
      existsSync(join(current, 'skills', 'internal', 'presentation-storylining', 'SKILL.md')),
    ).toBe(true);

    const marker = JSON.parse(readFileSync(join(current, 'bundle.json'), 'utf8')) as {
      version: number;
      sha: string;
    };
    expect(marker.version).toBe(1);
    expect(marker.sha).toMatch(/^[0-9a-f]{64}$/);

    const resolved = resolveSkills({
      task: 'Turn this analysis into a board deck and make the argument airtight.',
      limit: 6,
    });
    const presentation = resolved.skills.find((skill) => skill.id === 'presentation-storylining');
    expect(presentation).toBeDefined();
    expect(presentation?.path).toContain(
      '/skill-bundles/current/skills/internal/presentation-storylining/SKILL.md',
    );
  });
});

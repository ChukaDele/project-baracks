import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { recordSkillRoutingEvidence } from '../src/skills/routing-evidence.js';

const priorMajorHome = process.env.MAJOR_HOME;
const roots: string[] = [];

afterEach(() => {
  if (priorMajorHome === undefined) delete process.env.MAJOR_HOME;
  else process.env.MAJOR_HOME = priorMajorHome;
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true });
});

describe('skill routing learning evidence', () => {
  it('turns a repeated rejection into inspectable learning evidence', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-routing-evidence-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;
    const input = {
      kind: 'rejection' as const,
      task: 'Use the missing capability.',
      requested: ['missing-capability'],
      reason: 'unknown skill',
    };
    expect(recordSkillRoutingEvidence(input)).toMatchObject({
      occurrences: 1,
      learningCandidate: false,
    });
    expect(recordSkillRoutingEvidence(input)).toMatchObject({
      occurrences: 2,
      learningCandidate: true,
    });
    const path = join(home, 'learning', 'skill-routing-evidence.json');
    expect(existsSync(path)).toBe(true);
    expect(JSON.parse(readFileSync(path, 'utf8'))).toContainEqual(
      expect.objectContaining({ key: 'rejection:missing-capability', occurrences: 2 }),
    );
  });
});

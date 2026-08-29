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

  it('serializes a bounded evidence store and bounds untrusted fields', () => {
    const home = mkdtempSync(join(tmpdir(), 'major-routing-bounds-'));
    roots.push(home);
    process.env.MAJOR_HOME = home;
    for (let index = 0; index < 140; index += 1) {
      recordSkillRoutingEvidence({
        kind: 'miss',
        task: `unmatched task ${index}`,
        requested: Array.from({ length: 20 }, (_, item) => `${index}-${item}-${'x'.repeat(120)}`),
        reason: 'r'.repeat(700),
      });
    }
    const rows = JSON.parse(
      readFileSync(join(home, 'learning', 'skill-routing-evidence.json'), 'utf8'),
    ) as Array<{ requested: string[]; lastReason: string }>;
    expect(rows).toHaveLength(128);
    expect(rows.every((row) => row.requested.length <= 16)).toBe(true);
    expect(rows.every((row) => row.requested.every((value) => value.length <= 100))).toBe(true);
    expect(rows.every((row) => row.lastReason.length <= 500)).toBe(true);
    expect(existsSync(join(home, 'learning', 'skill-routing-evidence.json.lock'))).toBe(false);
  });
});

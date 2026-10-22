import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { graphifyContext } from '../src/context/graphify.js';

describe('graphifyContext', () => {
  it('adds the graph block only when graphify-out/graph.json exists', () => {
    const repo = mkdtempSync(join(tmpdir(), 'major-graphify-'));
    try {
      expect(graphifyContext(repo)).toBe('');
      mkdirSync(join(repo, 'graphify-out'));
      writeFileSync(join(repo, 'graphify-out', 'graph.json'), '{}');
      expect(graphifyContext(repo)).toContain('graphify query');
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });
});

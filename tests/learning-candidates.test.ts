import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { captureLearning, listLearningCandidates } from '../src/learning/candidates.js';

let root = '';
let priorPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-learning-'));
  priorPath = process.env.MAJOR_LEARNING_PATH;
  process.env.MAJOR_LEARNING_PATH = join(root, 'learning.json');
});

afterEach(() => {
  if (priorPath === undefined) delete process.env.MAJOR_LEARNING_PATH;
  else process.env.MAJOR_LEARNING_PATH = priorPath;
  rmSync(root, { recursive: true, force: true });
});

describe('Major learning candidates', () => {
  it('captures explicit corrections durably with scope and evidence', () => {
    const candidate = captureLearning({
      project: 'bredge',
      repoPath: '/tmp/bredge',
      source: 'user-correction',
      scope: 'global',
      summary: 'Allocate a stable project-specific local dev port before starting browser QA.',
      evidence: 'Bredge reused localhost:3001 while another project needed it.',
    });

    expect(candidate.occurrences).toBe(1);
    expect(candidate.scope).toBe('global');
    expect(candidate.evidence).toHaveLength(1);
    expect(listLearningCandidates()).toHaveLength(1);
  });

  it('folds repeated corrections into one candidate and increments occurrences', () => {
    const input = {
      project: 'bredge',
      repoPath: '/tmp/bredge',
      source: 'user-correction' as const,
      scope: 'global' as const,
      summary: 'Allocate a stable project-specific local dev port before starting browser QA.',
    };
    const first = captureLearning({ ...input, evidence: 'first recurrence' });
    const second = captureLearning({ ...input, evidence: 'second recurrence' });

    expect(second.id).toBe(first.id);
    expect(second.occurrences).toBe(2);
    expect(second.evidence).toEqual(['first recurrence', 'second recurrence']);
    expect(listLearningCandidates()).toHaveLength(1);
  });

  it('keeps project-local candidates out of unrelated project views', () => {
    captureLearning({
      project: 'surface-talent',
      repoPath: '/tmp/st',
      source: 'recurring-failure',
      scope: 'project',
      summary: 'Surface Talent-specific Recruitly mapping rule.',
    });
    captureLearning({
      project: 'jss-tool',
      repoPath: '/tmp/jss',
      source: 'successful-procedure',
      scope: 'global',
      summary: 'Generic idempotent external writeback pattern.',
    });

    const jssView = listLearningCandidates('jss-tool');
    expect(jssView.map((candidate) => candidate.summary)).toEqual([
      'Generic idempotent external writeback pattern.',
    ]);
  });
});

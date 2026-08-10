import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureLearning,
  dismissLearning,
  learningReviewDue,
  listLearningCandidates,
  promoteLearning,
} from '../src/learning/candidates.js';

let root = '';
let priorLearningPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-learning-lifecycle-'));
  priorLearningPath = process.env.MAJOR_LEARNING_PATH;
  process.env.MAJOR_LEARNING_PATH = join(root, 'learning-candidates.json');
});

afterEach(() => {
  if (priorLearningPath === undefined) delete process.env.MAJOR_LEARNING_PATH;
  else process.env.MAJOR_LEARNING_PATH = priorLearningPath;
  rmSync(root, { recursive: true, force: true });
});

describe('Major learning lifecycle', () => {
  it('coalesces paraphrased corrections when they share a stable learning key', () => {
    const first = captureLearning({
      source: 'user-correction',
      key: 'wrong-project-edit',
      summary: 'Confirm the target repository before editing.',
      scope: 'global',
      project: 'jss-tool',
      evidence: 'First correction',
    });
    const second = captureLearning({
      source: 'recurring-failure',
      key: 'wrong-project-edit',
      summary: 'Do not patch whichever repo happens to be open.',
      scope: 'global',
      project: 'surface-talent',
      evidence: 'Second correction',
    });

    expect(second.id).toBe(first.id);
    expect(second.occurrences).toBe(2);
    expect(second.evidence).toEqual(['First correction', 'Second correction']);
    expect(learningReviewDue()).toHaveLength(1);
  });

  it('removes a candidate from review due after its durable replacement is promoted', () => {
    const candidate = captureLearning({
      source: 'user-correction',
      key: 'remote-preview-not-localhost',
      summary: 'Use the approved remote preview path.',
      scope: 'global',
      project: 'bredge',
    });
    captureLearning({
      source: 'recurring-failure',
      key: 'remote-preview-not-localhost',
      summary: 'Avoid local preview regressions.',
      scope: 'global',
      project: 'jss-tool',
    });

    expect(learningReviewDue()).toHaveLength(1);
    const promoted = promoteLearning({
      id: candidate.id,
      scope: 'global',
      evidence: 'Promoted into tested remote-first guidance.',
    });

    expect(promoted.status).toBe('promoted');
    expect(learningReviewDue()).toHaveLength(0);
    expect(listLearningCandidates(undefined, 'promoted')).toHaveLength(1);
  });

  it('requires evidence to dismiss a recurring learning candidate', () => {
    const candidate = captureLearning({
      source: 'manual',
      key: 'temporary-provider-workaround',
      summary: 'Temporary provider-specific workaround.',
      project: 'example-project',
    });

    expect(() => dismissLearning({ id: candidate.id, evidence: '   ' })).toThrow(
      /evidence\/reason is required/,
    );

    const dismissed = dismissLearning({
      id: candidate.id,
      evidence: 'Provider bug was fixed upstream; rule is now obsolete.',
    });
    expect(dismissed.status).toBe('dismissed');
  });
});

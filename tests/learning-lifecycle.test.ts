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
  it('coalesces sanitized global corrections when they share a stable learning key', () => {
    const first = captureLearning({
      source: 'user-correction',
      key: 'wrong-project-edit',
      summary: 'Confirm the target repository before editing.',
      scope: 'global',
      project: 'jss-tool',
      repoPath: root,
      evidence: 'Sanitized first correction',
    });
    const second = captureLearning({
      source: 'recurring-failure',
      key: 'wrong-project-edit',
      summary: 'Do not patch whichever repo happens to be open.',
      scope: 'global',
      project: 'surface-talent',
      repoPath: root,
      evidence: 'Sanitized second correction',
    });

    expect(second.id).toBe(first.id);
    expect(second.occurrences).toBe(2);
    expect(second.project).toBeUndefined();
    expect(second.repoPath).toBeUndefined();
    expect(second.evidence).toEqual(['Sanitized first correction', 'Sanitized second correction']);
    expect(learningReviewDue()).toHaveLength(1);
  });

  it('does not merge project-scoped evidence into an existing global candidate', () => {
    const globalCandidate = captureLearning({
      source: 'manual',
      key: 'browser-evidence-required',
      summary: 'Use browser evidence for visual claims.',
      scope: 'global',
      project: 'jss-tool',
      repoPath: root,
      evidence: 'Sanitized global evidence',
    });
    const projectCandidate = captureLearning({
      source: 'user-correction',
      key: 'browser-evidence-required',
      summary: 'This project had a private visual QA correction.',
      scope: 'project',
      project: 'surface-talent',
      repoPath: root,
      evidence: 'Project-local evidence that must not enter global learning',
    });

    expect(projectCandidate.id).not.toBe(globalCandidate.id);
    expect(globalCandidate.occurrences).toBe(1);
    expect(globalCandidate.project).toBeUndefined();
    expect(globalCandidate.repoPath).toBeUndefined();
    expect(globalCandidate.evidence).toEqual(['Sanitized global evidence']);
    expect(projectCandidate.scope).toBe('project');
  });

  it('requires evidence and a sanitized summary before global promotion', () => {
    const candidate = captureLearning({
      source: 'user-correction',
      key: 'remote-preview-not-localhost',
      summary: 'Private project wording that should not become global.',
      scope: 'project',
      project: 'bredge',
      repoPath: root,
      evidence: 'Private project evidence',
    });

    expect(() =>
      promoteLearning({
        id: candidate.id,
        scope: 'global',
        evidence: '   ',
        summary: 'Use the approved remote preview path.',
      }),
    ).toThrow(/promotion evidence is required/);

    expect(() =>
      promoteLearning({
        id: candidate.id,
        scope: 'global',
        evidence: 'Promoted into tested remote-first guidance.',
        summary: '   ',
      }),
    ).toThrow(/sanitized summary/);

    const promoted = promoteLearning({
      id: candidate.id,
      scope: 'global',
      evidence: 'Promoted into tested remote-first guidance.',
      summary: 'Use the approved remote preview path.',
    });

    expect(promoted.status).toBe('promoted');
    expect(promoted.scope).toBe('global');
    expect(promoted.summary).toBe('Use the approved remote preview path.');
    expect(promoted.project).toBeUndefined();
    expect(promoted.repoPath).toBeUndefined();
    expect(promoted.evidence).toEqual(['Promoted into tested remote-first guidance.']);
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
      summary: 'Use the approved remote preview path.',
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

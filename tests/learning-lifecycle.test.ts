import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
let priorRoot: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-learning-lifecycle-'));
  priorRoot = process.env.MAJOR_LEARNING_ROOT;
  process.env.MAJOR_LEARNING_ROOT = join(root, 'learning');
});

afterEach(() => {
  if (priorRoot === undefined) delete process.env.MAJOR_LEARNING_ROOT;
  else process.env.MAJOR_LEARNING_ROOT = priorRoot;
  rmSync(root, { recursive: true, force: true });
});

function recurringProjectCandidate() {
  const first = captureLearning({
    source: 'user-correction',
    key: 'remote-preview-not-localhost',
    summary: 'Private project wording that must not become global.',
    scope: 'project',
    project: 'bredge',
    repoPath: '/private/bredge',
    evidence: 'Private incident evidence.',
  });
  captureLearning({
    source: 'recurring-failure',
    key: 'remote-preview-not-localhost',
    summary: 'The same private correction happened again.',
    scope: 'project',
    project: 'bredge',
    repoPath: '/private/bredge',
    evidence: 'Second private incident.',
  });
  return first;
}

describe('Major learning lifecycle', () => {
  it('requires recurrence plus sanitized summary and evidence for global promotion', () => {
    const oneOff = captureLearning({
      source: 'manual',
      key: 'one-off',
      summary: 'A one-off lesson.',
      project: 'bredge',
    });
    expect(() =>
      promoteLearning({
        id: oneOff.id,
        project: 'bredge',
        scope: 'global',
        summary: 'Use a remote preview before browser QA.',
        evidence: 'Verified with synthetic regression tests.',
      }),
    ).toThrow(/at least two occurrences/);

    const candidate = recurringProjectCandidate();
    expect(() =>
      promoteLearning({
        id: candidate.id,
        project: 'bredge',
        scope: 'global',
        summary: 'Use Bredge at /private/bredge before browser QA.',
        evidence: 'Verified with synthetic regression tests.',
      }),
    ).toThrow(/not sanitized/);
    expect(() =>
      promoteLearning({
        id: candidate.id,
        project: 'bredge',
        scope: 'global',
        summary: 'Use an approved remote preview before browser QA.',
        evidence: 'See owner@example.com and https://private.example/evidence',
      }),
    ).toThrow(/not sanitized/);

    const shortName = captureLearning({
      source: 'manual',
      key: 'short-project-name',
      summary: 'Private short-name project lesson.',
      project: 'AI',
    });
    captureLearning({
      source: 'recurring-failure',
      key: 'short-project-name',
      summary: 'Private short-name project lesson repeated.',
      project: 'AI',
    });
    expect(() =>
      promoteLearning({
        id: shortName.id,
        project: 'AI',
        scope: 'global',
        summary: 'Reuse the AI project procedure.',
        evidence: 'Verified twice with synthetic fixtures.',
      }),
    ).toThrow(/not sanitized/);

    const promoted = promoteLearning({
      id: candidate.id,
      project: 'bredge',
      scope: 'global',
      summary: 'Use an approved remote preview before browser QA.',
      evidence: 'Verified twice with synthetic regression fixtures.',
    });
    expect(promoted.scope).toBe('global');
    expect(promoted.project).toBeUndefined();
    expect(promoted.repoPath).toBeUndefined();
    expect(listLearningCandidates(undefined, 'promoted')).toEqual([promoted]);
    const globalPath = join(root, 'learning', 'global.json');
    expect(existsSync(globalPath)).toBe(true);
    const raw = readFileSync(globalPath, 'utf8');
    expect(raw).not.toMatch(/bredge|\/private\/|owner@example\.com/i);
  });

  it('scopes promotion and dismissal lookup to the current project', () => {
    const candidate = recurringProjectCandidate();
    expect(() =>
      promoteLearning({
        id: candidate.id,
        project: 'surface-talent',
        scope: 'project',
        evidence: 'Wrong project attempt.',
      }),
    ).toThrow(/not found in project surface-talent/);
    expect(() =>
      dismissLearning({
        id: candidate.id,
        project: 'surface-talent',
        evidence: 'Wrong project attempt.',
      }),
    ).toThrow(/not found in project surface-talent/);
  });

  it('refuses tampered global records carrying metadata or PII', () => {
    const path = join(root, 'learning', 'global.json');
    mkdirSync(join(root, 'learning'), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        version: 2,
        candidates: [
          {
            id: 'tampered',
            project: 'private-client',
            source: 'manual',
            summary: 'Contact owner@example.com.',
            scope: 'global',
            occurrences: 2,
            evidence: ['Private evidence.'],
            status: 'promoted',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          },
        ],
      }),
    );
    expect(() => listLearningCandidates()).toThrow(/unsafe or malformed global/);
  });

  it('promotes or dismisses recurring project candidates with evidence', () => {
    const promotedCandidate = recurringProjectCandidate();
    expect(learningReviewDue('bredge')).toHaveLength(1);
    const promoted = promoteLearning({
      id: promotedCandidate.id,
      project: 'bredge',
      scope: 'project',
      evidence: 'Regression test added to this project.',
    });
    expect(promoted.status).toBe('promoted');
    expect(learningReviewDue('bredge')).toHaveLength(0);

    const dismissedCandidate = captureLearning({
      source: 'manual',
      key: 'temporary-workaround',
      summary: 'Temporary provider workaround.',
      project: 'bredge',
    });
    expect(() =>
      dismissLearning({ id: dismissedCandidate.id, project: 'bredge', evidence: '   ' }),
    ).toThrow(/evidence\/reason is required/);
    expect(
      dismissLearning({
        id: dismissedCandidate.id,
        project: 'bredge',
        evidence: 'Provider defect was fixed upstream.',
      }).status,
    ).toBe('dismissed');
  });
});

import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureLearning,
  dismissGlobalLearning,
  dismissLearning,
  learningReviewDue,
  listLearningCandidates,
  promoteLearning,
} from '../src/learning/candidates.js';
import { configureProjectPolicy } from '../src/supervisor/policy.js';

let root = '';
let priorRoot: string | undefined;
let priorPolicyPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-learning-lifecycle-'));
  priorRoot = process.env.MAJOR_LEARNING_ROOT;
  priorPolicyPath = process.env.MAJOR_POLICY_PATH;
  process.env.MAJOR_LEARNING_ROOT = join(root, 'learning');
  process.env.MAJOR_POLICY_PATH = join(root, 'policies.json');
});

afterEach(() => {
  if (priorRoot === undefined) delete process.env.MAJOR_LEARNING_ROOT;
  else process.env.MAJOR_LEARNING_ROOT = priorRoot;
  if (priorPolicyPath === undefined) delete process.env.MAJOR_POLICY_PATH;
  else process.env.MAJOR_POLICY_PATH = priorPolicyPath;
  rmSync(root, { recursive: true, force: true });
});

function allowGlobalPromotion(project: string, repoPath = `/private/${project}`) {
  configureProjectPolicy({
    project,
    repoPath,
    projectClass: 'knowledge',
    trust: 'build',
    ownerApprovedBuild: true,
  });
}

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
    allowGlobalPromotion('bredge');
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
    allowGlobalPromotion('AI');
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
    expect(promoted.key).toBeUndefined();
    expect(listLearningCandidates(undefined, 'promoted')).toEqual([promoted]);
    const globalPath = join(root, 'learning', 'global.json');
    expect(existsSync(globalPath)).toBe(true);
    const raw = readFileSync(globalPath, 'utf8');
    expect(raw).not.toMatch(/bredge|\/private\/|owner@example\.com/i);
  });

  it('requires cross-project memory authority before global promotion', () => {
    const candidate = recurringProjectCandidate();
    configureProjectPolicy({
      project: 'bredge',
      repoPath: '/private/bredge',
      projectClass: 'client',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    expect(() =>
      promoteLearning({
        id: candidate.id,
        project: 'bredge',
        scope: 'global',
        summary: 'Require representative evidence before readiness.',
        evidence: 'Verified twice with synthetic fixtures.',
      }),
    ).toThrow(/forbidden by the project policy/);
    expect(listLearningCandidates()).toEqual([]);
  });

  it('deduplicates global lessons by sanitized summary, never by project-local key', () => {
    for (const project of ['alpha-project', 'beta-project']) {
      allowGlobalPromotion(project);
      const candidate = captureLearning({
        source: 'recurring-failure',
        key: 'shared-project-key',
        summary: `Private source lesson for ${project}.`,
        project,
      });
      captureLearning({
        source: 'recurring-failure',
        key: 'shared-project-key',
        summary: `Private source lesson repeated for ${project}.`,
        project,
      });
      promoteLearning({
        id: candidate.id,
        project,
        scope: 'global',
        summary:
          project === 'alpha-project'
            ? 'Verify one immutable runtime before activation.'
            : 'Require one independent grade before activation.',
        evidence: 'Verified twice with sanitized synthetic fixtures.',
      });
    }
    const global = listLearningCandidates(undefined, 'promoted');
    expect(global).toHaveLength(2);
    expect(global.every((candidate) => candidate.key === undefined)).toBe(true);
    expect(readFileSync(join(root, 'learning', 'global.json'), 'utf8')).not.toMatch(
      /shared-project-key|alpha-project|beta-project/,
    );
  });

  it('retracts a global record without retaining its content', () => {
    allowGlobalPromotion('bredge');
    const candidate = recurringProjectCandidate();
    const promoted = promoteLearning({
      id: candidate.id,
      project: 'bredge',
      scope: 'global',
      summary: 'Require representative evidence before readiness.',
      evidence: 'Verified twice with synthetic fixtures.',
    });
    const dismissed = dismissGlobalLearning({
      id: promoted.id,
      evidence: 'Operator requested retraction after a privacy review.',
    });
    expect(dismissed).toMatchObject({
      status: 'dismissed',
      summary: 'Retracted global learning.',
      occurrences: 0,
    });
    expect(dismissed.evidence).toHaveLength(1);
    expect(dismissed.evidence[0]).toMatch(/^dismissal-reason-sha256:[a-f0-9]{64}$/);
    expect(listLearningCandidates(undefined, 'promoted')).toEqual([]);
    expect(listLearningCandidates('bredge', 'promoted')).toContainEqual(
      expect.objectContaining({ id: candidate.id, summary: candidate.summary }),
    );
    expect(readFileSync(join(root, 'learning', 'global.json'), 'utf8')).not.toContain(
      'Require representative evidence before readiness.',
    );
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
            key: 'private-client-key',
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

import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  captureLearning,
  learningRoot,
  listLearningCandidates,
} from '../src/learning/candidates.js';
import { buildLearningDigest, formatLearningDigest, parseSince } from '../src/learning/digest.js';
import {
  captureLearningOrQueue,
  drainLearningQueue,
  learningQueueDepth,
  runLearningStep,
} from '../src/learning/queue.js';
import { isMajorSelfWork, selfWorkTargetPct } from '../src/learning/self-work.js';
import { gbrainAutopilotCheck } from '../src/doctor/gbrain.js';

const ENV_KEYS = [
  'MAJOR_LEARNING_ROOT',
  'MAJOR_LEARNING_LOCK_WAIT_MS',
  'MAJOR_DB_PATH',
  'MAJOR_STATE_PATH',
  'MAJOR_SKILL_LIFECYCLE_ROOT',
  'MAJOR_SELF_WORK_TARGET_PCT',
] as const;
let root = '';
const prior: Record<string, string | undefined> = {};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-learning-queue-'));
  for (const key of ENV_KEYS) prior[key] = process.env[key];
  process.env.MAJOR_LEARNING_ROOT = join(root, 'learning');
  process.env.MAJOR_DB_PATH = join(root, 'missing.db');
  process.env.MAJOR_STATE_PATH = join(root, 'state.json');
  process.env.MAJOR_SKILL_LIFECYCLE_ROOT = join(root, 'skills');
  delete process.env.MAJOR_SELF_WORK_TARGET_PCT;
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (prior[key] === undefined) delete process.env[key];
    else process.env[key] = prior[key];
  }
  rmSync(root, { recursive: true, force: true });
});

function holdProjectStoreLock(project: string): string {
  // Create the store, then hold its lock as a live owner (this process).
  captureLearning({ project, source: 'manual', key: 'seed', summary: 'Seed.' });
  const dir = join(learningRoot(), 'projects');
  const store = readdirSync(dir).find((name) => name.endsWith('.json'))!;
  const lock = join(dir, `${store}.lock`);
  writeFileSync(lock, `${process.pid}\n`);
  return lock;
}

describe('learning fallback queue', () => {
  it('queues a contended capture instead of failing the run, then replays it', () => {
    const lock = holdProjectStoreLock('queue-project');
    process.env.MAJOR_LEARNING_LOCK_WAIT_MS = '50';
    const warning = runLearningStep({
      kind: 'capture',
      input: {
        project: 'queue-project',
        source: 'manual',
        key: 'queued',
        summary: 'Queued lesson.',
      },
    });
    expect(warning).toMatch(/capture learning deferred to queue: timed out locking/);
    expect(learningQueueDepth()).toEqual({ queued: 1, failed: 0 });

    // Still contended: drain keeps the step queued and counts the attempt.
    expect(drainLearningQueue()).toEqual({ replayed: 0, requeued: 1, deadLettered: 0 });

    rmSync(lock);
    expect(drainLearningQueue()).toEqual({ replayed: 1, requeued: 0, deadLettered: 0 });
    expect(learningQueueDepth()).toEqual({ queued: 0, failed: 0 });
    expect(listLearningCandidates('queue-project').map((item) => item.key)).toContain('queued');
  });

  it('dead-letters a step that keeps failing', () => {
    holdProjectStoreLock('dead-project');
    process.env.MAJOR_LEARNING_LOCK_WAIT_MS = '20';
    captureLearningOrQueue({ project: 'dead-project', source: 'manual', summary: 'Never lands.' });
    for (let attempt = 0; attempt < 5; attempt += 1) drainLearningQueue();
    expect(learningQueueDepth()).toEqual({ queued: 0, failed: 1 });
  });

  it('queues CLI captures on contention but still rejects invalid input', () => {
    holdProjectStoreLock('cli-project');
    process.env.MAJOR_LEARNING_LOCK_WAIT_MS = '20';
    expect(
      captureLearningOrQueue({ project: 'cli-project', source: 'manual', summary: 'Busy store.' }),
    ).toMatchObject({ queued: true });
    expect(() =>
      captureLearningOrQueue({ project: 'cli-project', source: 'manual', summary: '  ' }),
    ).toThrow(/must not be empty/);
    expect(() =>
      captureLearningOrQueue({
        project: 'cli-project',
        source: 'manual',
        scope: 'global',
        summary: 'x',
      }),
    ).toThrow(/forbidden/);
  });

  it('redacts secrets before they reach the queue file', () => {
    holdProjectStoreLock('secret-project');
    process.env.MAJOR_LEARNING_LOCK_WAIT_MS = '20';
    captureLearningOrQueue({
      project: 'secret-project',
      source: 'manual',
      summary: 'Token ghp_abcdefghijklmnopqrstuvwxyz0123456789 leaked.',
    });
    const body = readFileSync(join(learningRoot(), 'queue.jsonl'), 'utf8');
    expect(body).toContain('secret-project');
    expect(body).not.toContain('ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  });
});

describe('learning digest', () => {
  it('proposes REVIEW-DUE promotions and failed goals without changing state', () => {
    for (const evidence of ['first run', 'second run']) {
      captureLearning({
        project: 'digest-project',
        source: 'recurring-failure',
        key: 'flaky-port',
        summary: 'Dev port collides.',
        evidence,
      });
    }
    writeFileSync(
      process.env.MAJOR_STATE_PATH!,
      JSON.stringify({
        version: 1,
        sessions: [],
        goals: [
          {
            id: 'g-failed-1',
            project: 'p',
            repoPath: '/tmp/p',
            goal: 'Ship it',
            status: 'failed',
            updatedAt: '2026-10-20T00:00:00.000Z',
            lastSummary: 'tests timed out',
          },
          {
            id: 'g-done-1',
            project: 'p',
            repoPath: '/tmp/p',
            goal: 'Done',
            status: 'done',
            updatedAt: '2026-10-20T00:00:00.000Z',
          },
        ],
      }),
    );
    mkdirSync(join(root, 'skills', 'candidates'), { recursive: true });
    writeFileSync(
      join(root, 'skills', 'candidates', 'x.json'),
      JSON.stringify({
        version: 1,
        candidates: [{ skillId: 'never-used', status: 'active', performance: { uses: 0 } }],
      }),
    );

    const digest = buildLearningDigest({ catalogPath: join(root, 'no-catalog.json') });
    expect(digest.reviewDue).toHaveLength(1);
    expect(digest.reviewDue[0]).toMatchObject({ key: 'flaky-port', occurrences: 2 });
    expect(digest.reviewDue[0]!.evidence).toEqual(['first run', 'second run']);
    expect(digest.failedGoals.map((goal) => goal.id)).toEqual(['g-failed-1']);
    expect(digest.unusedSkills.generated).toEqual(['never-used']);
    expect(digest.selfWork).toMatchObject({
      totalRuns: 0,
      sharePct: 0,
      targetPct: 15,
      overTarget: false,
    });
    expect(digest.notes.some((note) => note.startsWith('Major database not found'))).toBe(true);
    expect(formatLearningDigest(digest)).toMatch(/proposals only; nothing was changed/);
    // Read-only: the candidate is still a candidate.
    expect(listLearningCandidates('digest-project')[0]?.status).toBe('candidate');
  });

  it('parses --since windows', () => {
    const now = Date.parse('2026-10-23T00:00:00.000Z');
    expect(parseSince('7d', now).toISOString()).toBe('2026-10-16T00:00:00.000Z');
    expect(parseSince('12h', now).toISOString()).toBe('2026-10-22T12:00:00.000Z');
    expect(parseSince('all', now).getTime()).toBe(0);
    expect(() => parseSince('soon', now)).toThrow(/--since/);
  });
});

describe('Major self-work budget', () => {
  it('recognises Major, its worktrees and legacy major-* scratch projects', () => {
    expect(isMajorSelfWork({ project: 'github.com/chukadele/project-baracks' })).toBe(true);
    expect(
      isMajorSelfWork({
        project: 'x',
        repoPath: '/Users/a/Projects/project-baracks/.claude/worktrees/w',
      }),
    ).toBe(true);
    expect(isMajorSelfWork({ project: 'project-baracks-foundry-headless-20260921' })).toBe(true);
    expect(isMajorSelfWork({ project: 'major-runtime-p0-proof' })).toBe(true);
    expect(
      isMajorSelfWork({ project: 'local:1', repoPath: '/private/tmp/major-host-repair' }),
    ).toBe(true);
    expect(
      isMajorSelfWork({
        project: 'github.com/chukadele/surface-talent-main',
        repoPath: '/x/surface-talent',
      }),
    ).toBe(false);
    expect(isMajorSelfWork({ project: 'jss-tool', githubRepo: 'chukadele/jss-tool' })).toBe(false);
  });

  it('uses an owner-configurable target with a 15% default', () => {
    expect(selfWorkTargetPct()).toBe(15);
    expect(selfWorkTargetPct('25')).toBe(25);
    process.env.MAJOR_SELF_WORK_TARGET_PCT = '10';
    expect(selfWorkTargetPct()).toBe(10);
    expect(selfWorkTargetPct('nope')).toBe(10);
  });
});

describe('GBrain autopilot doctor check', () => {
  it('flags a disabled autopilot and a missing repo path with the owner command', () => {
    const home = join(root, 'gbrain');
    mkdirSync(home);
    writeFileSync(join(home, 'autopilot-run.sh'), "exec gbrain autopilot --repo '/gone/repo'\n");
    writeFileSync(join(home, 'autopilot-disabled'), 'repo path gone: /gone/repo\n');
    const check = gbrainAutopilotCheck({ MAJOR_GBRAIN_HOME: home });
    expect(check?.status).toBe('warn');
    expect(check?.detail).toMatch(/autopilot disabled \(repo path gone: \/gone\/repo\)/);
    expect(check?.detail).toMatch(/autopilot repo path missing: \/gone\/repo/);
    expect(check?.detail).toMatch(/gbrain autopilot --install --repo <existing-brain-repo>/);
  });

  it('is ok for a healthy install and silent when autopilot was never installed', () => {
    const home = join(root, 'gbrain');
    mkdirSync(home);
    expect(gbrainAutopilotCheck({ MAJOR_GBRAIN_HOME: home })).toBeUndefined();
    writeFileSync(join(home, 'autopilot-run.sh'), `exec gbrain autopilot --repo '${root}'\n`);
    expect(gbrainAutopilotCheck({ MAJOR_GBRAIN_HOME: home })?.status).toBe('ok');
  });
});

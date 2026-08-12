import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  unlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  captureLearning,
  learningLockOwnerIsLive,
  learningRoot,
  listLearningCandidates,
} from '../src/learning/candidates.js';
import { configureProjectPolicy } from '../src/supervisor/policy.js';

let root = '';
let priorRoot: string | undefined;
let priorPolicyPath: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'major-learning-'));
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

describe('Major learning candidates', () => {
  it('treats EPERM as proof that a lock owner is still alive', () => {
    const error = Object.assign(new Error('not permitted'), { code: 'EPERM' });
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => {
      throw error;
    });
    expect(learningLockOwnerIsLive(42)).toBe(true);
    kill.mockRestore();
  });

  it('forbids direct global capture and keeps new evidence project-local', () => {
    expect(() =>
      captureLearning({
        project: 'bredge',
        repoPath: '/tmp/bredge',
        source: 'user-correction',
        scope: 'global',
        summary: 'Allocate a stable project-specific dev port.',
        evidence: 'Private Bredge incident evidence.',
      }),
    ).toThrow(/direct global capture is forbidden/);

    const candidate = captureLearning({
      project: 'bredge',
      repoPath: '/tmp/bredge',
      source: 'user-correction',
      scope: 'project',
      summary: 'Allocate a stable project-specific dev port.',
      evidence: 'Private Bredge incident evidence.',
    });
    expect(candidate.project).toBe('bredge');
    expect(listLearningCandidates()).toEqual([]);
    expect(listLearningCandidates('bredge')).toHaveLength(1);
  });

  it('redacts credentials before project-local learning persistence or recall', () => {
    const token = `sk-ant-api03-${'A'.repeat(24)}`;
    const candidate = captureLearning({
      project: 'secure-project',
      source: 'user-correction',
      summary: `Never print ANTHROPIC_API_KEY=${token}`,
      evidence: `provider returned Bearer ${'e'.repeat(32)}`,
    });
    expect(candidate.summary).not.toContain(token);
    expect(candidate.evidence.join(' ')).not.toContain('e'.repeat(32));
    const files = readdirSync(join(learningRoot(), 'projects'));
    const raw = readFileSync(join(learningRoot(), 'projects', files[0]!), 'utf8');
    expect(raw).not.toContain(token);
    expect(raw).not.toContain('e'.repeat(32));
    expect(raw).toContain('[REDACTED]');
  });

  it('folds repeated project corrections without merging unrelated projects', () => {
    const first = captureLearning({
      project: 'bredge',
      source: 'user-correction',
      key: 'stable-dev-port',
      summary: 'Allocate a stable project port.',
      evidence: 'first recurrence',
    });
    const second = captureLearning({
      project: 'bredge',
      source: 'recurring-failure',
      key: 'stable-dev-port',
      summary: 'Do not reuse another project port.',
      evidence: 'second recurrence',
    });
    const unrelated = captureLearning({
      project: 'surface-talent',
      source: 'user-correction',
      key: 'stable-dev-port',
      summary: 'A private project-specific port lesson.',
    });

    expect(second.id).toBe(first.id);
    expect(second.occurrences).toBe(2);
    expect(unrelated.id).not.toBe(first.id);
    expect(listLearningCandidates('bredge')).toHaveLength(1);
    expect(listLearningCandidates('surface-talent')).toHaveLength(1);
  });

  it('migrates attributable legacy learning with missing or deleted worktree paths', () => {
    const primary = join(root, 'primary', 'shared');
    const common = join(primary, '.git');
    const deletedGit = join(common, 'worktrees', 'deleted');
    const deletedWorktree = join(root, 'deleted-worktree');
    mkdirSync(deletedGit, { recursive: true });
    mkdirSync(deletedWorktree, { recursive: true });
    writeFileSync(
      join(common, 'config'),
      '[remote "origin"]\n\turl = https://github.com/Owner/shared.git\n',
    );
    writeFileSync(join(deletedGit, 'commondir'), '../..\n');
    writeFileSync(join(deletedWorktree, '.git'), `gitdir: ${deletedGit}\n`);
    configureProjectPolicy({
      project: 'shared',
      repoPath: primary,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    captureLearning({
      project: 'shared',
      source: 'manual',
      scope: 'project',
      summary: 'Legacy candidate without a path.',
    });
    captureLearning({
      project: 'shared',
      repoPath: deletedWorktree,
      source: 'manual',
      scope: 'project',
      summary: 'Legacy candidate from a deleted worktree.',
    });
    rmSync(deletedWorktree, { recursive: true, force: true });

    const migrated = listLearningCandidates('github.com/owner/shared', undefined, primary);
    expect(migrated.map((candidate) => candidate.summary)).toEqual(
      expect.arrayContaining([
        'Legacy candidate without a path.',
        'Legacy candidate from a deleted worktree.',
      ]),
    );
    expect(migrated.every((candidate) => candidate.project === 'github.com/owner/shared')).toBe(
      true,
    );
  });

  it('replays an interrupted legacy migration without duplicating candidates', () => {
    const primary = join(root, 'primary', 'replay');
    mkdirSync(join(primary, '.git'), { recursive: true });
    writeFileSync(
      join(primary, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/Owner/replay.git\n',
    );
    configureProjectPolicy({
      project: 'replay',
      repoPath: primary,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    const candidate = captureLearning({
      project: 'replay',
      repoPath: primary,
      source: 'manual',
      scope: 'project',
      summary: 'Replay-safe migration.',
    });
    const projects = join(learningRoot(), 'projects');
    const legacy = join(
      projects,
      `${createHash('sha256').update('replay').digest('hex').slice(0, 24)}.json`,
    );
    const target = join(
      projects,
      `${createHash('sha256').update('github.com/owner/replay').digest('hex').slice(0, 24)}.json`,
    );
    writeFileSync(target, readFileSync(legacy, 'utf8'));
    const migrated = listLearningCandidates('github.com/owner/replay', undefined, primary);
    expect(migrated.filter((item) => item.id === candidate.id)).toHaveLength(1);
  });

  it('reclaims a stale legacy store lock before canonical migration', () => {
    const primary = join(root, 'primary', 'stale-migration');
    mkdirSync(join(primary, '.git'), { recursive: true });
    writeFileSync(
      join(primary, '.git', 'config'),
      '[remote "origin"]\n\turl = https://github.com/Owner/stale-migration.git\n',
    );
    configureProjectPolicy({
      project: 'stale-migration',
      repoPath: primary,
      projectClass: 'workshop',
      trust: 'build',
      ownerApprovedBuild: true,
    });
    captureLearning({
      project: 'stale-migration',
      repoPath: primary,
      source: 'manual',
      summary: 'Recover stale migration locks.',
    });
    const legacy = join(
      learningRoot(),
      'projects',
      `${createHash('sha256').update('stale-migration').digest('hex').slice(0, 24)}.json`,
    );
    writeFileSync(`${legacy}.lock`, '999999999\n');
    const stale = new Date(Date.now() - 31_000);
    utimesSync(`${legacy}.lock`, stale, stale);
    expect(
      listLearningCandidates('github.com/owner/stale-migration', undefined, primary),
    ).toHaveLength(1);
    expect(existsSync(`${legacy}.lock`)).toBe(false);
  });

  it('uses physically separate opaque project stores', () => {
    captureLearning({
      project: 'jss-tool',
      repoPath: '/private/jss',
      source: 'manual',
      summary: 'Private JSS lesson.',
    });
    captureLearning({
      project: 'surface-talent',
      repoPath: '/private/surface',
      source: 'manual',
      summary: 'Private Surface lesson.',
    });

    const files = readdirSync(join(learningRoot(), 'projects'));
    expect(files).toHaveLength(2);
    expect(files.every((name) => /^[a-f0-9]{24}\.json$/.test(name))).toBe(true);
    const bodies = files.map((name) =>
      readFileSync(join(learningRoot(), 'projects', name), 'utf8'),
    );
    expect(bodies.some((body) => body.includes('Private JSS lesson.'))).toBe(true);
    expect(bodies.some((body) => body.includes('Private Surface lesson.'))).toBe(true);
    expect(
      bodies.every((body) => !(body.includes('Private JSS') && body.includes('Private Surface'))),
    ).toBe(true);
  });

  it('deduplicates concurrent cross-process captures without losing occurrences', async () => {
    const moduleUrl = pathToFileURL(
      join(import.meta.dirname, '..', 'src', 'learning', 'candidates.ts'),
    );
    const captures = Array.from({ length: 8 }, (_, index) => {
      const script = `
        import { captureLearning } from ${JSON.stringify(moduleUrl.href)};
        captureLearning({
          project: 'concurrent-project',
          source: 'recurring-failure',
          key: 'same-concurrent-lesson',
          summary: 'The same lesson.',
          evidence: ${JSON.stringify(`process-${index}`)}
        });
      `;
      return new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '-e', script],
          {
            cwd: join(import.meta.dirname, '..'),
            env: { ...process.env, MAJOR_LEARNING_ROOT: learningRoot() },
            stdio: ['ignore', 'ignore', 'pipe'],
          },
        );
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => (stderr += String(chunk)));
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`capture child exited ${code}: ${stderr}`)),
        );
      });
    });
    await Promise.all(captures);
    const [candidate] = listLearningCandidates('concurrent-project');
    expect(candidate?.occurrences).toBe(8);
    expect(candidate?.evidence).toHaveLength(8);
  }, 30_000);

  it('reclaims one stale store lock before concurrent captures without losing occurrences', async () => {
    const project = 'stale-lock-project';
    captureLearning({ project, source: 'manual', key: 'same-lesson', summary: 'The lesson.' });
    const projectFiles = readdirSync(join(learningRoot(), 'projects'));
    expect(projectFiles).toHaveLength(1);
    const projectFile = projectFiles[0]!;
    const lock = join(learningRoot(), 'projects', `${projectFile}.lock`);
    writeFileSync(lock, 'invalid-owner\n');
    const stale = new Date(Date.now() - 31_000);
    utimesSync(lock, stale, stale);

    const moduleUrl = pathToFileURL(
      join(import.meta.dirname, '..', 'src', 'learning', 'candidates.ts'),
    );
    const captures = Array.from({ length: 8 }, (_, index) => {
      const script = `
        import { captureLearning } from ${JSON.stringify(moduleUrl.href)};
        captureLearning({
          project: ${JSON.stringify(project)},
          source: 'recurring-failure',
          key: 'same-lesson',
          summary: 'The lesson.',
          evidence: ${JSON.stringify(`stale-process-${index}`)}
        });
      `;
      return new Promise<void>((resolve, reject) => {
        const child = spawn(
          process.execPath,
          ['--import', 'tsx', '--input-type=module', '-e', script],
          {
            cwd: join(import.meta.dirname, '..'),
            env: { ...process.env, MAJOR_LEARNING_ROOT: learningRoot() },
            stdio: ['ignore', 'ignore', 'pipe'],
          },
        );
        let stderr = '';
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (chunk) => (stderr += String(chunk)));
        child.once('error', reject);
        child.once('exit', (code) =>
          code === 0 ? resolve() : reject(new Error(`capture child exited ${code}: ${stderr}`)),
        );
      });
    });
    await Promise.all(captures);
    const [candidate] = listLearningCandidates(project);
    expect(candidate?.occurrences).toBe(9);
    expect(candidate?.evidence).toHaveLength(8);
  }, 30_000);

  it('waits for an installation migration lock before writing', async () => {
    const lock = join(learningRoot(), '.migration.lock');
    mkdirSync(learningRoot(), { recursive: true });
    writeFileSync(lock, 'installer\n');
    const moduleUrl = pathToFileURL(
      join(import.meta.dirname, '..', 'src', 'learning', 'candidates.ts'),
    );
    const script = `
      import { captureLearning } from ${JSON.stringify(moduleUrl.href)};
      captureLearning({ project: 'locked-project', source: 'manual', summary: 'Captured after migration.' });
    `;
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '-e', script],
      {
        cwd: join(import.meta.dirname, '..'),
        env: { ...process.env, MAJOR_LEARNING_ROOT: learningRoot() },
        stdio: ['ignore', 'ignore', 'pipe'],
      },
    );
    const completed = new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(listLearningCandidates('locked-project')).toEqual([]);
    unlinkSync(lock);
    expect(await completed).toBe(0);
    expect(listLearningCandidates('locked-project')[0]?.summary).toBe('Captured after migration.');
  });

  it('recovers an abandoned stale installation migration lock', () => {
    const lock = join(learningRoot(), '.migration.lock');
    mkdirSync(learningRoot(), { recursive: true });
    writeFileSync(lock, 'invalid-owner\n');
    const stale = new Date(Date.now() - 31_000);
    utimesSync(lock, stale, stale);

    captureLearning({
      project: 'recovered-project',
      source: 'manual',
      summary: 'Captured after stale migration recovery.',
    });

    expect(listLearningCandidates('recovered-project')).toHaveLength(1);
    expect(existsSync(lock)).toBe(false);
  });
});

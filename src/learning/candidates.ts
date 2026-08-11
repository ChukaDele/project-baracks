import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { majorHome } from '../supervisor/state.js';

export const LEARNING_SOURCES = [
  'user-correction',
  'recurring-failure',
  'successful-procedure',
  'manual',
] as const;
export type LearningSource = (typeof LEARNING_SOURCES)[number];

export const LEARNING_SCOPES = ['undecided', 'project', 'global'] as const;
export type LearningScope = (typeof LEARNING_SCOPES)[number];

export const LEARNING_STATUSES = ['candidate', 'promoted', 'dismissed'] as const;
export type LearningStatus = (typeof LEARNING_STATUSES)[number];

export interface LearningCandidate {
  id: string;
  key?: string | undefined;
  project?: string | undefined;
  repoPath?: string | undefined;
  source: LearningSource;
  summary: string;
  scope: LearningScope;
  occurrences: number;
  evidence: string[];
  status: LearningStatus;
  promotedToGlobalId?: string | undefined;
  createdAt: string;
  updatedAt: string;
}

export interface LearningCaptureInput {
  source: LearningSource;
  summary: string;
  key?: string | undefined;
  scope?: LearningScope | undefined;
  evidence?: string | undefined;
  project?: string | undefined;
  repoPath?: string | undefined;
}

interface LearningStore {
  version: 2;
  candidates: LearningCandidate[];
}

export function learningRoot(): string {
  return process.env.MAJOR_LEARNING_ROOT
    ? resolve(process.env.MAJOR_LEARNING_ROOT)
    : join(majorHome(), 'learning');
}

function emptyStore(): LearningStore {
  return { version: 2, candidates: [] };
}

function projectStorePath(project: string): string {
  const key = createHash('sha256').update(project).digest('hex').slice(0, 24);
  return join(learningRoot(), 'projects', `${key}.json`);
}

function globalStorePath(): string {
  return join(learningRoot(), 'global.json');
}

function readStore(path: string): LearningStore {
  if (!existsSync(path)) return emptyStore();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as LearningStore;
  if (parsed.version !== 2 || !Array.isArray(parsed.candidates)) {
    throw new Error(`invalid Major learning store: ${path}`);
  }
  return parsed;
}

function writeStore(path: string, store: LearningStore): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function migrationLockPath(): string {
  return join(learningRoot(), '.migration.lock');
}

function waitForMigration(deadline: number): void {
  const lock = migrationLockPath();
  while (existsSync(lock)) {
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for Major learning migration: ${lock}`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

function withStoreLock<T>(path: string, action: () => T): T {
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  const deadline = Date.now() + 5_000;
  let fd: number | undefined;
  while (fd === undefined) {
    waitForMigration(deadline);
    try {
      fd = openSync(lock, 'wx', 0o600);
      writeFileSync(fd, `${process.pid}\n`);
      if (existsSync(migrationLockPath())) {
        closeSync(fd);
        fd = undefined;
        unlinkSync(lock);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        if (Date.now() - statSync(lock).mtimeMs > 30_000) unlinkSync(lock);
      } catch (staleError) {
        if ((staleError as NodeJS.ErrnoException).code !== 'ENOENT') throw staleError;
      }
      if (Date.now() >= deadline)
        throw new Error(`timed out locking Major learning store: ${path}`);
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
    }
  }
  try {
    return action();
  } finally {
    closeSync(fd);
    unlinkSync(lock);
  }
}

function normalizedSummary(summary: string): string {
  return summary.trim().toLowerCase().replace(/\s+/g, ' ');
}

function normalizedKey(key: string | undefined): string | undefined {
  if (!key) return undefined;
  const value = key.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{1,79}$/.test(value)) {
    throw new Error('learning key must be 2-80 lowercase letters, numbers or hyphens');
  }
  return value;
}

function sameLesson(
  candidate: LearningCandidate,
  key: string | undefined,
  fingerprint: string,
): boolean {
  if (key) return candidate.key === key;
  if (candidate.key) return false;
  return normalizedSummary(candidate.summary) === fingerprint;
}

function requireProject(input: { project?: string | undefined; repoPath?: string | undefined }): {
  project: string;
  repoPath?: string;
} {
  const project = input.project?.trim();
  if (!project) throw new Error('project learning requires a project identity');
  return {
    project,
    ...(input.repoPath ? { repoPath: resolve(input.repoPath) } : {}),
  };
}

export function captureLearning(input: LearningCaptureInput): LearningCandidate {
  if (input.scope === 'global') {
    throw new Error('direct global capture is forbidden; capture project-local, then promote');
  }
  const summary = input.summary.trim();
  if (!summary) throw new Error('learning summary must not be empty');
  const identity = requireProject(input);
  const key = normalizedKey(input.key);
  const fingerprint = normalizedSummary(summary);
  const path = projectStorePath(identity.project);
  return withStoreLock(path, () => {
    const store = readStore(path);
    const existing = store.candidates.find(
      (candidate) => candidate.status === 'candidate' && sameLesson(candidate, key, fingerprint),
    );
    const now = new Date().toISOString();

    if (existing) {
      existing.occurrences += 1;
      existing.updatedAt = now;
      if (key && !existing.key) existing.key = key;
      if (input.scope === 'project' && existing.scope === 'undecided') existing.scope = 'project';
      if (input.evidence && !existing.evidence.includes(input.evidence)) {
        existing.evidence.push(input.evidence);
      }
      writeStore(path, store);
      return existing;
    }

    const candidate: LearningCandidate = {
      id: randomUUID(),
      source: input.source,
      summary,
      scope: input.scope ?? 'undecided',
      occurrences: 1,
      evidence: input.evidence ? [input.evidence] : [],
      status: 'candidate',
      project: identity.project,
      ...(identity.repoPath ? { repoPath: identity.repoPath } : {}),
      createdAt: now,
      updatedAt: now,
      ...(key ? { key } : {}),
    };
    store.candidates.push(candidate);
    writeStore(path, store);
    return candidate;
  });
}

function visibleGlobalCandidates(status?: LearningStatus): LearningCandidate[] {
  const store = readStore(globalStorePath());
  for (const candidate of store.candidates) {
    if (
      candidate.scope !== 'global' ||
      candidate.status !== 'promoted' ||
      candidate.project !== undefined ||
      candidate.repoPath !== undefined ||
      candidate.promotedToGlobalId !== undefined ||
      PII_PATTERNS.some(
        (rule) =>
          rule.test(candidate.summary) || candidate.evidence.some((item) => rule.test(item)),
      )
    ) {
      throw new Error(`unsafe or malformed global Major learning record: ${candidate.id}`);
    }
  }
  return store.candidates.filter((candidate) => !status || candidate.status === status);
}

export function listLearningCandidates(
  project?: string,
  status?: LearningStatus,
): LearningCandidate[] {
  const global = visibleGlobalCandidates(status);
  if (!project) return global;
  const local = readStore(projectStorePath(project)).candidates.filter((candidate) => {
    if (candidate.promotedToGlobalId) return false;
    return !status || candidate.status === status;
  });
  return [...global, ...local];
}

export function learningReviewDue(project: string): LearningCandidate[] {
  return readStore(projectStorePath(project)).candidates.filter(
    (candidate) => candidate.status === 'candidate' && candidate.occurrences >= 2,
  );
}

const PII_PATTERNS = [
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/i,
  /\b(?:\+?\d[\d\s().-]{7,}\d)\b/,
  /\b(?:https?:\/\/|git@|ssh:\/\/)/i,
  /(?:^|\s)(?:\/Users\/|\/home\/|[A-Za-z]:\\)/,
];

function assertSanitizedGlobalText(
  value: string,
  label: string,
  candidate: LearningCandidate,
): string {
  const text = value.trim();
  if (!text) throw new Error(`global promotion requires sanitized ${label}`);
  const forbidden = [
    candidate.project,
    candidate.repoPath,
    candidate.repoPath ? basename(candidate.repoPath) : undefined,
  ]
    .filter((item): item is string => Boolean(item))
    .map((item) => normalizedText(item));
  const normalized = normalizedText(text);
  if (
    forbidden.some((item) => ` ${normalized} `.includes(` ${item} `)) ||
    PII_PATTERNS.some((rule) => rule.test(text))
  ) {
    throw new Error(
      `global promotion ${label} is not sanitized: remove project identity, paths, URLs and PII`,
    );
  }
  return text;
}

function normalizedText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function promoteLearning(input: {
  id: string;
  project: string;
  scope: Exclude<LearningScope, 'undecided'>;
  evidence: string;
  summary?: string | undefined;
}): LearningCandidate {
  const projectPath = projectStorePath(input.project);
  return withStoreLock(projectPath, () => {
    const projectStore = readStore(projectPath);
    const candidate = projectStore.candidates.find((item) => item.id === input.id);
    if (!candidate)
      throw new Error(`learning candidate not found in project ${input.project}: ${input.id}`);
    if (candidate.status !== 'candidate') {
      throw new Error(`learning candidate ${input.id} is already ${candidate.status}`);
    }

    if (input.scope === 'project') {
      const evidence = input.evidence.trim();
      if (!evidence) throw new Error('promotion evidence is required');
      if (!candidate.evidence.includes(evidence)) candidate.evidence.push(evidence);
      candidate.status = 'promoted';
      candidate.scope = 'project';
      candidate.updatedAt = new Date().toISOString();
      writeStore(projectPath, projectStore);
      return candidate;
    }

    if (candidate.occurrences < 2) {
      throw new Error(
        'global promotion requires a recurring candidate with at least two occurrences',
      );
    }
    const summary = assertSanitizedGlobalText(input.summary ?? '', 'summary', candidate);
    const evidence = assertSanitizedGlobalText(input.evidence, 'evidence', candidate);
    const globalPath = globalStorePath();
    const now = new Date().toISOString();
    const promoted = withStoreLock(globalPath, () => {
      const globalStore = readStore(globalPath);
      const fingerprint = normalizedSummary(summary);
      const existing = globalStore.candidates.find(
        (item) => item.status === 'promoted' && sameLesson(item, candidate.key, fingerprint),
      );
      if (existing) {
        if (!existing.evidence.includes(evidence)) {
          existing.occurrences += candidate.occurrences;
          existing.evidence.push(evidence);
        }
        existing.updatedAt = now;
        writeStore(globalPath, globalStore);
        return existing;
      }
      const created: LearningCandidate = {
        id: randomUUID(),
        source: candidate.source,
        summary,
        scope: 'global',
        occurrences: candidate.occurrences,
        evidence: [evidence],
        status: 'promoted',
        createdAt: now,
        updatedAt: now,
        ...(candidate.key ? { key: candidate.key } : {}),
      };
      globalStore.candidates.push(created);
      writeStore(globalPath, globalStore);
      return created;
    });
    candidate.status = 'promoted';
    candidate.scope = 'project';
    candidate.promotedToGlobalId = promoted.id;
    candidate.updatedAt = now;
    writeStore(projectPath, projectStore);
    return promoted;
  });
}

export function dismissLearning(input: {
  id: string;
  project: string;
  evidence: string;
}): LearningCandidate {
  const evidence = input.evidence.trim();
  if (!evidence) throw new Error('dismissal evidence/reason is required');
  const path = projectStorePath(input.project);
  return withStoreLock(path, () => {
    const store = readStore(path);
    const candidate = store.candidates.find((item) => item.id === input.id);
    if (!candidate)
      throw new Error(`learning candidate not found in project ${input.project}: ${input.id}`);
    if (candidate.status !== 'candidate') {
      throw new Error(`learning candidate ${input.id} is already ${candidate.status}`);
    }
    candidate.status = 'dismissed';
    candidate.updatedAt = new Date().toISOString();
    if (!candidate.evidence.includes(evidence)) candidate.evidence.push(evidence);
    writeStore(path, store);
    return candidate;
  });
}

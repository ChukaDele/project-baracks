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
import { redactText } from '../security/redact.js';
import { getProjectPolicy, knownProjectIdentities } from '../supervisor/policy.js';
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

function readStore(path: string, redact = true): LearningStore {
  if (!existsSync(path)) return emptyStore();
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as LearningStore;
  if (parsed.version !== 2 || !Array.isArray(parsed.candidates)) {
    throw new Error(`invalid Major learning store: ${path}`);
  }
  if (!redact) return parsed;
  return {
    ...parsed,
    candidates: parsed.candidates.map((candidate) => ({
      ...candidate,
      summary: redactText(candidate.summary),
      evidence: candidate.evidence.map((item) => redactText(item)),
    })),
  };
}

function writeStore(path: string, store: LearningStore): void {
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  const sanitized: LearningStore = {
    ...store,
    candidates: store.candidates.map((candidate) => ({
      ...candidate,
      summary: redactText(candidate.summary),
      evidence: candidate.evidence.map((item) => redactText(item)),
    })),
  };
  writeFileSync(temp, `${JSON.stringify(sanitized, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
}

function migrationLockPath(): string {
  return join(learningRoot(), '.migration.lock');
}

function waitForMigration(deadline: number): void {
  const lock = migrationLockPath();
  while (existsSync(lock)) {
    try {
      const before = statSync(lock);
      if (Date.now() - before.mtimeMs > 30_000) {
        const owner = readFileSync(lock, 'utf8').trim();
        const pid = /^\d+$/.test(owner) ? Number.parseInt(owner, 10) : Number.NaN;
        if (!learningLockOwnerIsLive(pid)) {
          const after = statSync(lock);
          if (
            before.dev === after.dev &&
            before.ino === after.ino &&
            before.mtimeMs === after.mtimeMs
          ) {
            unlinkSync(lock);
            continue;
          }
        }
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') continue;
      throw error;
    }
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for Major learning migration: ${lock}`);
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
  }
}

export function learningLockOwnerIsLive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    if (code === 'ESRCH') return false;
    throw error;
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
      try {
        writeFileSync(fd, `${process.pid}\n`);
      } catch (error) {
        closeSync(fd);
        fd = undefined;
        try {
          unlinkSync(lock);
        } catch {
          // Preserve the original write failure.
        }
        throw error;
      }
      if (existsSync(migrationLockPath())) {
        closeSync(fd);
        fd = undefined;
        unlinkSync(lock);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      try {
        const before = statSync(lock);
        const lockText = readFileSync(lock, 'utf8').trim();
        const pid = Number.parseInt(lockText, 10);
        const live = learningLockOwnerIsLive(pid);
        if (!live && Date.now() - before.mtimeMs > 30_000) {
          const after = statSync(lock);
          if (
            before.dev === after.dev &&
            before.ino === after.ino &&
            before.mtimeMs === after.mtimeMs
          ) {
            unlinkSync(lock);
          }
        }
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
    try {
      unlinkSync(lock);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
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
  const summary = redactText(input.summary.trim());
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
      const evidence = input.evidence ? redactText(input.evidence) : undefined;
      if (evidence && !existing.evidence.includes(evidence)) {
        existing.evidence.push(evidence);
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
      evidence: input.evidence ? [redactText(input.evidence)] : [],
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
  const store = readStore(globalStorePath(), false);
  for (const candidate of store.candidates) {
    if (
      candidate.scope !== 'global' ||
      (candidate.status !== 'promoted' && candidate.status !== 'dismissed') ||
      candidate.project !== undefined ||
      candidate.repoPath !== undefined ||
      candidate.promotedToGlobalId !== undefined ||
      candidate.key !== undefined ||
      (candidate.status === 'promoted' &&
        (candidate.evidence.length < 1 ||
          candidate.evidence.some(
            (item) => !/^promotion-evidence-sha256:[a-f0-9]{64}$/.test(item),
          ))) ||
      (candidate.status === 'dismissed' &&
        (candidate.summary !== 'Retracted global learning.' ||
          candidate.evidence.length !== 1 ||
          !/^dismissal-reason-sha256:[a-f0-9]{64}$/.test(candidate.evidence[0] ?? '') ||
          candidate.occurrences !== 0)) ||
      unsafeGlobalText(candidate.summary)
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
  const allGlobal = visibleGlobalCandidates();
  const global = allGlobal.filter((candidate) => !status || candidate.status === status);
  if (!project) return global;
  const activeGlobalIds = new Set(
    allGlobal
      .filter((candidate) => candidate.status === 'promoted')
      .map((candidate) => candidate.id),
  );
  const local = readStore(projectStorePath(project)).candidates.filter((candidate) => {
    if (candidate.promotedToGlobalId && activeGlobalIds.has(candidate.promotedToGlobalId)) {
      return false;
    }
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
  /(?:^|[\s("'])(?:\/(?:Users|home|private|tmp|etc|opt|var)\/|[A-Za-z]:\\)/i,
  /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/,
  /\b(?:Ltd|Limited|LLC|Inc|Corp|Corporation|PLC)\b/i,
];

function unsafeGlobalText(text: string): boolean {
  return redactText(text) !== text || PII_PATTERNS.some((rule) => rule.test(text));
}

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
    ...knownProjectIdentities(),
  ]
    .filter((item): item is string => Boolean(item))
    .map((item) => normalizedText(item));
  const normalized = normalizedText(text);
  if (forbidden.some((item) => ` ${normalized} `.includes(` ${item} `)) || unsafeGlobalText(text)) {
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
      const evidence = redactText(input.evidence.trim());
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
    const policy = getProjectPolicy(input.project, candidate.repoPath ?? input.project);
    if (!policy.allowCrossProjectMemory) {
      throw new Error(`global promotion is forbidden by the project policy for ${input.project}`);
    }
    const summary = assertSanitizedGlobalText(input.summary ?? '', 'summary', candidate);
    const evidence = assertSanitizedGlobalText(input.evidence, 'evidence', candidate);
    const evidenceDigest = `promotion-evidence-sha256:${createHash('sha256')
      .update(evidence)
      .digest('hex')}`;
    const globalPath = globalStorePath();
    const now = new Date().toISOString();
    const promoted = withStoreLock(globalPath, () => {
      const globalStore = readStore(globalPath);
      const fingerprint = normalizedSummary(summary);
      const existing = globalStore.candidates.find(
        (item) => item.status === 'promoted' && normalizedSummary(item.summary) === fingerprint,
      );
      if (existing) {
        if (!existing.evidence.includes(evidenceDigest)) {
          existing.occurrences += candidate.occurrences;
          existing.evidence.push(evidenceDigest);
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
        evidence: [evidenceDigest],
        status: 'promoted',
        createdAt: now,
        updatedAt: now,
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

export function dismissGlobalLearning(input: { id: string; evidence: string }): LearningCandidate {
  if (!input.evidence.trim()) throw new Error('dismissal evidence/reason is required');
  const path = globalStorePath();
  return withStoreLock(path, () => {
    const store = readStore(path);
    const candidate = store.candidates.find((item) => item.id === input.id);
    if (!candidate) throw new Error(`global learning candidate not found: ${input.id}`);
    if (candidate.scope !== 'global' || candidate.status !== 'promoted') {
      throw new Error(`global learning candidate ${input.id} is already ${candidate.status}`);
    }
    candidate.status = 'dismissed';
    candidate.summary = 'Retracted global learning.';
    candidate.evidence = [
      `dismissal-reason-sha256:${createHash('sha256').update(input.evidence.trim()).digest('hex')}`,
    ];
    candidate.occurrences = 0;
    candidate.updatedAt = new Date().toISOString();
    delete candidate.key;
    delete candidate.project;
    delete candidate.repoPath;
    delete candidate.promotedToGlobalId;
    writeStore(path, store);
    return candidate;
  });
}

export function dismissLearning(input: {
  id: string;
  project: string;
  evidence: string;
}): LearningCandidate {
  const evidence = redactText(input.evidence.trim());
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

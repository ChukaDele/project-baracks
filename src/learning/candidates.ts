import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
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
  version: 1;
  candidates: LearningCandidate[];
}

export function learningPath(): string {
  return process.env.MAJOR_LEARNING_PATH
    ? resolve(process.env.MAJOR_LEARNING_PATH)
    : join(majorHome(), 'learning-candidates.json');
}

function readStore(): LearningStore {
  const path = learningPath();
  if (!existsSync(path)) return { version: 1, candidates: [] };

  const parsed = JSON.parse(readFileSync(path, 'utf8')) as LearningStore;
  if (parsed.version !== 1 || !Array.isArray(parsed.candidates)) {
    throw new Error(`invalid Major learning store: ${path}`);
  }
  return parsed;
}

function writeStore(store: LearningStore): void {
  const path = learningPath();
  mkdirSync(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(store, null, 2)}\n`, { mode: 0o600 });
  renameSync(temp, path);
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

function candidateMatches(
  candidate: LearningCandidate,
  key: string | undefined,
  fingerprint: string,
  input: LearningCaptureInput,
): boolean {
  if (candidate.status !== 'candidate') return false;

  if (key) {
    if (candidate.key !== key) return false;
  } else {
    if (candidate.key) return false;
    if (normalizedSummary(candidate.summary) !== fingerprint) return false;
  }

  if (candidate.scope === 'global') return true;
  if (input.scope === 'global') return true;
  return candidate.project === input.project;
}

function visibleToProject(candidate: LearningCandidate, project?: string): boolean {
  if (!project) return true;
  if (candidate.scope === 'global') return true;
  return candidate.project === project;
}

export function captureLearning(input: LearningCaptureInput): LearningCandidate {
  const summary = input.summary.trim();
  if (!summary) throw new Error('learning summary must not be empty');

  const key = normalizedKey(input.key);
  const fingerprint = normalizedSummary(summary);
  const store = readStore();
  const existing = store.candidates.find((candidate) => {
    return candidateMatches(candidate, key, fingerprint, input);
  });
  const now = new Date().toISOString();

  if (existing) {
    existing.occurrences += 1;
    existing.updatedAt = now;
    if (key && !existing.key) existing.key = key;
    if (input.scope === 'global') existing.scope = 'global';
    else if (input.scope && existing.scope === 'undecided') existing.scope = input.scope;
    if (input.evidence && !existing.evidence.includes(input.evidence)) {
      existing.evidence.push(input.evidence);
    }
    writeStore(store);
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
    createdAt: now,
    updatedAt: now,
    ...(key ? { key } : {}),
    ...(input.project ? { project: input.project } : {}),
    ...(input.repoPath ? { repoPath: resolve(input.repoPath) } : {}),
  };

  store.candidates.push(candidate);
  writeStore(store);
  return candidate;
}

export function listLearningCandidates(
  project?: string,
  status?: LearningStatus,
): LearningCandidate[] {
  return readStore().candidates.filter((candidate) => {
    if (!visibleToProject(candidate, project)) return false;
    if (status && candidate.status !== status) return false;
    return true;
  });
}

export function learningReviewDue(project?: string): LearningCandidate[] {
  const candidates = listLearningCandidates(project, 'candidate');
  return candidates.filter(({ occurrences }) => occurrences >= 2);
}

export function promoteLearning(input: {
  id: string;
  scope: Exclude<LearningScope, 'undecided'>;
  evidence?: string | undefined;
}): LearningCandidate {
  const store = readStore();
  const candidate = store.candidates.find((item) => item.id === input.id);
  if (!candidate) throw new Error(`learning candidate not found: ${input.id}`);
  if (candidate.status !== 'candidate') {
    throw new Error(`learning candidate ${input.id} is already ${candidate.status}`);
  }

  candidate.status = 'promoted';
  candidate.scope = input.scope;
  candidate.updatedAt = new Date().toISOString();
  if (input.evidence && !candidate.evidence.includes(input.evidence)) {
    candidate.evidence.push(input.evidence);
  }
  writeStore(store);
  return candidate;
}

export function dismissLearning(input: { id: string; evidence: string }): LearningCandidate {
  const evidence = input.evidence.trim();
  if (!evidence) throw new Error('dismissal evidence/reason is required');

  const store = readStore();
  const candidate = store.candidates.find((item) => item.id === input.id);
  if (!candidate) throw new Error(`learning candidate not found: ${input.id}`);
  if (candidate.status !== 'candidate') {
    throw new Error(`learning candidate ${input.id} is already ${candidate.status}`);
  }

  candidate.status = 'dismissed';
  candidate.updatedAt = new Date().toISOString();
  if (!candidate.evidence.includes(evidence)) candidate.evidence.push(evidence);
  writeStore(store);
  return candidate;
}

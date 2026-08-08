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

export interface LearningCandidate {
  id: string;
  project?: string | undefined;
  repoPath?: string | undefined;
  source: LearningSource;
  summary: string;
  scope: LearningScope;
  occurrences: number;
  evidence: string[];
  status: 'candidate' | 'promoted' | 'dismissed';
  createdAt: string;
  updatedAt: string;
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

export function captureLearning(input: {
  source: LearningSource;
  summary: string;
  scope?: LearningScope | undefined;
  evidence?: string | undefined;
  project?: string | undefined;
  repoPath?: string | undefined;
}): LearningCandidate {
  const summary = input.summary.trim();
  if (!summary) throw new Error('learning summary must not be empty');
  const store = readStore();
  const fingerprint = normalizedSummary(summary);
  const existing = store.candidates.find(
    (candidate) =>
      candidate.status === 'candidate' &&
      normalizedSummary(candidate.summary) === fingerprint &&
      (candidate.scope === 'global' || candidate.project === input.project),
  );
  const now = new Date().toISOString();
  if (existing) {
    existing.occurrences += 1;
    existing.updatedAt = now;
    if (input.scope && existing.scope === 'undecided') existing.scope = input.scope;
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
    ...(input.project ? { project: input.project } : {}),
    ...(input.repoPath ? { repoPath: resolve(input.repoPath) } : {}),
  };
  store.candidates.push(candidate);
  writeStore(store);
  return candidate;
}

export function listLearningCandidates(project?: string): LearningCandidate[] {
  return readStore().candidates.filter(
    (candidate) => !project || candidate.scope === 'global' || candidate.project === project,
  );
}

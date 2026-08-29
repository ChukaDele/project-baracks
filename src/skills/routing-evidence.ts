import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { majorHome } from '../supervisor/state.js';

export interface SkillRoutingEvidence {
  key: string;
  kind: 'miss' | 'rejection';
  taskDigest: string;
  requested: string[];
  occurrences: number;
  learningCandidate: boolean;
  lastReason: string;
  updatedAt: string;
}

function isSkillRoutingEvidence(value: unknown): value is SkillRoutingEvidence {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.key === 'string' &&
    (row.kind === 'miss' || row.kind === 'rejection') &&
    typeof row.taskDigest === 'string' &&
    Array.isArray(row.requested) &&
    row.requested.every((item) => typeof item === 'string') &&
    typeof row.occurrences === 'number' &&
    typeof row.learningCandidate === 'boolean' &&
    typeof row.lastReason === 'string' &&
    typeof row.updatedAt === 'string'
  );
}

export function recordSkillRoutingEvidence(input: {
  kind: 'miss' | 'rejection';
  task: string;
  requested?: readonly string[];
  reason: string;
}): SkillRoutingEvidence {
  const requested = [...(input.requested ?? [])].sort();
  const taskDigest = createHash('sha256')
    .update(input.task.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
  const key = `${input.kind}:${requested.join(',') || taskDigest}`;
  const path = join(majorHome(), 'learning', 'skill-routing-evidence.json');
  const stored: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
  const rows = Array.isArray(stored) ? stored.filter(isSkillRoutingEvidence) : [];
  const prior = rows.find((row) => row.key === key);
  const row: SkillRoutingEvidence = {
    key,
    kind: input.kind,
    taskDigest,
    requested,
    occurrences: (prior?.occurrences ?? 0) + 1,
    learningCandidate: (prior?.occurrences ?? 0) + 1 >= 2,
    lastReason: input.reason.slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
  const next = [...rows.filter((candidate) => candidate.key !== key), row];
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
  return row;
}

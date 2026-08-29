import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
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
  const requested = [...new Set(input.requested ?? [])]
    .map((value) => value.slice(0, 100))
    .sort()
    .slice(0, 16);
  const taskDigest = createHash('sha256')
    .update(input.task.trim().toLowerCase())
    .digest('hex')
    .slice(0, 16);
  const key = `${input.kind}:${requested.join(',') || taskDigest}`;
  const path = join(majorHome(), 'learning', 'skill-routing-evidence.json');
  mkdirSync(dirname(path), { recursive: true });
  const lock = `${path}.lock`;
  let descriptor: number | undefined;
  for (let attempt = 0; attempt < 100 && descriptor === undefined; attempt += 1) {
    try {
      descriptor = openSync(lock, 'wx', 0o600);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5);
    }
  }
  if (descriptor === undefined) throw new Error('skill routing evidence store is busy');
  try {
    const stored: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : [];
    const rows = Array.isArray(stored) ? stored.filter(isSkillRoutingEvidence) : [];
    const prior = rows.find((candidate) => candidate.key === key);
    const row: SkillRoutingEvidence = {
      key,
      kind: input.kind,
      taskDigest,
      requested,
      occurrences: Math.min((prior?.occurrences ?? 0) + 1, Number.MAX_SAFE_INTEGER),
      learningCandidate: (prior?.occurrences ?? 0) + 1 >= 2,
      lastReason: input.reason.slice(0, 500),
      updatedAt: new Date().toISOString(),
    };
    const next = [...rows.filter((candidate) => candidate.key !== key), row]
      .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
      .slice(-128);
    const temporary = `${path}.${process.pid}.tmp`;
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
    return row;
  } finally {
    closeSync(descriptor);
    unlinkSync(lock);
  }
}

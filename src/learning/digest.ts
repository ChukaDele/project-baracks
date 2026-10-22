import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import Database from 'better-sqlite3';
import { defaultDbPath } from '../db/client.js';
import { redactText } from '../security/redact.js';
import { majorHome, readSupervisorState } from '../supervisor/state.js';
import { allProjectLearningCandidates } from './candidates.js';
import { learningQueueDepth } from './queue.js';
import { isMajorSelfWork, selfWorkTargetPct } from './self-work.js';

/**
 * Weekly learning batch. Read-only: it proposes, it changes nothing. The owner
 * applies the accepted proposals in one batch PR instead of mid-task.
 */
export interface LearningDigest {
  generatedAt: string;
  since: string;
  reviewDue: Array<{
    id: string;
    project?: string | undefined;
    key?: string | undefined;
    source: string;
    occurrences: number;
    summary: string;
    evidence: string[];
  }>;
  unusedSkills: { generated: string[]; catalog: string[]; catalogTotal: number };
  repeatedFailures: Array<{
    signature: string;
    count: number;
    projects: string[];
    evidence: string;
  }>;
  failingProviders: Array<{ provider: string; failed: number; total: number }>;
  selfWork: {
    majorRuns: number;
    totalRuns: number;
    sharePct: number;
    targetPct: number;
    overTarget: boolean;
  };
  failedGoals: Array<{
    id: string;
    status: string;
    project: string;
    updatedAt: string;
    summary: string;
  }>;
  queue: { queued: number; failed: number };
  notes: string[];
}

export function parseSince(value: string | undefined, now = Date.now()): Date {
  if (!value || value === '7d') return new Date(now - 7 * 86_400_000);
  if (value === 'all') return new Date(0);
  const match = /^(\d+)([hd])$/.exec(value);
  if (!match) throw new Error('--since must be <N>d, <N>h or all');
  const unit = match[2] === 'd' ? 86_400_000 : 3_600_000;
  return new Date(now - Number(match[1]) * unit);
}

function clip(text: string | undefined, max = 200): string {
  const clean = redactText((text ?? '').replace(/\s+/g, ' ').trim());
  return clean.length <= max ? clean : `${clean.slice(0, max - 1)}…`;
}

function skillLifecycleRoot(): string {
  return process.env.MAJOR_SKILL_LIFECYCLE_ROOT
    ? resolve(process.env.MAJOR_SKILL_LIFECYCLE_ROOT)
    : join(majorHome(), 'skills');
}

function unusedGeneratedSkills(notes: string[]): string[] {
  const dir = join(skillLifecycleRoot(), 'candidates');
  if (!existsSync(dir)) return [];
  const unused: string[] = [];
  for (const name of readdirSync(dir).filter((item) => item.endsWith('.json'))) {
    try {
      const store = JSON.parse(readFileSync(join(dir, name), 'utf8')) as {
        candidates?: Array<{ skillId?: string; status?: string; performance?: { uses?: number } }>;
      };
      for (const entry of store.candidates ?? []) {
        if (entry.status === 'active' && (entry.performance?.uses ?? 0) === 0 && entry.skillId) {
          unused.push(entry.skillId);
        }
      }
    } catch {
      notes.push(`unreadable skill candidate store: ${name}`);
    }
  }
  return unused.sort();
}

function catalogSkillIds(path: string, notes: string[]): string[] {
  try {
    const catalog = JSON.parse(readFileSync(path, 'utf8')) as { entries?: Array<{ id?: string }> };
    return (catalog.entries ?? []).flatMap((entry) => (entry.id ? [entry.id] : []));
  } catch {
    notes.push(`skill catalog unavailable: ${path}`);
    return [];
  }
}

export function buildLearningDigest(input: {
  since?: string | undefined;
  selfWorkTarget?: string | undefined;
  catalogPath?: string | undefined;
  now?: number | undefined;
}): LearningDigest {
  const now = input.now ?? Date.now();
  const since = parseSince(input.since, now).toISOString();
  const notes: string[] = [];

  const learning = allProjectLearningCandidates();
  for (const store of learning.unreadableStores) notes.push(`unreadable learning store: ${store}`);
  const reviewDue = learning.candidates
    .filter((candidate) => candidate.status === 'candidate' && candidate.occurrences >= 2)
    .sort((left, right) => right.occurrences - left.occurrences)
    .map((candidate) => ({
      id: candidate.id,
      project: candidate.project,
      key: candidate.key,
      source: candidate.source,
      occurrences: candidate.occurrences,
      summary: clip(candidate.summary),
      evidence: candidate.evidence.slice(-3).map((item) => clip(item)),
    }));

  let observations: Array<{ project: string; receipt: Record<string, unknown> }> = [];
  let providerRows: Array<{ provider: string; failed: number; total: number }> = [];
  let runRows: Array<{
    name: string;
    repo_path: string;
    github_repo: string | null;
    runs: number;
  }> = [];
  const dbPath = defaultDbPath();
  if (!existsSync(dbPath)) notes.push(`Major database not found: ${dbPath}`);
  else {
    const sqlite = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      observations = (
        sqlite
          .prepare(
            'SELECT project, receipt_json FROM run_performance_observations WHERE recorded_at >= ?',
          )
          .all(since) as Array<{ project: string; receipt_json: string }>
      ).flatMap((row) => {
        try {
          return [
            {
              project: row.project,
              receipt: JSON.parse(row.receipt_json) as Record<string, unknown>,
            },
          ];
        } catch {
          return [];
        }
      });
      providerRows = sqlite
        .prepare(
          `SELECT p.name || ':' || p.account_label AS provider,
                  SUM(CASE WHEN r.status = 'failed' THEN 1 ELSE 0 END) AS failed,
                  COUNT(*) AS total
             FROM agent_runs r JOIN agent_providers p ON p.id = r.provider_id
            WHERE r.created_at >= ?
            GROUP BY 1 HAVING failed >= 2 ORDER BY failed DESC`,
        )
        .all(since) as typeof providerRows;
      runRows = sqlite
        .prepare(
          `SELECT pr.name, pr.repo_path, pr.github_repo, COUNT(*) AS runs
             FROM agent_runs r JOIN tasks t ON t.id = r.task_id JOIN projects pr ON pr.id = t.project_id
            WHERE r.created_at >= ?
            GROUP BY pr.id`,
        )
        .all(since) as typeof runRows;
    } finally {
      sqlite.close();
    }
  }

  const failures = new Map<string, { count: number; projects: Set<string>; evidence: string }>();
  const routedSkills = new Set<string>();
  for (const { project, receipt } of observations) {
    for (const skill of Array.isArray(receipt.skills) ? receipt.skills : []) {
      if (typeof skill === 'string') routedSkills.add(skill);
    }
    if (receipt.status !== 'failed' && receipt.status !== 'blocked') continue;
    const recurrence = receipt.recurrence as { signature?: string; evidence?: string } | undefined;
    if (!recurrence?.signature) continue;
    const entry = failures.get(recurrence.signature) ?? {
      count: 0,
      projects: new Set<string>(),
      evidence: clip(recurrence.evidence),
    };
    entry.count += 1;
    entry.projects.add(project);
    failures.set(recurrence.signature, entry);
  }
  const repeatedFailures = [...failures.entries()]
    .filter(([, entry]) => entry.count >= 2)
    .sort((left, right) => right[1].count - left[1].count)
    .map(([signature, entry]) => ({
      signature,
      count: entry.count,
      projects: [...entry.projects].sort(),
      evidence: entry.evidence,
    }));

  const catalog = catalogSkillIds(
    input.catalogPath ?? join(majorHome(), 'skills.catalog.json'),
    notes,
  );
  const unusedSkills = {
    generated: unusedGeneratedSkills(notes),
    catalog: catalog.filter((id) => !routedSkills.has(id)).sort(),
    catalogTotal: catalog.length,
  };

  const totalRuns = runRows.reduce((sum, row) => sum + row.runs, 0);
  const majorRuns = runRows
    .filter((row) =>
      isMajorSelfWork({ project: row.name, repoPath: row.repo_path, githubRepo: row.github_repo }),
    )
    .reduce((sum, row) => sum + row.runs, 0);
  const targetPct = selfWorkTargetPct(input.selfWorkTarget);
  const sharePct = totalRuns === 0 ? 0 : Math.round((majorRuns / totalRuns) * 1000) / 10;

  const failedGoals = readSupervisorState()
    .goals.filter((goal) => goal.status === 'failed' || goal.status === 'blocked')
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
    .map((goal) => ({
      id: goal.id,
      status: goal.status,
      project: goal.project,
      updatedAt: goal.updatedAt,
      summary: clip(goal.ownerGate ?? goal.lastSummary ?? goal.goal, 160),
    }));

  return {
    generatedAt: new Date(now).toISOString(),
    since,
    reviewDue,
    unusedSkills,
    repeatedFailures,
    failingProviders: providerRows,
    selfWork: { majorRuns, totalRuns, sharePct, targetPct, overTarget: sharePct > targetPct },
    failedGoals,
    queue: learningQueueDepth(),
    notes,
  };
}

export function formatLearningDigest(digest: LearningDigest): string {
  const lines = [
    `MAJOR LEARNING DIGEST (proposals only; nothing was changed) since ${digest.since}`,
    '',
    `Promote or dismiss (${digest.reviewDue.length} REVIEW-DUE, 2+ occurrences):`,
  ];
  for (const item of digest.reviewDue) {
    lines.push(
      `  - ${item.occurrences}x [${item.project ?? '-'}] ${item.key ?? item.id}: ${item.summary}`,
    );
    for (const evidence of item.evidence) lines.push(`      evidence: ${evidence}`);
  }
  lines.push(
    '',
    `Retire or reroute skills with 0 use: ${digest.unusedSkills.generated.length} generated, ` +
      `${digest.unusedSkills.catalog.length}/${digest.unusedSkills.catalogTotal} catalog skills never routed in window`,
  );
  if (digest.unusedSkills.generated.length > 0) {
    lines.push(`  generated: ${digest.unusedSkills.generated.join(', ')}`);
  }
  lines.push('', `Fix repeated failure keys (${digest.repeatedFailures.length}):`);
  for (const item of digest.repeatedFailures) {
    lines.push(
      `  - ${item.count}x ${item.signature} [${item.projects.join(', ')}]: ${item.evidence}`,
    );
  }
  lines.push('', `Check providers failing repeatedly (${digest.failingProviders.length}):`);
  for (const item of digest.failingProviders) {
    lines.push(`  - ${item.provider}: ${item.failed}/${item.total} runs failed`);
  }
  const self = digest.selfWork;
  lines.push(
    '',
    `Major self-work: ${self.majorRuns}/${self.totalRuns} runs = ${self.sharePct}% ` +
      `(target ${self.targetPct}%)${self.overTarget ? ' — OVER TARGET: defer Major work to the weekly batch' : ''}`,
    '',
    `Failed/blocked goals (${digest.failedGoals.length}):`,
  );
  for (const goal of digest.failedGoals) {
    lines.push(
      `  - ${goal.status} ${goal.updatedAt.slice(0, 10)} ${goal.id.slice(0, 8)} [${goal.project}]: ${goal.summary}`,
    );
  }
  lines.push(
    '',
    `Learning queue: ${digest.queue.queued} queued, ${digest.queue.failed} dead-lettered`,
  );
  for (const note of digest.notes) lines.push(`note: ${note}`);
  return lines.join('\n');
}

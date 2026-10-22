import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { and, eq, isNotNull, lte } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { decisionRequests, projects } from '../db/schema.js';
import { expireStaleDecisions } from '../domain/decision-service.js';
import {
  isLiveWorkerFresh,
  majorHome,
  pidAlive,
  readSupervisorState,
  removeGoals,
  type SupervisorGoal,
} from '../supervisor/state.js';
import {
  listProjectPolicies,
  removeProjectPolicies,
  type ProjectPolicy,
} from '../supervisor/policy.js';

type ProjectRow = typeof projects.$inferSelect;

export interface RegistryGcPlan {
  goals: SupervisorGoal[];
  policies: ProjectPolicy[];
  projects: ProjectRow[];
  expiredDecisions: number;
}

export interface RegistryGcResult extends RegistryGcPlan {
  archivePath?: string;
  /** DB project rows kept because history (tasks, runs, decisions) references them. */
  retainedProjects: string[];
}

const pathExists = (path: string) => existsSync(resolve(path));
const policyKey = (policy: ProjectPolicy) => `${policy.project}\0${resolve(policy.repoPath)}`;

/**
 * Registry entries whose repoPath no longer exists on disk. An entry is kept
 * while its project identity still has any existing path (a moved worktree is
 * rebound by admission, and its policy carries owner-granted trust), and a
 * goal is kept while a live cycle PID or fresh live-worker claim holds it.
 */
export function planRegistryGc(db: Db, now: Date = new Date()): RegistryGcPlan {
  const goals = readSupervisorState().goals;
  const policies = listProjectPolicies();
  const rows = db.select().from(projects).all();
  const liveIdentities = new Set<string>();
  for (const entry of [
    ...goals.map((g) => ({ project: g.project, repoPath: g.repoPath })),
    ...policies,
    ...rows.map((r) => ({ project: r.name, repoPath: r.repoPath })),
  ]) {
    if (pathExists(entry.repoPath)) liveIdentities.add(entry.project);
  }
  const gone = (project: string, repoPath: string) =>
    !pathExists(repoPath) && !liveIdentities.has(project);
  const nowStamp = now.toISOString();
  return {
    goals: goals.filter(
      (goal) =>
        !pathExists(goal.repoPath) &&
        !(goal.activePid !== undefined && pidAlive(goal.activePid)) &&
        !(goal.liveWorker && isLiveWorkerFresh(goal.liveWorker, () => now)) &&
        (['done', 'failed', 'paused'].includes(goal.status) || !liveIdentities.has(goal.project)),
    ),
    policies: policies.filter((policy) => gone(policy.project, policy.repoPath)),
    projects: rows.filter((row) => gone(row.name, row.repoPath)),
    expiredDecisions: db
      .select({ id: decisionRequests.id })
      .from(decisionRequests)
      .where(
        and(
          eq(decisionRequests.status, 'open'),
          isNotNull(decisionRequests.expiresAt),
          lte(decisionRequests.expiresAt, nowStamp),
        ),
      )
      .all().length,
  };
}

/** Write the plan to `<majorHome>/archive/` first, then remove the entries. */
export function applyRegistryGc(
  db: Db,
  plan: RegistryGcPlan,
  now: Date = new Date(),
): RegistryGcResult {
  const expiredDecisions = expireStaleDecisions(db, now);
  if (plan.goals.length + plan.policies.length + plan.projects.length === 0) {
    return { ...plan, expiredDecisions, retainedProjects: [] };
  }
  const dir = join(majorHome(), 'archive');
  mkdirSync(dir, { recursive: true });
  const archivePath = join(dir, `registry-gc-${now.toISOString().replace(/[:.]/g, '-')}.json`);
  writeFileSync(
    archivePath,
    `${JSON.stringify({ archivedAt: now.toISOString(), reason: 'repoPath missing', goals: plan.goals, policies: plan.policies, projects: plan.projects }, null, 2)}\n`,
    { mode: 0o600 },
  );
  // Re-check existence at removal time: never GC a path that (re)appeared.
  const goals = removeGoals(
    new Set(plan.goals.filter((g) => !pathExists(g.repoPath)).map((g) => g.id)),
  );
  const policyKeys = new Set(plan.policies.filter((p) => !pathExists(p.repoPath)).map(policyKey));
  const policies = removeProjectPolicies((policy) => policyKeys.has(policyKey(policy)));
  const removedProjects: ProjectRow[] = [];
  const retainedProjects: string[] = [];
  for (const row of plan.projects) {
    if (pathExists(row.repoPath)) continue;
    try {
      db.delete(projects).where(eq(projects.id, row.id)).run();
      removedProjects.push(row);
    } catch {
      retainedProjects.push(row.name); // foreign-key history keeps the row
    }
  }
  return {
    goals,
    policies,
    projects: removedProjects,
    expiredDecisions,
    archivePath,
    retainedProjects,
  };
}

export function formatRegistryGc(
  result: RegistryGcPlan | RegistryGcResult,
  dryRun: boolean,
): string {
  const verb = dryRun ? 'would archive' : 'archived';
  const lines = [
    `registry: ${verb} ${result.goals.length} goal(s), ${result.policies.length} policy(ies), ${result.projects.length} project row(s) with missing repoPath; ${dryRun ? 'would expire' : 'expired'} ${result.expiredDecisions} decision(s)`,
  ];
  for (const goal of result.goals)
    lines.push(`  goal ${goal.id} ${goal.project} [${goal.status}] ${goal.repoPath}`);
  for (const policy of result.policies) lines.push(`  policy ${policy.project} ${policy.repoPath}`);
  for (const row of result.projects) lines.push(`  project ${row.name} ${row.repoPath}`);
  if ('retainedProjects' in result && result.retainedProjects.length > 0) {
    lines.push(`  retained (referenced by history): ${result.retainedProjects.join(', ')}`);
  }
  if ('archivePath' in result && result.archivePath) lines.push(`  archive: ${result.archivePath}`);
  return lines.join('\n');
}

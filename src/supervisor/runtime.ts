import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from '../db/client.js';
import { listLearningCandidates } from '../learning/candidates.js';
import { loadPersistedProviderInfos, recordModelOutcome } from '../providers/discovery-store.js';
import type { ProviderInfo } from '../providers/types.js';
import { route } from '../routing/router.js';
import { resolveSkills } from '../skills/resolver.js';
import { redactText } from '../security/redact.js';
import {
  assertExecutionAllowed,
  getProjectPolicy,
  globalStopRequested,
  type ProjectPolicy,
} from './policy.js';
import {
  activeGoals,
  getGoal,
  majorHome,
  readSupervisorState,
  updateGoal,
  type SupervisorGoal,
  type WorkerHost,
} from './state.js';
import { hostAvailable, runWorker } from './worker.js';

function trim(text: string, max = 12_000): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

function readProjectContext(repoPath: string): string {
  const candidates = [
    'GOAL_STATE.md',
    'STATUS.md',
    'PROJECT.md',
    'BUILD_PLAN.md',
    'LEARNINGS.md',
    'SKILLS.md',
    'QUALITY.md',
    'DESIGN.md',
    'ARCHITECTURE.md',
    'AGENTS.md',
  ];
  const sections: string[] = [];
  for (const name of candidates) {
    const path = join(repoPath, name);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    sections.push(`\n===== ${name} =====\n${content.slice(0, 12_000)}`);
  }
  return sections.join('\n');
}

function readLearningContext(project: string): string {
  const candidates = listLearningCandidates(project)
    .filter((candidate) => candidate.status !== 'dismissed')
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'promoted' ? -1 : 1;
      if (right.occurrences !== left.occurrences) return right.occurrences - left.occurrences;
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .slice(0, 20);
  if (candidates.length === 0) return '(No active Major learning candidates for this project.)';
  return candidates
    .map(
      (candidate) =>
        `- ${candidate.status.toUpperCase()} ${candidate.occurrences}x [${candidate.scope}/${candidate.source}] ${candidate.summary}`,
    )
    .join('\n');
}

const PROVIDER_HOSTS: Record<string, WorkerHost> = {
  'claude-code': 'claude',
  codex: 'codex',
  cursor: 'cursor',
  antigravity: 'antigravity',
};

const HOST_PROVIDERS: Record<WorkerHost, string> = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  antigravity: 'antigravity',
};

export type CoordinatorSelection =
  | { kind: 'route'; host: WorkerHost; provider: string; modelRef: string; reason: string }
  | { kind: 'checkpoint'; reason: string };

export interface WorkerReport {
  status: 'active' | 'blocked' | 'done';
  summary: string;
  ownerGate?: string;
}

const WORKER_REPORT_PREFIX = 'MAJOR_RESULT: ';

function addStringLines(value: unknown, lines: string[]): void {
  if (typeof value === 'string') {
    for (const line of value.split(/\r?\n/)) {
      if (lines.length >= 500) break;
      lines.push(line.trim());
    }
  }
}

function collectProviderResultLines(value: unknown, lines: string[]): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return;
  const event = value as Record<string, unknown>;
  if (event.type === 'result') {
    addStringLines(event.result, lines);
    return;
  }
  if (event.type === 'item.completed' && event.item && typeof event.item === 'object') {
    const item = event.item as Record<string, unknown>;
    if (item.type === 'agent_message') addStringLines(item.text, lines);
    return;
  }
  if (event.type === 'assistant' && event.message && typeof event.message === 'object') {
    const content = (event.message as Record<string, unknown>).content;
    if (!Array.isArray(content)) return;
    for (const block of content) {
      if (block && typeof block === 'object') {
        const candidate = block as Record<string, unknown>;
        if (candidate.type === undefined || candidate.type === 'text') {
          addStringLines(candidate.text, lines);
        }
      }
    }
  }
}

function workerOutputLines(output: string): string[] {
  const lines: string[] = [];
  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    lines.push(line);
    try {
      collectProviderResultLines(JSON.parse(line), lines);
    } catch {
      // Plain provider output remains eligible below.
    }
  }
  return lines;
}

/** Parse the final bounded worker report. The parent remains the only process
 * allowed to mutate Major's control state. Provider CLIs return different
 * JSON/JSONL envelopes, so only known assistant-result fields are inspected.
 * Tool and user-message payloads are never eligible completion authority. */
export function parseWorkerReport(output: string): WorkerReport | undefined {
  const line = workerOutputLines(output)
    .reverse()
    .find((candidate) => candidate.startsWith(WORKER_REPORT_PREFIX));
  if (!line) return undefined;
  try {
    const value = JSON.parse(line.slice(WORKER_REPORT_PREFIX.length)) as Record<string, unknown>;
    if (!['active', 'blocked', 'done'].includes(String(value.status))) return undefined;
    if (typeof value.summary !== 'string' || value.summary.trim().length === 0) return undefined;
    const summary = redactText(value.summary.trim()).slice(0, 12_000);
    const ownerGate =
      typeof value.ownerGate === 'string' ? redactText(value.ownerGate.trim()).slice(0, 4_000) : '';
    if (value.status === 'blocked' && !ownerGate) return undefined;
    return {
      status: value.status as WorkerReport['status'],
      summary,
      ...(ownerGate ? { ownerGate } : {}),
    };
  } catch {
    return undefined;
  }
}

export function selectCoordinator(
  goal: SupervisorGoal,
  providers: ProviderInfo[],
): CoordinatorSelection {
  const preferred = HOST_PROVIDERS[goal.preferredCoordinator];
  const ordered = [...providers].sort((left, right) => {
    if (left.name === preferred) return -1;
    if (right.name === preferred) return 1;
    return left.name.localeCompare(right.name);
  });
  const decision = route({ purpose: 'analysis', complexity: 'architectural' }, ordered);
  if (decision.kind === 'checkpoint') return decision;
  const host = PROVIDER_HOSTS[decision.provider];
  if (!host) return { kind: 'checkpoint', reason: `unsupported provider: ${decision.provider}` };
  return {
    kind: 'route',
    host,
    provider: decision.provider,
    modelRef: decision.modelRef,
    reason: decision.reason,
  };
}

function trustContract(policy: ProjectPolicy): string {
  const external = policy.allowExternalWrites
    ? 'External writes may occur only when already authorized by project/user policy.'
    : 'Do not mutate external/production systems. Keep work local, in branches/worktrees, tests, previews, or read-only inspection.';
  const memory = policy.allowCrossProjectMemory
    ? 'Sanitized reusable lessons may be proposed for global Major learning.'
    : 'Do not promote project data into cross-project memory.';

  return `PROJECT TRUST PROFILE:
- class: ${policy.projectClass}
- trust: ${policy.trust}
- maximum concurrent workers: ${policy.maxWorkers}
- hard global active-resource ceiling: 6 across the full task tree
- subagent depth: maximum 1; delegated reviewers are leaf workers
- browser budget: maximum 2 contexts total (one visible and one headless)
- build budget: maximum 1 production build at a time
- maximum coordinator run: ${policy.maxRunMinutes} minutes
- background/unattended execution: ${policy.allowBackground ? 'allowed' : 'not allowed'}
- paid spend: ${policy.allowPaidSpend ? 'explicitly allowed' : 'not allowed'}
- ${external}
- ${memory}
- Client data and PII stay inside the project boundary. Never use client/candidate data as global training/memory material.`;
}

export function coordinatorPrompt(goal: SupervisorGoal): string {
  const context = readProjectContext(goal.repoPath);
  const learningContext = readLearningContext(goal.project);
  const resolvedSkills = resolveSkills({ task: goal.goal, cwd: goal.repoPath }).skills;
  const skillContext =
    resolvedSkills.length === 0
      ? '(No installed skill matched deterministically. Inspect the registry before inventing a new workflow.)'
      : resolvedSkills.map((skill) => `- ${skill.id}: ${skill.path}`).join('\n');
  const policy = getProjectPolicy(goal.project, goal.repoPath);
  const workerLanguage =
    policy.maxWorkers <= 1
      ? 'Keep this single-worker unless a genuine blocker requires escalation.'
      : `Use up to ${policy.maxWorkers} useful workers when work is genuinely independent. Do not spawn redundant workers.`;

  return `You are the active Major coordinator for project ${goal.project}.

BOTTOM LINE: own this goal until the smallest credible end-to-end outcome is demonstrated or a genuine owner-only gate remains.

GOAL:
${goal.goal}

CANONICAL TARGET:
- project: ${goal.project}
- repository path: ${goal.repoPath}

Before any substantive mutation, verify that the current Git root/remote and the task's named or implied target agree with this canonical target. If the task clearly belongs to another known project, do not patch this repository. Use project-context-integrity and reroute to the correct repository when unambiguous; ask only if the target is genuinely ambiguous. A correct fix in the wrong repository is a failed task.

${trustContract(policy)}

MAJOR OPERATING CONTRACT:
- Speed and MVP are the default. Reduce broad scope to the smallest end-to-end P0 that proves value, then keep expanding only while P0 gaps remain.
- Do not stop after one PR, migration, fix, test, or subtask. After each result ask: what is now the highest-impact missing piece blocking the goal?
- ${workerLanguage}
- Before inventing a process, resolve the smallest relevant Major skill set and load the actual skill bodies from project skills or $HOME/.major/skills/internal.
- Read project LEARNINGS.md and the Major learning candidates below before acting. Do not repeat a captured correction merely because a fresh worker lacks chat history.
- Prefer the smallest capable tool/skill before creating more orchestration. If a short deterministic script can retrieve/filter/dedupe/transform data more reliably than repeated model turns, use Tools-as-Code.
- For substantial UI/website creation, redesign, art-direction changes, or "generic/AI-looking/too safe/too loud" feedback, use design-direction-and-taste first. It is the single Major art-direction/taste authority; do not stack competing generic taste systems.
- For MCP/connectors/plugins, distinguish installed → configured → exposed → authenticated → permissioned → operational → integrated. Use mcp-integration-ops and prove the needed state with a representative real operation.
- For customer-facing website QA, use website-design-qa. Pair responsive-motion-systems for GSAP/ScrollTrigger/sticky/pinned/Three.js or viewport-motion work. Respect remote-first-web-development for browser preview/acceptance unless the owner explicitly permits a local exception.
- Reuse an existing tested skill when one matches. When a novel procedure succeeds and is likely reusable, Skillify rather than growing the permanent supervisor workflow.
- An explicit user correction, repeated mistake, or credible user evidence contradicting the agent is a learning event: fix and verify the real task first, then capture it with major learn capture. A candidate recurring twice must be promoted or explicitly classified as unstable/project-specific.
- Reserve Major capacity before every worker, browser, or build. Queue when capacity or memory pressure blocks admission.
- Delegate independent work across providers with the Major CLI only within the project trust limit. Delegated workers must not create descendants beyond depth 1.
- Prefer lower-cost/abundant subscription capacity for bounded tasks. Use stronger reasoning for architecture, hard bugs, integration, and adjudication.
- Concurrent writers must use isolated worktrees. Keep one integration owner.
- Validate with objective evidence: browser/runtime behavior, tests, persisted state, exact SHA/PR, provider response, or deployed result.
- After two materially unchanged failures, change strategy/provider/tool.
- Continue independent work around a blocked dependency.
- Never fabricate external success, submissions, provider state, or user data just to satisfy a test.
- Stop only for a genuine owner gate: MFA/CAPTCHA, unavailable credentials, new paid spend, destructive production data, DNS/ownership, or irreversible security-policy changes.
- Push back briefly when a requested path is contradicted by stronger known project truth. Prefer correct reversible rerouting over blind obedience.
- Keep communication BLUF and concise.

READINESS LANGUAGE:
- BUILT = implementation exists.
- VALIDATED = deterministic checks plus an independent grader support the claim.
- READY = a representative real-world outcome has succeeded under the intended trust profile.
Never use these terms interchangeably.

DURABLE CONTROL:
You cannot access or mutate Major's global control state. Before ending, emit exactly one final
single-line result for the parent coordinator to validate and apply:
  MAJOR_RESULT: {"status":"active","summary":"what now works and next critical path"}
  MAJOR_RESULT: {"status":"done","summary":"objective completion evidence"}
  MAJOR_RESULT: {"status":"blocked","summary":"what is complete","ownerGate":"exact owner action"}
Do not mark done unless the end-to-end goal is demonstrably true. A done claim still requires independent grading before trust promotion.

ACTIVE MAJOR LEARNINGS:
${learningContext}

RESOLVED MAJOR SKILLS:
${skillContext}

CURRENT PROJECT CONTEXT:
${context || '(No canonical project context files found. Inspect the repository directly.)'}
`;
}

/** Acquire the single integration-owner slot for a repository. This prevents
 * two goals, aliases, manual invocations, or daemon cycles from concurrently
 * writing the same working tree. Delegated writers still require worktrees. */
export function tryAcquireRepoCycleLock(repoPath: string): (() => void) | undefined {
  const dir = join(majorHome(), 'supervisor-repo-locks');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const key = createHash('sha256').update(resolve(repoPath)).digest('hex').slice(0, 32);
  const path = join(dir, `${key}.pid`);
  if (existsSync(path)) {
    const prior = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    if (Number.isFinite(prior) && pidAlive(prior)) return undefined;
    unlinkSync(path);
  }
  let fd: number;
  try {
    fd = openSync(path, 'wx', 0o600);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return undefined;
    throw error;
  }
  writeFileSync(fd, `${process.pid}\n`);
  closeSync(fd);
  return () => {
    try {
      if (existsSync(path) && readFileSync(path, 'utf8').trim() === String(process.pid)) {
        unlinkSync(path);
      }
    } catch {
      // Best effort. A stale lock is reclaimed after this process exits.
    }
  };
}

export async function runGoalCycle(goalId: string): Promise<void> {
  const goal = getGoal(goalId);
  if (!goal) throw new Error(`goal not found: ${goalId}`);
  if (goal.status === 'done' || goal.status === 'paused') return;
  if (goal.pendingCompletion) {
    console.error(`Goal ${goal.id} is awaiting an independent completion grade.`);
    return;
  }
  const releaseRepoLock = tryAcquireRepoCycleLock(goal.repoPath);
  if (!releaseRepoLock) {
    console.error(`Repository ${goal.repoPath} already has an active Major integration owner.`);
    return;
  }
  try {
    await runLockedGoalCycle(goal);
  } finally {
    releaseRepoLock();
  }
}

async function runLockedGoalCycle(goal: SupervisorGoal): Promise<void> {
  const policy = getProjectPolicy(goal.project, goal.repoPath);
  assertExecutionAllowed(policy);

  const providerState = openDb();
  let selection: CoordinatorSelection;
  try {
    selection = selectCoordinator(goal, loadPersistedProviderInfos(providerState.db));
  } finally {
    providerState.sqlite.close();
  }
  if (selection.kind === 'checkpoint') {
    const summary = `Provider routing checkpoint: ${selection.reason}`;
    updateGoal(goal.id, {
      status: 'active',
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary: summary,
      nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    });
    console.error(summary);
    return;
  }
  if (!hostAvailable(selection.host)) {
    const summary =
      `Provider routing checkpoint: ${selection.provider}/${selection.modelRef} is persisted as ` +
      'available but its CLI is not currently on PATH. Run major doctor to refresh discovery.';
    updateGoal(goal.id, {
      status: 'active',
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary: summary,
      nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    });
    console.error(summary);
    return;
  }
  const host = selection.host;
  updateGoal(goal.id, {
    status: 'running',
    cycle: goal.cycle + 1,
    lastStartedAt: new Date().toISOString(),
    activePid: process.pid,
    lastCoordinator: host,
    pendingCompletion: undefined,
  });

  const outcome = await runWorker({
    host,
    prompt: coordinatorPrompt(goal),
    cwd: goal.repoPath,
    timeoutMs: Math.max(1, policy.maxRunMinutes) * 60 * 1000,
    modelRef: selection.modelRef,
  });
  if (outcome.rateLimited || outcome.exhausted || outcome.status === 'succeeded') {
    const outcomeState = openDb();
    try {
      recordModelOutcome(outcomeState.db, {
        providerName: selection.provider,
        modelRef: selection.modelRef,
        outcome: outcome.exhausted
          ? 'exhausted'
          : outcome.rateLimited
            ? 'rate_limited'
            : 'available',
      });
    } finally {
      outcomeState.sqlite.close();
    }
  }
  const after = getGoal(goal.id);
  if (!after) return;
  if (after.status === 'done' || after.status === 'blocked' || after.status === 'paused') {
    updateGoal(goal.id, { activePid: undefined, lastFinishedAt: new Date().toISOString() });
    return;
  }

  if (outcome.status === 'succeeded') {
    const report = parseWorkerReport(outcome.stdout);
    if (report?.status === 'blocked') {
      updateGoal(goal.id, {
        status: 'blocked',
        consecutiveFailures: 0,
        activePid: undefined,
        lastFinishedAt: new Date().toISOString(),
        lastSummary: report.summary,
        ownerGate: report.ownerGate,
        pendingCompletion: undefined,
      });
      return;
    }
    if (report?.status === 'done') {
      const claimedAt = new Date().toISOString();
      updateGoal(goal.id, {
        status: 'active',
        consecutiveFailures: 0,
        activePid: undefined,
        lastFinishedAt: claimedAt,
        lastSummary: `Worker completion claim awaiting independent validation: ${report.summary}`,
        nextRunAt: undefined,
        pendingCompletion: { summary: report.summary, coordinator: host, claimedAt },
      });
      return;
    }
    updateGoal(goal.id, {
      status: 'active',
      consecutiveFailures: 0,
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary:
        report?.summary ??
        trim(outcome.stdout || 'Coordinator cycle completed without an explicit Major report.'),
      nextRunAt: new Date(Date.now() + 10_000).toISOString(),
      pendingCompletion: undefined,
    });
  } else {
    const failures = after.consecutiveFailures + 1;
    updateGoal(goal.id, {
      status: failures >= 6 ? 'failed' : 'active',
      consecutiveFailures: failures,
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary: trim(outcome.stderr || outcome.stdout || `Coordinator ${host} failed.`),
      nextRunAt: new Date(Date.now() + Math.min(60_000, failures * 10_000)).toISOString(),
      pendingCompletion: undefined,
    });
  }
}

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function acquireDaemonLock(): number | undefined {
  mkdirSync(majorHome(), { recursive: true });
  const path = join(majorHome(), 'supervisor-daemon.pid');
  if (existsSync(path)) {
    const prior = Number.parseInt(readFileSync(path, 'utf8').trim(), 10);
    if (Number.isFinite(prior) && pidAlive(prior)) return undefined;
    unlinkSync(path);
  }
  const fd = openSync(path, 'wx', 0o600);
  writeFileSync(fd, `${process.pid}\n`);
  closeSync(fd);
  return process.pid;
}

export async function runDaemon(): Promise<void> {
  if (acquireDaemonLock() === undefined) return;
  const lockPath = join(majorHome(), 'supervisor-daemon.pid');
  const cleanup = () => {
    try {
      if (existsSync(lockPath) && readFileSync(lockPath, 'utf8').trim() === String(process.pid))
        unlinkSync(lockPath);
    } catch {
      // best effort
    }
  };
  process.once('SIGTERM', () => {
    cleanup();
    process.exit(0);
  });
  process.once('SIGINT', () => {
    cleanup();
    process.exit(0);
  });

  for (;;) {
    if (globalStopRequested()) {
      await new Promise((resolveSleep) => setTimeout(resolveSleep, 2_000));
      continue;
    }
    const now = Date.now();
    const candidates = activeGoals().filter((goal) => {
      const policy = getProjectPolicy(goal.project, goal.repoPath);
      if (policy.trust !== 'unattended' || !policy.allowBackground) return false;
      if (!goal.autonomous || goal.status === 'blocked') return false;
      if (goal.pendingCompletion) return false;
      if (goal.activePid && pidAlive(goal.activePid)) return false;
      return !goal.nextRunAt || Date.parse(goal.nextRunAt) <= now;
    });
    await Promise.all(candidates.map(async (goal) => runGoalCycle(goal.id)));
    await new Promise((resolveSleep) => setTimeout(resolveSleep, 10_000));
  }
}

export function supervisorSnapshot(project?: string): string {
  const state = readSupervisorState();
  const goals = state.goals.filter((goal) => project === undefined || goal.project === project);
  if (goals.length === 0) return 'No Major goals found.';
  return goals
    .map((goal) => {
      const policy = getProjectPolicy(goal.project, goal.repoPath);
      const lines = [
        `${goal.project}: ${goal.status.toUpperCase()} — ${goal.goal}`,
        `policy=${policy.projectClass}/${policy.trust} maxWorkers=${policy.maxWorkers} maxRunMinutes=${policy.maxRunMinutes} background=${policy.allowBackground ? 'yes' : 'no'}`,
        `shadow=${policy.shadowPasses}/3 consecutive passes (${policy.shadowRuns} total)`,
        `goal=${goal.id} cycle=${goal.cycle} failures=${goal.consecutiveFailures}`,
      ];
      if (goal.lastSummary) lines.push(`last: ${trim(goal.lastSummary, 1_500)}`);
      if (goal.pendingCompletion) {
        lines.push(
          `completion: awaiting independent grade of ${goal.pendingCompletion.coordinator} claim`,
        );
      }
      if (goal.ownerGate) lines.push(`OWNER GATE: ${goal.ownerGate}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

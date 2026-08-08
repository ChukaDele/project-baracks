import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
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

const COORDINATOR_ORDER: WorkerHost[] = ['claude', 'codex', 'cursor', 'antigravity'];

function trim(text: string, max = 12_000): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

function readProjectContext(repoPath: string): string {
  const candidates = ['GOAL_STATE.md', 'STATUS.md', 'PROJECT.md', 'BUILD_PLAN.md', 'AGENTS.md'];
  const sections: string[] = [];
  for (const name of candidates) {
    const path = join(repoPath, name);
    if (!existsSync(path)) continue;
    const content = readFileSync(path, 'utf8');
    sections.push(`\n===== ${name} =====\n${content.slice(0, 12_000)}`);
  }
  return sections.join('\n');
}

function coordinatorFor(goal: SupervisorGoal): WorkerHost {
  const available = COORDINATOR_ORDER.filter(hostAvailable);
  if (available.length === 0) return goal.preferredCoordinator;
  const preferredIndex = available.indexOf(goal.preferredCoordinator);
  const start = preferredIndex >= 0 ? preferredIndex : 0;
  return available[(start + goal.consecutiveFailures) % available.length] ?? available[0]!;
}

export function coordinatorPrompt(goal: SupervisorGoal): string {
  const context = readProjectContext(goal.repoPath);
  return `You are the active Major coordinator for project ${goal.project}.

BOTTOM LINE: own this goal until the smallest credible end-to-end outcome is demonstrated or a genuine owner-only gate remains.

GOAL:
${goal.goal}

MAJOR OPERATING CONTRACT:
- Speed and MVP are the default. Reduce broad scope to the smallest end-to-end P0 that proves value, then keep expanding only while P0 gaps remain.
- Do not stop after one PR, migration, fix, test, or subtask. After each result ask: what is now the highest-impact missing piece blocking the goal?
- Use 4–6 useful workers for substantive parallel work, max 8 when genuinely independent. Do not spawn redundant workers.
- Delegate independent work across providers with the Major CLI. Examples:
  major delegate --provider codex --cwd "${goal.repoPath}" --prompt "..."
  major delegate --provider cursor --cwd "${goal.repoPath}" --prompt "..." --worktree "ui-qa"
  major delegate --provider antigravity --cwd "${goal.repoPath}" --prompt "..."
- Prefer lower-cost/abundant capacity for bounded tasks. Use stronger reasoning for architecture, hard bugs, integration, and adjudication.
- Concurrent writers must use isolated worktrees. Keep one integration owner.
- Validate with objective evidence: browser/runtime behavior, tests, persisted state, exact SHA/PR, provider response, or deployed result.
- After two materially unchanged failures, change strategy/provider/tool.
- Continue independent work around a blocked dependency.
- Never fabricate external success, submissions, provider state, or user data just to satisfy a test.
- Stop only for a genuine owner gate: MFA/CAPTCHA, unavailable credentials, new paid spend, destructive production data, DNS/ownership, or irreversible security-policy changes.
- Keep communication BLUF and concise.

DURABLE CONTROL:
Before ending this coordinator turn, you MUST report the goal back to Major with exactly one of:
  major goal report --id "${goal.id}" --status active --summary "<what now works and next critical path>"
  major goal report --id "${goal.id}" --status done --summary "<objective completion evidence>"
  major goal report --id "${goal.id}" --status blocked --summary "<what is complete>" --owner-gate "<exact owner action>"
Do not mark done unless the end-to-end goal is demonstrably true.

CURRENT PROJECT CONTEXT:
${context || '(No canonical project context files found. Inspect the repository directly.)'}
`;
}

export async function runGoalCycle(goalId: string): Promise<void> {
  const goal = getGoal(goalId);
  if (!goal) throw new Error(`goal not found: ${goalId}`);
  if (goal.status === 'done' || goal.status === 'paused') return;

  const host = coordinatorFor(goal);
  updateGoal(goal.id, {
    status: 'running',
    cycle: goal.cycle + 1,
    lastStartedAt: new Date().toISOString(),
    activePid: process.pid,
  });

  const outcome = await runWorker({
    host,
    prompt: coordinatorPrompt(goal),
    cwd: goal.repoPath,
    timeoutMs: 60 * 60 * 1000,
  });
  const after = getGoal(goal.id);
  if (!after) return;
  if (after.status === 'done' || after.status === 'blocked' || after.status === 'paused') {
    updateGoal(goal.id, { activePid: undefined, lastFinishedAt: new Date().toISOString() });
    return;
  }

  if (outcome.status === 'succeeded') {
    updateGoal(goal.id, {
      status: 'active',
      consecutiveFailures: 0,
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary: trim(
        outcome.stdout || 'Coordinator cycle completed without an explicit Major report.',
      ),
      nextRunAt: new Date(Date.now() + 10_000).toISOString(),
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
    const now = Date.now();
    const candidates = activeGoals().filter((goal) => {
      if (!goal.autonomous || goal.status === 'blocked') return false;
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
      const lines = [
        `${goal.project}: ${goal.status.toUpperCase()} — ${goal.goal}`,
        `goal=${goal.id} cycle=${goal.cycle} failures=${goal.consecutiveFailures}`,
      ];
      if (goal.lastSummary) lines.push(`last: ${trim(goal.lastSummary, 1_500)}`);
      if (goal.ownerGate) lines.push(`OWNER GATE: ${goal.ownerGate}`);
      return lines.join('\n');
    })
    .join('\n\n');
}

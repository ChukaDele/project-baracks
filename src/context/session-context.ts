import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openDb } from '../db/client.js';
import { listLearningCandidates } from '../learning/candidates.js';
import { parseCapacityKey } from '../providers/account.js';
import { formatCodexCapacityOverview, readCodexUsageReport } from '../providers/codex-usage.js';
import { loadPersistedProviderInfos } from '../providers/discovery-store.js';
import { getProjectPolicy } from '../supervisor/policy.js';
import { resourceSnapshot } from '../supervisor/resources.js';
import { HOST_PROVIDERS } from '../supervisor/runtime.js';
import { resolveSkills } from '../skills/resolver.js';
import {
  activeGoals,
  attachSession,
  isLiveWorkerFresh,
  readSupervisorState,
  authorizeSessionWorkshop,
  revokeSessionWorkshop,
  resolveProjectForCwd,
} from '../supervisor/state.js';
import {
  authorizeSupervisedWorkshopCredentialHandoff,
  resolveSupervisedWorkshopAuthority,
} from '../security/supervised-workshop.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8');
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

const LEARNING_LIMIT = 6;

function isReviewDue(candidate: { status: string; occurrences: number }): boolean {
  return candidate.status === 'candidate' && candidate.occurrences >= 2;
}
const SKILL_LIMIT = 6;

/** Empty sections are omitted from the banner, so these return undefined
 * when there is nothing to say. */
function projectLearningFile(repoPath: string): string | undefined {
  const path = join(repoPath, 'LEARNINGS.md');
  if (!existsSync(path)) return undefined;
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return undefined;
  if (text.length <= 3_000) return text;
  return `${text.slice(0, 3_000)}\n(Truncated: read ${path} for the rest.)`;
}

/** One line, at most `max` characters, for banner fields that can be long. */
function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max - 1)}…`;
}

/** Banner budget: the decision fields of each active goal, every other goal
 * as one count line. Policy is already in the header; `major status` has the
 * full snapshot. */
function goalStateLines(project: string, repoPath: string): string[] {
  const active = activeGoals(project, repoPath);
  const activeIds = new Set(active.map((goal) => goal.id));
  const lines: string[] = [];
  for (const goal of active) {
    if (active.length > 1) lines.push(`- ${clip(goal.goal, 200)}`);
    lines.push(
      `  goal=${goal.id} cycle=${goal.cycle} failures=${goal.consecutiveFailures}` +
        (goal.liveWorker
          ? ` live worker: ${goal.liveWorker.host} (${isLiveWorkerFresh(goal.liveWorker) ? 'fresh' : 'stale, reclaimable'})`
          : ''),
    );
    if (goal.ownerGate) lines.push(`  OWNER GATE: ${clip(goal.ownerGate, 300)}`);
    if (goal.pendingCompletion) {
      lines.push(
        `  completion: awaiting independent grade of ${goal.pendingCompletion.coordinator} claim`,
      );
    }
    if (goal.lastSummary) lines.push(`  last: ${clip(goal.lastSummary, 300)}`);
  }
  const counts = new Map<string, number>();
  for (const goal of readSupervisorState().goals) {
    if (goal.project !== project || activeIds.has(goal.id)) continue;
    counts.set(goal.status, (counts.get(goal.status) ?? 0) + 1);
  }
  if (counts.size > 0) {
    const byStatus = [...counts].map(([status, n]) => `${n} ${status}`).join(', ');
    lines.push(`hidden inactive goals: ${byStatus}; list: major status ${project}`);
  }
  return lines;
}

function durableCandidates(project: string, repoPath: string): string | undefined {
  let candidates;
  try {
    candidates = listLearningCandidates(project, undefined, repoPath);
  } catch {
    return '(Major learning store unavailable: unsafe record withheld from session context.)';
  }
  const learnings = candidates
    .filter((candidate) => candidate.status !== 'dismissed')
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'promoted' ? -1 : 1;
      if (right.occurrences !== left.occurrences) return right.occurrences - left.occurrences;
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  if (learnings.length === 0) return undefined;
  // REVIEW-DUE learnings are always shown: they must not become ignored notes.
  const shown = learnings.filter(
    (candidate, index) => index < LEARNING_LIMIT || isReviewDue(candidate),
  );
  const more =
    learnings.length > shown.length
      ? `\n(${learnings.length - shown.length} more: major learn list --project current)`
      : '';
  return shown
    .map((candidate) => {
      const review = isReviewDue(candidate) ? ' REVIEW-DUE' : '';
      const key = candidate.key ? ` key=${candidate.key}` : '';
      const summary = clip(candidate.summary, 200);
      return `- ${candidate.status.toUpperCase()} ${candidate.occurrences}x${review} [${candidate.scope}/${candidate.source}]${key} ${summary}`;
    })
    .join('\n')
    .concat(more);
}

function resolvedGoalSkills(project: string, repoPath: string): string | undefined {
  const goals = activeGoals(project, repoPath);
  if (goals.length === 0) return undefined;
  const unique = new Map<string, string>();
  try {
    for (const goal of goals) {
      for (const skill of resolveSkills({ task: goal.goal, cwd: repoPath }).skills) {
        unique.set(skill.id, skill.path ?? skill.reference);
      }
    }
  } catch {
    return '(Major skill registry unavailable: skill context withheld without blocking session attach.)';
  }
  if (unique.size === 0) return undefined;
  const shown = [...unique].slice(0, SKILL_LIMIT).map(([id, path]) => `- ${id}: ${path}`);
  if (unique.size > SKILL_LIMIT) {
    shown.push(
      `(${unique.size - SKILL_LIMIT} more: major skill resolve --task "<active goal outcome>")`,
    );
  }
  return shown.join('\n');
}

/** One-line, discovery-store-backed capacity read for the banner — not a
 * routing decision, just what an operator/agent can see at a glance. */
function currentWorkerCapacity(): string {
  let infos;
  try {
    const opened = openDb();
    try {
      infos = loadPersistedProviderInfos(opened.db);
    } finally {
      opened.sqlite.close();
    }
  } catch {
    return '(unavailable: Major discovery store unreachable)';
  }
  const usableByProvider = new Map<string, boolean>();
  for (const info of infos) {
    const { providerName } = parseCapacityKey(info.name);
    const usable = info.models.some((m) => m.authenticated && m.availability === 'available');
    usableByProvider.set(providerName, (usableByProvider.get(providerName) ?? false) || usable);
  }
  return Object.entries(HOST_PROVIDERS)
    .map(([host, providerName]) => {
      if (!usableByProvider.has(providerName)) return `${host} (not yet discovered)`;
      return usableByProvider.get(providerName) ? host : `${host} (unavailable)`;
    })
    .join(', ');
}

function activeGoalSummary(project: string, repoPath: string): string {
  const goal = activeGoals(project, repoPath)[0];
  if (!goal) return 'none';
  return `${clip(goal.goal, 300)} [${goal.status}]`;
}

export async function runSessionContextCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'session') return false;

  if (args[1] === 'authorize') {
    if (flag(args, '--mode') !== 'supervised-workshop') {
      throw new Error('session authorize requires --mode supervised-workshop');
    }
    if (!args.includes('--owner-approved')) {
      throw new Error('supervised Workshop authorization requires explicit --owner-approved');
    }
    const host = flag(args, '--host') ?? 'unknown';
    const cwd = flag(args, '--cwd') ?? process.cwd();
    const project = resolveProjectForCwd(cwd);
    if (!project) throw new Error(`cannot authorize a non-project session: ${resolve(cwd)}`);
    const policy = getProjectPolicy(project.project, project.repoPath);
    if (policy.trust !== 'build' || !policy.ownerApprovedBuild || policy.allowBackground) {
      throw new Error(
        `supervised Workshop requires ${project.project} to be owner-approved build without background authority`,
      );
    }
    const sessionId =
      flag(args, '--session-id') ?? (host === 'codex' ? process.env.CODEX_THREAD_ID : undefined);
    if (!sessionId) throw new Error('supervised Workshop requires a stable --session-id');
    const minutes = Number.parseInt(flag(args, '--expires-minutes') ?? '480', 10);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 480) {
      throw new Error('--expires-minutes must be between 1 and 480');
    }
    const attachment = authorizeSessionWorkshop({
      host,
      cwd,
      project: project.project,
      repoPath: project.repoPath,
      sessionId,
      expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
    });
    console.log(
      JSON.stringify(
        {
          mode: 'SUPERVISED_WORKSHOP',
          sessionId,
          project: project.project,
          repoPath: project.repoPath,
          expiresAt: attachment.workshopAuthorization!.expiresAt,
          unattended: false,
        },
        null,
        2,
      ),
    );
    return true;
  }

  if (args[1] === 'revoke') {
    const cwd = flag(args, '--cwd') ?? process.cwd();
    const project = resolveProjectForCwd(cwd);
    const sessionId = flag(args, '--session-id');
    if (!project && !sessionId) {
      throw new Error('session revoke requires a project cwd or an exact --session-id');
    }
    const revoked = revokeSessionWorkshop({
      ...(sessionId ? { sessionId } : {}),
      ...(project ? { repoPath: project.repoPath } : {}),
    });
    console.log(`supervised Workshop sessions revoked: ${revoked}`);
    return true;
  }

  if (args[1] === 'verify-handoff') {
    const cwd = flag(args, '--cwd') ?? process.cwd();
    const sessionId = flag(args, '--session-id');
    const provider = flag(args, '--provider');
    const releaseSha = flag(args, '--release-sha');
    const destinationInstance = flag(args, '--destination-instance');
    if (!sessionId || !provider || !releaseSha || !destinationInstance) {
      throw new Error('Workshop credential handoff verification is missing its exact scope');
    }
    authorizeSupervisedWorkshopCredentialHandoff({
      cwd,
      sessionId,
      provider,
      releaseSha,
      destinationInstance,
    });
    console.log('SUPERVISED_WORKSHOP_HANDOFF=AUTHORIZED');
    return true;
  }

  if (args[1] !== 'attach' && args[1] !== 'hook') return false;

  const host = flag(args, '--host') ?? 'unknown';
  const interactionOrigin = flag(args, '--interaction-origin');
  const envelope = flag(args, '--envelope');
  let cwd = flag(args, '--cwd') ?? process.cwd();
  let sessionId =
    flag(args, '--session-id') ?? (host === 'codex' ? process.env.CODEX_THREAD_ID : undefined);

  if (args[1] === 'hook') {
    const input = await readStdin();
    if (input) {
      try {
        const parsed = JSON.parse(input) as {
          cwd?: string;
          session_id?: string;
          invocationNum?: number;
        };
        cwd = parsed.cwd ?? cwd;
        sessionId = parsed.session_id ?? sessionId;
        // Antigravity's PreInvocation event fires on every model call, not
        // just session start (there is no dedicated session-start event for
        // it). Only the first invocation of a conversation should attach and
        // surface the banner -- every later call must be a silent no-op, or
        // the banner would repeat on every single turn.
        if (
          envelope === 'antigravity-pre-invocation' &&
          typeof parsed.invocationNum === 'number' &&
          parsed.invocationNum !== 1
        ) {
          console.log('{}');
          return true;
        }
      } catch {
        // Hook context is advisory; use command/process defaults when malformed.
      }
    }
  }

  function emit(banner: string): void {
    switch (envelope) {
      case 'codex-session-start':
        console.log(JSON.stringify({ continue: true, additionalContext: banner }));
        return;
      case 'cursor-session-start':
        console.log(
          JSON.stringify({
            additionalContext: banner,
            hookSpecificOutput: { hookEventName: 'SessionStart', additionalContext: banner },
          }),
        );
        return;
      case 'antigravity-pre-invocation':
        console.log(JSON.stringify({ injectSteps: [{ ephemeralMessage: banner }] }));
        return;
      default:
        console.log(banner);
    }
  }

  const project = resolveProjectForCwd(cwd);
  attachSession({
    host,
    ...(interactionOrigin ? { interactionOrigin } : {}),
    cwd,
    ...(project ? { project: project.project, repoPath: project.repoPath } : {}),
    ...(sessionId ? { sessionId } : {}),
  });

  if (!project) {
    emit(
      `MAJOR CONTROL PLANE: ACTIVE\nhost: ${host}\ncwd: ${resolve(cwd)}\nNo git project detected in this session.\n\nBefore project work, enter or resolve the intended repository. Do not create/fix files in an unrelated workspace merely because it is open.`,
    );
    return true;
  }

  const policy = getProjectPolicy(project.project, project.repoPath);
  let workshopActiveUntil: string | undefined;
  try {
    workshopActiveUntil = resolveSupervisedWorkshopAuthority(project.repoPath).expiresAt;
  } catch {
    // Session attachment remains available when no workshop has been authorized.
  }
  const workshopEligible =
    policy.trust === 'build' && policy.ownerApprovedBuild && !policy.allowBackground;
  const foregroundAuthority = workshopActiveUntil
    ? `active until ${workshopActiveUntil}`
    : workshopEligible
      ? 'ready — `major goal admit` activates it automatically for substantive work'
      : `not applicable (trust=${policy.trust}${policy.ownerApprovedBuild ? '' : ', not owner-approved build'})`;
  const resources = resourceSnapshot().telemetry;
  const learningFile = projectLearningFile(project.repoPath);
  const learnings = durableCandidates(project.project, project.repoPath);
  const skills = resolvedGoalSkills(project.project, project.repoPath);
  const reviewDue = learnings?.includes(' REVIEW-DUE ') ?? false;
  const repoLine = resolve(cwd) === project.repoPath ? '' : `\nrepo: ${project.repoPath}`;
  // Only what changes this session's decisions. Stable rules live in the
  // cached global rules file (guidance/global-worker-rules.md); a banner over
  // the host's inline hook limit (~10k chars in Claude Code) is replaced by a
  // short preview, so the contract below must stay small and come last.
  const sections = [
    `MAJOR CONTROL PLANE: ACTIVE
project: ${project.project}
cwd: ${resolve(cwd)}${repoLine}
policy: ${policy.projectClass}/${policy.trust} maxWorkers=${policy.maxWorkers} ownerApproved=${policy.ownerApprovedBuild ? 'yes' : 'no'}
foreground authority: ${foregroundAuthority}
active goal: ${activeGoalSummary(project.project, project.repoPath)}
${goalStateLines(project.project, project.repoPath)
  .map((line) => `${line}\n`)
  .join('')}current worker capacity: ${currentWorkerCapacity()}
${formatCodexCapacityOverview(readCodexUsageReport())}
RESOURCE GUARD: workers ${resources.workers.active}/${resources.workers.limit}, browsers ${resources.browsers.active}/${resources.browsers.limit}, builds ${resources.builds.active}/${resources.builds.limit}, queued ${resources.queued}, memory ${resources.memoryAvailablePercent}% (floor ${resources.memorySoftFloorPercent}%)`,
  ];
  if (learningFile) sections.push(`DURABLE PROJECT LEARNINGS (LEARNINGS.md)\n${learningFile}`);
  if (learnings) sections.push(`ACTIVE MAJOR LEARNINGS\n${learnings}`);
  if (skills) sections.push(`RESOLVED SKILLS FOR ACTIVE GOALS\n${skills}`);
  const contract = [
    '- Major is already active; do not ask the user to start it again. Global Major rules apply.',
  ];
  if (workshopEligible) {
    contract.push(
      `- Owner-approved build: for SUBSTANTIVE work run \`major goal admit --host ${host} --outcome "<durable outcome>"\`, then dispatch \`major run ${project.project} --goal-id <id> --foreground\` and report the result; skip both for lightweight interaction.`,
    );
  }
  if (learningFile || learnings) {
    contract.push(
      '- Treat the learnings above as active constraints. A fresh session is not permission to repeat a prior correction.',
    );
  }
  if (reviewDue) {
    contract.push(
      '- A REVIEW-DUE learning has recurred at least twice. It is listed for the weekly learning batch (`major learn digest`); do not hold this task open for it.',
    );
  }
  sections.push(`SESSION CONTRACT\n${contract.join('\n')}`);
  emit(sections.join('\n\n'));
  return true;
}

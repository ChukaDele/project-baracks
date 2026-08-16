import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { openDb } from '../db/client.js';
import { listLearningCandidates } from '../learning/candidates.js';
import { parseCapacityKey } from '../providers/account.js';
import { loadPersistedProviderInfos } from '../providers/discovery-store.js';
import { getProjectPolicy } from '../supervisor/policy.js';
import { formatResourceTelemetry, resourceSnapshot } from '../supervisor/resources.js';
import { HOST_PROVIDERS, supervisorSnapshot } from '../supervisor/runtime.js';
import { resolveSkills } from '../skills/resolver.js';
import {
  activeGoals,
  attachSession,
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

function projectLearningFile(repoPath: string): string {
  const path = join(repoPath, 'LEARNINGS.md');
  if (!existsSync(path)) return '(No project LEARNINGS.md found.)';
  const text = readFileSync(path, 'utf8').trim();
  if (!text) return '(Project LEARNINGS.md is empty.)';
  return text.slice(0, 8_000);
}

function durableCandidates(project: string, repoPath: string): string {
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
    })
    .slice(0, 20);
  if (learnings.length === 0) return '(No active Major learnings.)';
  return learnings
    .map((candidate) => {
      const review =
        candidate.status === 'candidate' && candidate.occurrences >= 2 ? ' REVIEW-DUE' : '';
      const key = candidate.key ? ` key=${candidate.key}` : '';
      return `- ${candidate.status.toUpperCase()} ${candidate.occurrences}x${review} [${candidate.scope}/${candidate.source}]${key} ${candidate.summary}`;
    })
    .join('\n');
}

function resolvedGoalSkills(project: string, repoPath: string): string {
  const goals = activeGoals(project, repoPath);
  if (goals.length === 0)
    return '(No active goal. Resolve skills against the substantive task when it arrives.)';
  const unique = new Map<string, string>();
  try {
    for (const goal of goals) {
      for (const skill of resolveSkills({ task: goal.goal, cwd: repoPath }).skills) {
        unique.set(skill.id, skill.path);
      }
    }
  } catch {
    return '(Major skill registry unavailable: skill context withheld without blocking session attach.)';
  }
  if (unique.size === 0) return '(No installed skill matched the active goal.)';
  return [...unique].map(([id, path]) => `- ${id}: ${path}`).join('\n');
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
  return `${goal.goal} [${goal.status}]`;
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
  let cwd = flag(args, '--cwd') ?? process.cwd();
  let sessionId =
    flag(args, '--session-id') ?? (host === 'codex' ? process.env.CODEX_THREAD_ID : undefined);

  if (args[1] === 'hook') {
    const input = await readStdin();
    if (input) {
      try {
        const parsed = JSON.parse(input) as { cwd?: string; session_id?: string };
        cwd = parsed.cwd ?? cwd;
        sessionId = parsed.session_id ?? sessionId;
      } catch {
        // Hook context is advisory; use command/process defaults when malformed.
      }
    }
  }

  const project = resolveProjectForCwd(cwd);
  attachSession({
    host,
    cwd,
    ...(project ? { project: project.project, repoPath: project.repoPath } : {}),
    ...(sessionId ? { sessionId } : {}),
  });

  if (!project) {
    console.log(
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
  const resources = formatResourceTelemetry(resourceSnapshot().telemetry);
  console.log(`MAJOR CONTROL PLANE: ACTIVE
host: ${host}
cwd: ${resolve(cwd)}
project: ${project.project}
repo: ${project.repoPath}
policy: ${policy.projectClass}/${policy.trust} maxWorkers=${policy.maxWorkers} ownerApproved=${policy.ownerApprovedBuild ? 'yes' : 'no'}
foreground authority: ${foregroundAuthority}
active goal: ${activeGoalSummary(project.project, project.repoPath)}
current worker capacity: ${currentWorkerCapacity()}

ACTIVE GOAL STATE
${supervisorSnapshot(project.project)}

DURABLE PROJECT LEARNINGS
${projectLearningFile(project.repoPath)}

ACTIVE MAJOR LEARNINGS
${durableCandidates(project.project, project.repoPath)}

RESOLVED SKILLS FOR ACTIVE GOALS
${resolvedGoalSkills(project.project, project.repoPath)}

RESOURCE GUARD
${resources}
subagent depth: 1
browser hard cap: 2
concurrent build cap: 1

SESSION CONTRACT
- Major is already active; do not ask the user to start it again.
${
  workshopEligible
    ? `- This is an owner-approved build project: for SUBSTANTIVE project work (build/fix/redesign/implement/deploy/debug/investigate/modify the repo/multi-step build-or-research tasks), call \`major goal admit --host ${host} --outcome "<the durable outcome, not the latest implementation step>"\` before starting. It creates or resumes the one durable goal for this project, auto-grants foreground authority, and tells you if another session already owns live work here. Skip it for lightweight interaction (explaining code, answering questions, opinions, summaries, read-only inspection) unless a goal is already active. Call it once per new increment of substantive work, not on every message inside the same increment while a dispatch is already in flight or its result is still being reported. The response echoes the goal's current \`outcome\` even when resuming — read it: if it plainly does not match what the user is actually asking for right now, pass \`--refine\` to redefine it; the mechanism preserves outcome text by default and cannot tell staleness from a refinement on its own.\n- After admitting, DISPATCH the work through Major rather than implementing it directly yourself: run \`major run <project> --goal-id <the admitted goal id> --foreground\` (use a long-running/background command mechanism — it can take up to this project's maxRunMinutes). If the selected provider hits an authoritative rate limit, exhaustion, or auth failure mid-run, Major reroutes to the next eligible provider/account and continues the SAME goal automatically within that dispatch; you never need to notice the failure or name a different provider. Read the result and report it to the user — you are the interface/controller, not a second parallel implementer: do not also make the same edits yourself while a dispatch is in flight or after it completes. A dispatch that reports 0 hops did nothing (another Major process already held the repo lock) -- do not start one while a prior dispatch for the same goal is still running. One dispatch finishes one increment of work: for the next increment, admit/resume the same goal and dispatch again.\n`
    : ''
}- Before substantive edits, confirm any named/implied project matches this repo. If not, load project-context-integrity and reroute before mutation.
- Run Major's skill resolver and load the exact project or immutable-runtime skill paths it returns before inventing a workflow.
- Treat the durable learnings above as active constraints. A fresh session is not permission to repeat a prior correction.
- A REVIEW-DUE learning has recurred at least twice. Before closing the task, either promote the proven lesson into guidance/skill or record why it remains unstable/project-specific.
- If the user explicitly corrects behavior or says a mistake happened before: fix and verify the real task, then capture the correction with major learn capture without making the user ask. Use one stable learning key for the same failure class across runs.
- For MCP/connectors/plugins, load mcp-integration-ops and prove the actual integration state.
- For substantial UI/website creation, redesign, or "generic/AI-looking/too safe" feedback, load design-direction-and-taste first. It is the single Major taste authority; do not stack competing generic taste skills.
- For customer-facing website QA, load website-design-qa; add responsive-motion-systems for GSAP/ScrollTrigger/sticky/pinned/Three.js work.
- Owner-approved build projects may continue ordinary reversible engineering without permission ceremony. Client/PII data remains project-local.`);
  return true;
}

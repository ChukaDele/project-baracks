import { existsSync, readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { listLearningCandidates } from '../learning/candidates.js';
import { getProjectPolicy } from '../supervisor/policy.js';
import { formatResourceTelemetry, resourceSnapshot } from '../supervisor/resources.js';
import { supervisorSnapshot } from '../supervisor/runtime.js';
import { resolveSkills } from '../skills/resolver.js';
import { activeGoals, attachSession, resolveProjectForCwd } from '../supervisor/state.js';

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

function durableCandidates(project: string): string {
  const learnings = listLearningCandidates(project)
    .sort((left, right) => {
      if (left.status !== right.status) return left.status === 'promoted' ? -1 : 1;
      if (right.occurrences !== left.occurrences) return right.occurrences - left.occurrences;
      return right.updatedAt.localeCompare(left.updatedAt);
    })
    .filter((candidate) => candidate.status !== 'dismissed')
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
  const goals = activeGoals(project);
  if (goals.length === 0)
    return '(No active goal. Resolve skills against the substantive task when it arrives.)';
  const unique = new Map<string, string>();
  for (const goal of goals) {
    for (const skill of resolveSkills({ task: goal.goal, cwd: repoPath }).skills) {
      unique.set(skill.id, skill.path);
    }
  }
  if (unique.size === 0) return '(No installed skill matched the active goal.)';
  return [...unique].map(([id, path]) => `- ${id}: ${path}`).join('\n');
}

export async function runSessionContextCli(args: string[]): Promise<boolean> {
  if (args[0] !== 'session' || (args[1] !== 'attach' && args[1] !== 'hook')) return false;

  const host = flag(args, '--host') ?? 'unknown';
  let cwd = flag(args, '--cwd') ?? process.cwd();
  let sessionId = flag(args, '--session-id');

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
  const resources = formatResourceTelemetry(resourceSnapshot().telemetry);
  console.log(`MAJOR CONTROL PLANE: ACTIVE
host: ${host}
cwd: ${resolve(cwd)}
project: ${project.project}
repo: ${project.repoPath}
policy: ${policy.projectClass}/${policy.trust} maxWorkers=${policy.maxWorkers} ownerApproved=${policy.ownerApprovedBuild ? 'yes' : 'no'}

ACTIVE GOAL STATE
${supervisorSnapshot(project.project)}

DURABLE PROJECT LEARNINGS
${projectLearningFile(project.repoPath)}

ACTIVE MAJOR LEARNINGS
${durableCandidates(project.project)}

RESOLVED SKILLS FOR ACTIVE GOALS
${resolvedGoalSkills(project.project, project.repoPath)}

RESOURCE GUARD
${resources}
subagent depth: 1
browser hard cap: 2
concurrent build cap: 1

SESSION CONTRACT
- Major is already active; do not ask the user to start it again.
- Before substantive edits, confirm any named/implied project matches this repo. If not, load project-context-integrity and reroute before mutation.
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

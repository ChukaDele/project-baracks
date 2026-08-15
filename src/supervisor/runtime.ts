import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  openSync,
  closeSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { openDb } from '../db/client.js';
import { getProjectByRepoPath } from '../config/project-service.js';
import {
  listCapabilities,
  blockCapabilityVerification,
  invalidateCapabilitySource,
  planCapabilityAcquisition,
  provisionCapability,
  recordReportedCapabilityUse,
  validateDiscoveredCapability,
  type CapabilityRecord,
} from '../capabilities/registry.js';
import { discoverCapabilities, type DiscoveredCapability } from '../capabilities/discovery.js';
import { isCapabilitySourceCurrent } from '../capabilities/verifier.js';
import { captureLearning, listLearningCandidates } from '../learning/candidates.js';
import {
  consumeModelRetry,
  loadPersistedProviderInfos,
  recordModelOutcome,
} from '../providers/discovery-store.js';
import type { ProviderInfo } from '../providers/types.js';
import { route } from '../routing/router.js';
import { resolveSkills } from '../skills/resolver.js';
import { observeSuccessfulWorkflow, recordSkillOutcome } from '../skills/lifecycle.js';
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
import { hostAvailable, runWorker, workerCommand, type WorkerOutcome } from './worker.js';
import { completedWorkflow, parseWorkerReport } from './worker-report.js';

export { parseWorkerReport } from './worker-report.js';

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

function readLearningContext(project: string, repoPath: string): string {
  let visible;
  try {
    visible = listLearningCandidates(project, undefined, repoPath);
  } catch {
    return '(Major learning store unavailable: unsafe record withheld from coordinator context.)';
  }
  const candidates = visible
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

export function modelOutcomeForWorker(
  outcome: Pick<WorkerOutcome, 'host' | 'status' | 'rateLimited' | 'exhausted' | 'stderr'>,
): 'available' | 'rate_limited' | 'exhausted' | 'unknown' | undefined {
  if (outcome.exhausted) return 'exhausted';
  if (outcome.rateLimited) return 'rate_limited';
  if (outcome.status === 'succeeded') return 'available';
  if (/no trusted installation|cannot trust|not an executable regular file/i.test(outcome.stderr)) {
    return 'unknown';
  }
  const providerAuthFailure: Record<WorkerHost, RegExp> = {
    claude: /(?:invalid api key|not logged in|please run \/login)/i,
    codex: /(?:invalid api key|not logged in|run[^\n]*codex login)/i,
    cursor: /(?:invalid api key|not authenticated|login required|cursor(?:-agent| agent) login)/i,
    antigravity: /(?:antigravity[^\n]*not signed in|launch the cli without arguments to sign in)/i,
  };
  if (providerAuthFailure[outcome.host].test(outcome.stderr)) return 'unknown';
  return undefined;
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
  const failedProvider =
    goal.consecutiveFailures >= 2 && goal.lastCoordinator
      ? HOST_PROVIDERS[goal.lastCoordinator]
      : undefined;
  const alternatives = failedProvider
    ? ordered.filter((provider) => provider.name !== failedProvider)
    : ordered;
  let decision = route({ purpose: 'analysis', complexity: 'architectural' }, alternatives);
  if (decision.kind === 'checkpoint' && alternatives.length !== ordered.length) {
    decision = route({ purpose: 'analysis', complexity: 'architectural' }, ordered);
  }
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

export interface ToolsmithDependencies {
  discover(input: { operation: string; repoPath: string }): DiscoveredCapability[];
  sourceCurrent(capability: CapabilityRecord, repoPath: string): boolean;
}

const defaultToolsmithDependencies: ToolsmithDependencies = {
  discover: discoverCapabilities,
  sourceCurrent: isCapabilitySourceCurrent,
};

export function resolveGoalCapabilities(
  goal: SupervisorGoal,
  dependencies: ToolsmithDependencies = defaultToolsmithDependencies,
): { kind: 'ready'; capabilities: CapabilityRecord[] } | { kind: 'checkpoint'; reason: string } {
  if (!goal.requiredOperations || goal.requiredOperations.length === 0) {
    return { kind: 'ready', capabilities: [] };
  }
  const state = openDb();
  try {
    const project = getProjectByRepoPath(state.db, goal.repoPath);
    const capabilities: CapabilityRecord[] = [];
    for (const operation of goal.requiredOperations) {
      for (const capability of listCapabilities(state.db, project.id)) {
        if (
          capability.operations.includes(operation) &&
          ['validated', 'preferred'].includes(capability.status) &&
          !dependencies.sourceCurrent(capability, goal.repoPath)
        ) {
          invalidateCapabilitySource(state.db, capability.id);
        }
      }
      const existingPlan = planCapabilityAcquisition(state.db, {
        projectId: project.id,
        operation,
        candidates: [],
      });
      if (existingPlan.kind === 'reuse') {
        capabilities.push(existingPlan.capability);
        continue;
      }
      const discovered = dependencies.discover({ operation, repoPath: goal.repoPath });
      const existingKeys = new Set(
        listCapabilities(state.db, project.id)
          .filter(
            (capability) => !['degraded', 'blocked', 'deprecated'].includes(capability.status),
          )
          .map((capability) => capability.key),
      );
      const remaining = discovered.filter(
        (candidate) => !existingKeys.has(candidate.candidate.key),
      );
      const reasons: string[] = [];
      for (;;) {
        const plan = planCapabilityAcquisition(state.db, {
          projectId: project.id,
          operation,
          candidates: remaining.map((candidate) => candidate.candidate),
        });
        if (plan.kind === 'reuse') {
          capabilities.push(plan.capability);
          break;
        }
        if (plan.kind === 'blocked') {
          reasons.push(...plan.reasons);
          return {
            kind: 'checkpoint',
            reason: `Toolsmith checkpoint for ${operation}: ${[...new Set(reasons)].join('; ')}`,
          };
        }
        const discoveredCandidate = remaining.find(
          (candidate) => candidate.candidate.key === plan.assessment.candidate.key,
        );
        if (!discoveredCandidate) {
          return {
            kind: 'checkpoint',
            reason: `Toolsmith checkpoint for ${operation}: discovery drift`,
          };
        }
        const provisional = provisionCapability(state.db, {
          projectId: project.id,
          candidate: discoveredCandidate.candidate,
        });
        let verified: CapabilityRecord;
        try {
          verified = validateDiscoveredCapability(state.db, {
            id: provisional.id,
            repoPath: goal.repoPath,
          });
        } catch (error) {
          const reason = error instanceof Error ? error.message : String(error);
          blockCapabilityVerification(state.db, provisional.id, reason);
          reasons.push(`candidate ${discoveredCandidate.candidate.key} verifier error: ${reason}`);
          remaining.splice(remaining.indexOf(discoveredCandidate), 1);
          continue;
        }
        if (verified.status === 'validated') {
          capabilities.push(verified);
          break;
        }
        reasons.push(`candidate ${verified.key} failed capability-specific validation`);
        remaining.splice(remaining.indexOf(discoveredCandidate), 1);
      }
    }
    return { kind: 'ready', capabilities };
  } catch (error) {
    return {
      kind: 'checkpoint',
      reason: `Toolsmith capability resolution failed: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    state.sqlite.close();
  }
}

/** Store a worker report as provenance only. It cannot promote a capability
 * because a worker claim is not independent validation. */
export function recordReportedCapabilityUses(
  capabilities: readonly CapabilityRecord[],
  uses: readonly { key: string; evidence: string }[] | undefined,
): void {
  if (!uses || uses.length === 0) return;
  const capabilityState = openDb();
  try {
    for (const usage of uses) {
      const capability = capabilities.find((candidate) => candidate.key === usage.key);
      if (capability) {
        recordReportedCapabilityUse(capabilityState.db, {
          id: capability.id,
          evidence: usage.evidence,
        });
      }
    }
  } finally {
    capabilityState.sqlite.close();
  }
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

export function coordinatorPrompt(
  goal: SupervisorGoal,
  capabilities: readonly CapabilityRecord[] = [],
): string {
  const context = readProjectContext(goal.repoPath);
  const learningContext = readLearningContext(goal.project, goal.repoPath);
  let resolvedSkills: ReturnType<typeof resolveSkills>['skills'] = [];
  let skillResolutionFailed = false;
  try {
    resolvedSkills = resolveSkills({ task: goal.goal, cwd: goal.repoPath }).skills;
  } catch {
    skillResolutionFailed = true;
  }
  const skillContext = skillResolutionFailed
    ? '(Major skill registry unavailable. Continue without skill context and report the degraded resolver.)'
    : resolvedSkills.length === 0
      ? '(No installed skill matched deterministically. Inspect the registry before inventing a new workflow.)'
      : resolvedSkills.map((skill) => `- ${skill.id}: ${skill.path}`).join('\n');
  const policy = getProjectPolicy(goal.project, goal.repoPath);
  const workerLanguage =
    policy.maxWorkers <= 1
      ? 'Keep this single-worker unless a genuine blocker requires escalation.'
      : `This project's parent coordinator may admit up to ${policy.maxWorkers} independent workers. This leased worker must request additional capacity in its final report rather than nesting workers itself.`;

  return `You are the active Major coordinator for project ${goal.project}.

BOTTOM LINE: own this goal until the smallest credible end-to-end outcome is demonstrated or a genuine owner-only gate remains.

GOAL:
${goal.goal}

CANONICAL TARGET:
- project: ${goal.project}
- repository path: ${goal.repoPath}

RESOLVED TOOLSMITH CAPABILITIES:
${
  capabilities.length === 0
    ? '(No capability was required for this goal.)'
    : capabilities
        .map(
          (capability) =>
            `- ${capability.key}: ${capability.description}\n` +
            `  operations: ${capability.operations.join(', ')}\n` +
            `  source: ${capability.source.kind} (${capability.source.reference})\n` +
            `  status: ${capability.status}`,
        )
        .join('\n')
}
Use only these already-validated capabilities for the operations they declare. Do not install, configure, or substitute a new capability. Report capability-specific evidence in the final result when you use one. A completed goal alone is not proof that a capability was used.
Use this exact optional field for that evidence:
"capabilityUse":[{"key":"capability-key","evidence":"specific operation and observed result"}].

Before any substantive mutation, verify that the current Git root/remote and the task's named or implied target agree with this canonical target. If the task clearly belongs to another known project, do not patch this repository. Use project-context-integrity and reroute to the correct repository when unambiguous; ask only if the target is genuinely ambiguous. A correct fix in the wrong repository is a failed task.

${trustContract(policy)}

MAJOR OPERATING CONTRACT:
- Treat contained, reversible and observable Workshop actions as autonomous progress. Use project policy for external effects and reserve owner gates for human-only consequential boundaries.
- Speed and MVP are the default. Reduce broad scope to the smallest end-to-end P0 that proves value, then keep expanding only while P0 gaps remain.
- Do not stop after one PR, migration, fix, test, or subtask. After each result ask: what is now the highest-impact missing piece blocking the goal?
- ${workerLanguage}
- Before inventing a process, run Major's skill resolver and load the exact project or immutable-runtime skill paths it returns.
- Read project LEARNINGS.md and the Major learning candidates below before acting. Do not repeat a captured correction merely because a fresh worker lacks chat history.
- Prefer the smallest capable tool/skill before creating more orchestration. If a short deterministic script can retrieve/filter/dedupe/transform data more reliably than repeated model turns, use Tools-as-Code.
- For substantial UI/website creation, redesign, art-direction changes, or "generic/AI-looking/too safe/too loud" feedback, use design-direction-and-taste first. It is the single Major art-direction/taste authority; do not stack competing generic taste systems.
- For MCP/connectors/plugins, distinguish installed → configured → exposed → authenticated → permissioned → operational → integrated. Use mcp-integration-ops and prove the needed state with a representative real operation.
- For customer-facing website QA, use website-design-qa. Pair responsive-motion-systems for GSAP/ScrollTrigger/sticky/pinned/Three.js or viewport-motion work. Respect remote-first-web-development for browser preview/acceptance unless the owner explicitly permits a local exception.
- Reuse an existing tested skill when one matches. When a novel procedure succeeds and is likely reusable, Skillify rather than growing the permanent supervisor workflow.
- An explicit user correction, repeated mistake, or credible user evidence contradicting the agent is a learning event: fix and verify the real task first, then add a project-local \`learning\` object to the final MAJOR_RESULT with \`source\`, \`summary\`, optional stable \`key\`, and optional \`evidence\`. The parent validates and captures it.
- When a non-trivial reusable procedure succeeds, add a \`workflow\` object to MAJOR_RESULT with \`task\`, \`outcome\`, ordered \`steps\`, \`tools\`, objective \`validations\`, and \`scope\`. Major records, deduplicates, validates and promotes it; do not create a skill file directly.
- You are the leased worker. Do not start nested workers, browsers, builds, or Major CLI delegation from this sandbox. Request any additional capacity in your final report; the parent owns resource admission and learning capture.
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
    const lockText = readFileSync(path, 'utf8').trim();
    const lockAgeMs = Date.now() - statSync(path).mtimeMs;
    if (!lockText && lockAgeMs <= 30_000) return undefined;
    const prior = Number.parseInt(lockText, 10);
    if (Number.isFinite(prior) && pidAlive(prior)) return undefined;
    if (lockAgeMs <= 30_000) return undefined;
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
    const providerInfos = loadPersistedProviderInfos(providerState.db);
    selection = selectCoordinator(goal, providerInfos);
    if (selection.kind === 'route') {
      const routedSelection = selection;
      const selectedModel = providerInfos
        .find((provider) => provider.name === routedSelection.provider)
        ?.models.find((model) => model.modelRef === routedSelection.modelRef);
      if (
        selectedModel?.retryEligible &&
        !consumeModelRetry(providerState.db, {
          providerName: routedSelection.provider,
          modelRef: routedSelection.modelRef,
        })
      ) {
        selection = {
          kind: 'checkpoint',
          reason: `retry for ${routedSelection.provider}/${routedSelection.modelRef} was already consumed`,
        };
      }
    }
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
    const executable = workerCommand(selection.host, '').command;
    const summary =
      `Provider routing checkpoint: ${selection.provider}/${selection.modelRef} is persisted as ` +
      `available but the canonical CLI is missing at ${resolve(majorHome(), '..', '.local', 'bin', executable)}. ` +
      'Install or link that exact provider CLI, then attest availability again.';
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
  const capabilityResolution = resolveGoalCapabilities(goal);
  if (capabilityResolution.kind === 'checkpoint') {
    updateGoal(goal.id, {
      status: 'blocked',
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary: capabilityResolution.reason,
      nextRunAt: undefined,
      ownerGate: 'Review the Toolsmith checkpoint or register an approved capability.',
    });
    console.error(capabilityResolution.reason);
    return;
  }
  let routedSkillIds: string[] = [];
  try {
    routedSkillIds = resolveSkills({ task: goal.goal, cwd: goal.repoPath }).skills.map(
      (skill) => skill.id,
    );
  } catch {
    // The prompt already reports a degraded resolver. Outcome recording must
    // not turn resolver unavailability into a second execution failure.
  }
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
    prompt: coordinatorPrompt(goal, capabilityResolution.capabilities),
    cwd: goal.repoPath,
    timeoutMs: Math.max(1, policy.maxRunMinutes) * 60 * 1000,
    modelRef: selection.modelRef,
  });
  try {
    recordSkillOutcome({
      project: goal.project,
      ids: routedSkillIds,
      success: outcome.status === 'succeeded',
      durationMs: outcome.durationMs,
    });
  } catch {
    // Skill metrics are evidence, not completion authority.
  }
  const modelOutcome = modelOutcomeForWorker(outcome);
  if (modelOutcome) {
    const outcomeState = openDb();
    try {
      recordModelOutcome(outcomeState.db, {
        providerName: selection.provider,
        modelRef: selection.modelRef,
        outcome: modelOutcome,
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
    recordReportedCapabilityUses(capabilityResolution.capabilities, report?.capabilityUse);
    let learningWarning = '';
    if (report?.learning) {
      try {
        captureLearning({
          ...report.learning,
          project: goal.project,
          repoPath: goal.repoPath,
          scope: 'project',
        });
      } catch (error) {
        learningWarning = ` Learning capture failed: ${trim(error instanceof Error ? error.message : String(error), 2_000)}`;
      }
    }
    const completedWorkflowReport = completedWorkflow(report);
    if (completedWorkflowReport) {
      try {
        observeSuccessfulWorkflow({
          ...completedWorkflowReport,
          success: true,
          project: goal.project,
          repoPath: goal.repoPath,
          durationMs: outcome.durationMs,
          goalId: goal.id,
          resolvedSkillIds: routedSkillIds,
        });
      } catch (error) {
        learningWarning += ` Skillification deferred: ${trim(error instanceof Error ? error.message : String(error), 2_000)}`;
      }
    }
    if (report?.status === 'blocked') {
      updateGoal(goal.id, {
        status: 'blocked',
        consecutiveFailures: 0,
        activePid: undefined,
        lastFinishedAt: new Date().toISOString(),
        lastSummary: `${report.summary}${learningWarning}`,
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
        lastSummary: `Worker completion claim awaiting independent validation: ${report.summary}${learningWarning}`,
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
      lastSummary: report?.summary
        ? `${report.summary}${learningWarning}`
        : trim(outcome.stdout || 'Coordinator cycle completed without an explicit Major report.'),
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
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'EPERM') return true;
    if (code === 'ESRCH') return false;
    throw error;
  }
}

function acquireDaemonLock(): number | undefined {
  mkdirSync(majorHome(), { recursive: true });
  const path = join(majorHome(), 'supervisor-daemon.pid');
  if (existsSync(path)) {
    const lockText = readFileSync(path, 'utf8').trim();
    const lockAgeMs = Date.now() - statSync(path).mtimeMs;
    if (!lockText && lockAgeMs <= 30_000) return undefined;
    const prior = Number.parseInt(lockText, 10);
    if (Number.isInteger(prior) && pidAlive(prior)) return undefined;
    if (lockAgeMs <= 30_000) return undefined;
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

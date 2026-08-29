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
import { openDb, type DbConn } from '../db/client.js';
import {
  evaluateTaskPromotionProof,
  resolveCanonicalTaskBinding,
  type CanonicalTaskBinding,
} from '../domain/completion.js';
import { assessPromotion, planProgressiveValidation } from '../domain/sdlc.js';
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
import {
  discoverCapabilities,
  priorArtDiscoveryDirective,
  type DiscoveredCapability,
} from '../capabilities/discovery.js';
import { isCapabilitySourceCurrent } from '../capabilities/verifier.js';
import { captureLearning, listLearningCandidates } from '../learning/candidates.js';
import { parseCapacityKey } from '../providers/account.js';
import {
  consumeModelRetry,
  loadPersistedProviderInfos,
  recordModelOutcome,
} from '../providers/discovery-store.js';
import type { ProviderInfo } from '../providers/types.js';
import { route } from '../routing/router.js';
import {
  compareSubscriptionAccounts,
  contextContinuity,
  lastCapacityKey,
  subscriptionAccountPool,
} from '../routing/subscription-accounts.js';
import { discloseSkills, resolveSkills } from '../skills/resolver.js';
import { observeSuccessfulWorkflow, recordSkillOutcome } from '../skills/lifecycle.js';
import { formatReusableAssetDiscovery, observeReusableAssetCandidate } from '../skills/assets.js';
import {
  assertExecutionAllowed,
  getProjectPolicy,
  globalStopRequested,
  type ProjectPolicy,
} from './policy.js';
import {
  activeGoals,
  getGoal,
  gitCommonDir,
  isLiveWorkerFresh,
  majorHome,
  readSupervisorState,
  updateGoal,
  type SupervisorGoal,
  type WorkerHost,
} from './state.js';
import { reconcileAfterCancel } from '../resources/reconcile.js';
import { computeProviderReadiness } from '../doctor/readiness.js';
import { hostIntegrationStatus, SUPPORTED_HOSTS } from '../context/host-integration.js';
import { formatCodexCapacityOverview, readCodexUsageReport } from '../providers/codex-usage.js';
import { hostAvailable, runWorker, workerCommand, type WorkerOutcome } from './worker.js';
import {
  completedWorkflow,
  deriveSupervisorPromotionContract,
  parseWorkerReport,
  type WorkerReport,
} from './worker-report.js';
import {
  RUN_INSIGHT_SCHEMA,
  recordPerformanceObservation,
} from '../insights/performance-history.js';
import { configuredExecutionPath, executionPathStatus } from '../execution/path.js';

export { parseWorkerReport } from './worker-report.js';

export function coordinatorDonePromotionProof(
  db: DbConn,
  goal: Pick<SupervisorGoal, 'repoPath' | 'promotionContract'>,
  report: WorkerReport,
) {
  if (report.status !== 'done') return undefined;
  const resolved = resolveCanonicalTaskBinding(db, goal.repoPath);
  if (!report.taskId) {
    if (!resolved.ok && resolved.kind !== 'no_task') {
      return {
        taskId: undefined,
        ok: false,
        failures: [resolved.failure],
        checkedAt: new Date().toISOString(),
      };
    }
    if (resolved.ok) {
      return {
        taskId: resolved.binding.taskId,
        ok: false,
        failures: ['done completion must cite the disclosed canonical taskId'],
        checkedAt: new Date().toISOString(),
      };
    }
    const evidence = report.promotionEvidence;
    if (!evidence) {
      return {
        taskId: undefined,
        ok: false,
        failures: ['done completion requires structured pre-promotion evidence'],
        checkedAt: new Date().toISOString(),
      };
    }
    const contract =
      goal.promotionContract ?? deriveSupervisorPromotionContract({ autonomous: false });
    const plan = planProgressiveValidation({
      riskSpecificChecks: contract.materialRiskCriteria,
      triggers: Object.fromEntries(
        contract.broaderValidationTriggers.map((trigger) => [trigger, true]),
      ),
      repositoryPolicyRequiresBroadValidation: contract.repositoryPolicyRequiresBroadValidation,
    });
    const missingRiskCriteria = contract.materialRiskCriteria.filter(
      (criterion) =>
        !evidence.materialRiskChecks.some(
          (proof) => proof.criterion === criterion && proof.evidence.trim().length > 0,
        ),
    );
    const broadPassed =
      evidence.broaderValidation.performed === plan.broaderValidationRequired &&
      (!evidence.broaderValidation.performed ||
        (Boolean(evidence.broaderValidation.cost?.trim()) &&
          Boolean(evidence.broaderValidation.expectedInformationGain?.trim()) &&
          Boolean(evidence.broaderValidation.evidence?.trim())));
    const promotion = assessPromotion({
      prePromotionEvidencePassed:
        Boolean(evidence.focusedTests.trim()) &&
        Boolean(evidence.cheapestCompileTypeOrBuild.trim()) &&
        Boolean(evidence.criticalPathBehavior.trim()) &&
        missingRiskCriteria.length === 0 &&
        broadPassed,
      review: contract.review,
      reviewPassed: evidence.review.level === contract.review && evidence.review.passed,
      blockerFindings: evidence.blockerFindings,
    });
    return {
      taskId: undefined,
      ok: promotion.promotion === 'PROMOTABLE',
      failures: promotion.blockers,
      checkedAt: new Date().toISOString(),
      promotionEvidence: evidence,
    };
  }
  if (!resolved.ok) {
    return {
      taskId: '',
      ok: false,
      failures: [resolved.failure],
      checkedAt: new Date().toISOString(),
    };
  }
  if (report.taskId !== resolved.binding.taskId) {
    return {
      taskId: resolved.binding.taskId,
      ok: false,
      failures: ['done completion must cite the disclosed canonical taskId'],
      checkedAt: new Date().toISOString(),
    };
  }
  return evaluateTaskPromotionProof(db, {
    taskId: resolved.binding.taskId,
    repoPath: goal.repoPath,
  });
}

function trim(text: string, max = 12_000): string {
  return text.length <= max ? text : text.slice(text.length - max);
}

function exactRepositoryHead(repoPath: string): string | undefined {
  try {
    const marker = join(repoPath, '.git');
    const gitDir = statSync(marker).isDirectory()
      ? marker
      : resolve(repoPath, /^gitdir:\s*(.+)$/i.exec(readFileSync(marker, 'utf8').trim())?.[1] ?? '');
    const head = readFileSync(join(gitDir, 'HEAD'), 'utf8').trim();
    if (/^[a-f0-9]{40}$/.test(head)) return head;
    const ref = /^ref:\s*(.+)$/.exec(head)?.[1];
    if (!ref) return undefined;
    const commonDir = gitCommonDir(repoPath);
    const looseRef = [join(gitDir, ref), ...(commonDir ? [join(commonDir, ref)] : [])].find(
      existsSync,
    );
    if (looseRef) {
      const sha = readFileSync(looseRef, 'utf8').trim();
      if (/^[a-f0-9]{40}$/.test(sha)) return sha;
    }
    const packed = commonDir ? join(commonDir, 'packed-refs') : undefined;
    const sha =
      packed && existsSync(packed)
        ? new RegExp(`^([a-f0-9]{40}) ${ref.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'm').exec(
            readFileSync(packed, 'utf8'),
          )?.[1]
        : undefined;
    return sha;
  } catch {
    return undefined;
  }
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

export const HOST_PROVIDERS: Record<WorkerHost, string> = {
  claude: 'claude-code',
  codex: 'codex',
  cursor: 'cursor',
  antigravity: 'antigravity',
};

export type CoordinatorSelection =
  | {
      kind: 'route';
      host: WorkerHost;
      provider: string;
      /** Which authenticated account/profile of the provider this is, when
       * more than one is configured. 'default' when only one exists.
       * Passed through to runWorker and the Lima credential broker so a
       * named Codex account uses its own isolated auth slot. */
      accountLabel: string;
      modelRef: string;
      reason: string;
    }
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
  const stickyKey = lastCapacityKey({
    preferredCoordinator: goal.preferredCoordinator,
    hostProviders: HOST_PROVIDERS,
    ...(goal.lastCoordinator ? { lastCoordinator: goal.lastCoordinator } : {}),
    ...(goal.lastAccountLabel ? { lastAccountLabel: goal.lastAccountLabel } : {}),
  });
  const pooled = subscriptionAccountPool({
    providers,
    consecutiveFailures: goal.consecutiveFailures,
    ...(stickyKey ? { lastCapacityKey: stickyKey } : {}),
  });
  const ordered = [...pooled.providers].sort((left, right) =>
    compareSubscriptionAccounts(left, right, preferred),
  );
  let decision = route({ purpose: 'analysis', complexity: 'architectural' }, ordered);
  // Work-failure rotation may exclude the last key while another provider
  // remains. Quota rotation must not fall back to the full list: that is the
  // Codex failover bug (hopping to Claude and dropping vendor session/history).
  if (
    decision.kind === 'checkpoint' &&
    pooled.reason?.startsWith('work-failure rotation') &&
    pooled.providers.length !== providers.length
  ) {
    decision = route({ purpose: 'analysis', complexity: 'architectural' }, providers);
  }
  if (decision.kind === 'checkpoint') return decision;
  const parsed = parseCapacityKey(decision.provider);
  const host = PROVIDER_HOSTS[parsed.providerName];
  if (!host) return { kind: 'checkpoint', reason: `unsupported provider: ${decision.provider}` };
  return {
    kind: 'route',
    host,
    provider: decision.provider,
    accountLabel: parsed.accountLabel,
    modelRef: decision.modelRef,
    reason: pooled.reason ? `${pooled.reason}; ${decision.reason}` : decision.reason,
  };
}

/** Resolve and persist the one provider/model/account decision used by every
 * live execution backend. Retry-eligible capacity is consumed here so the
 * headless Major path and the explicit compatibility cycle cannot diverge. */
export function routeGoalExecution(
  goal: SupervisorGoal,
  options: { eligibleHosts?: readonly WorkerHost[] } = {},
): CoordinatorSelection {
  assertExecutionAllowed(getProjectPolicy(goal.project, goal.repoPath));
  const providerState = openDb();
  let selection: CoordinatorSelection;
  try {
    const providerInfos = loadPersistedProviderInfos(providerState.db);
    const eligibleHosts = options.eligibleHosts ? new Set(options.eligibleHosts) : undefined;
    const eligibleProviderInfos = eligibleHosts
      ? providerInfos.filter((provider) => {
          const host = PROVIDER_HOSTS[parseCapacityKey(provider.name).providerName];
          return host !== undefined && eligibleHosts.has(host);
        })
      : providerInfos;
    selection = selectCoordinator(goal, eligibleProviderInfos);
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
  if (selection.kind === 'route') {
    updateGoal(goal.id, routingDecisionGoalPatch(selection));
  }
  return selection;
}

export function routingDecisionGoalPatch(
  selection: Extract<CoordinatorSelection, { kind: 'route' }>,
  now: () => Date = () => new Date(),
): Pick<SupervisorGoal, 'lastRoutingDecision'> {
  return {
    lastRoutingDecision: {
      host: selection.host,
      provider: selection.provider,
      accountLabel: selection.accountLabel,
      modelRef: selection.modelRef,
      reason: selection.reason,
      selectedAt: now().toISOString(),
    },
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
          const reason = `Toolsmith checkpoint for ${operation}: ${[...new Set(reasons)].join(
            '; ',
          )}`;
          return {
            kind: 'checkpoint',
            reason:
              remaining.length === 0
                ? `${reason} ${priorArtDiscoveryDirective(operation)}`
                : reason,
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
  hop?: {
    accountLabel: string;
    continuityBlock: string;
    canonicalTask?: CanonicalTaskBinding;
  },
): string {
  const context = readProjectContext(goal.repoPath);
  const learningContext = readLearningContext(goal.project, goal.repoPath);
  let skillDisclosure: ReturnType<typeof discloseSkills> | undefined;
  let skillResolutionFailed = false;
  try {
    skillDisclosure = discloseSkills({ task: goal.goal, cwd: goal.repoPath });
  } catch {
    skillResolutionFailed = true;
  }
  const disclosedBodies = skillDisclosure?.bodies ?? [];
  const skillManifest = (skillDisclosure?.manifest ?? [])
    .map((skill) => `- ${skill.state} ${skill.id} (${skill.source}): ${skill.load}`)
    .join('\n');
  const skillBodies = disclosedBodies
    .map(
      (skill) =>
        `\n===== ${skill.state} MAJOR SKILL ${skill.id} (${skill.source})${skill.truncated ? ' [TRUNCATED]' : ''} =====\n${skill.content}`,
    )
    .join('\n');
  const skillMetrics = skillDisclosure
    ? `Disclosure bytes ${skillDisclosure.metrics.total.disclosedBytes}/${skillDisclosure.metrics.total.beforeBytes} (estimated tokens ${skillDisclosure.metrics.total.estimatedTokensDisclosed}/${skillDisclosure.metrics.total.estimatedTokensBefore}); body budget ${skillDisclosure.metrics.budgets.bodyBytes}, manifest budget ${skillDisclosure.metrics.budgets.manifestBytes}.`
    : '';
  const skillContext = skillResolutionFailed
    ? '(Major skill registry unavailable. Continue without skill context and report the degraded resolver in MAJOR_RESULT if it materially affects work.)'
    : `${skillMetrics}\n${skillManifest}${skillBodies}`;
  let assetContext: string;
  try {
    assetContext = formatReusableAssetDiscovery({ task: goal.goal, cwd: goal.repoPath });
  } catch {
    assetContext =
      'REUSABLE ASSET DISCOVERY (degraded): the metadata index is unavailable. Do not treat a repository search as the default reuse mechanism; report this degradation in MAJOR_RESULT if it materially affects work.';
  }
  const policy = getProjectPolicy(goal.project, goal.repoPath);
  const workerLanguage = `The project policy permits up to ${policy.maxWorkers} independent workers. Major's live resource ledger may lower that ceiling when CPU or memory is constrained. This leased worker must request additional capacity in its final report rather than nesting workers itself. Serialize only real write, interface, ordering, or scarce-resource conflicts.`;
  const workspaceContract =
    configuredExecutionPath() === 'host'
      ? `HOST WORKSPACE CONTRACT:
- Your current working directory is the canonical Major-verified worktree for the target above.
- Major's macOS Seatbelt boundary confines provider reads and writes to the admitted project and runtime roots.
- Confirm project identity from the embedded CANONICAL TARGET plus the source tree in your current cwd, then do all work there.
- Major records the provider process through the single headless gateway. It does not copy a patch through a second harness.
- Major binds every mutable dispatch to an internal source-tree digest and refuses execution if the canonical host tree changes. The digest is not sent to the provider.`
      : `ISOLATED WORKSPACE CONTRACT:
- Your current working directory is Major's verified source mirror of the canonical target above.
- This mirror intentionally excludes host .git; Lima may initialize a synthetic Git repo here with no remote or history.
- The canonical repository path names the host worktree; it is not mounted inside this guest.
- Do not treat missing host path access, Git remote, or history as identity failure inside this isolated workspace.
- Confirm project identity from the embedded CANONICAL TARGET plus the source tree in your current cwd, then do all work here.
- The parent coordinator validates your patch and applies it back to the canonical host worktree.
- Major binds every mutable dispatch to an internal source-tree digest and refuses execution or copy-back if the canonical host tree changes. The digest is not sent to the provider.`;

  return `You are the active Major coordinator for project ${goal.project}.

BOTTOM LINE: own this goal until the smallest credible end-to-end outcome is demonstrated or a genuine owner-only gate remains.

GOAL:
${goal.goal}

CANONICAL TARGET:
- project: ${goal.project}
- repository path: ${goal.repoPath}
${hop?.canonicalTask ? `\nQUALIFYING CANONICAL TASK:\n- task id: ${hop.canonicalTask.taskId}\n- frozen completion criteria: ${hop.canonicalTask.frozenCriteriaJson}\nTask workflows may cite this task ID; Major re-resolves it by repository identity.\n` : ''}
FROZEN NO-TASK PROMOTION CONTRACT:
${JSON.stringify(goal.promotionContract ?? deriveSupervisorPromotionContract({ requiredOperations: goal.requiredOperations, autonomous: goal.autonomous }))}
This contract is Major-owned and was fixed before this report; report evidence cannot redefine it.

${workspaceContract}

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

${formatCodexCapacityOverview(readCodexUsageReport())}

Before any substantive mutation, confirm the embedded CANONICAL TARGET and the source tree in your current cwd describe the same project. Do not treat a provider-boundary restriction as identity failure. If the task clearly belongs to another known project, do not patch the current worktree. Use project-context-integrity and reroute when unambiguous; ask only if the target is genuinely ambiguous. A correct fix in the wrong project is a failed task.

${trustContract(policy)}

MAJOR OPERATING CONTRACT:
- Treat contained, reversible and observable Workshop actions as autonomous progress. Use project policy for external effects and reserve owner gates for human-only consequential boundaries.
- Speed and MVP are the default. Reduce broad scope to the smallest end-to-end P0 that proves value. Make it work, make it useful, then improve it only while P0 gaps remain.
- Do not stop after one PR, migration, fix, test, or subtask. After each result ask: what is now the highest-impact missing piece blocking the goal?
- ${workerLanguage}
- Reuse the existing project, validated capability, maintained library or skill before building a new subsystem. For substantial infrastructure, follow the recorded ADOPT, WRAP, BORROW or BUILD decision.
- Keep the injected CURRENT PROJECT CONTEXT current through concise outcome, critical-path, ownership, interface, decision and evidence updates. Work the critical path first and remove the smallest present constraint.
- Prefer deletion and simpler code over new moving parts. Use FAST checks while iterating, acceptance evidence for the critical path, and only risk-proportionate independent review or frozen-candidate release validation.
- Progressive validation is the default: require focused changed-behavior tests, the cheapest relevant compile/type/build check, critical-path behavior, and checks for each material risk.
- Do not run broad suites unless explicit blast-radius, shared-dependency, insufficient-evidence, historical-regression, or promotion-policy triggers apply, or repository policy requires them. Before broad validation, record its cost versus expected information gain and run it only when that tradeoff supports the promotion decision.
- At the durable task-completion boundary, record each required progressive check through the existing qualifying verification/evidence path with its canonical validation subject. Use the existing review-finding storage mapping: BLOCKER → critical, IMPORTANT → minor, NIT → info; stored legacy major remains a BLOCKER.
- RESOLVED MAJOR SKILLS contains bounded resolver-selected guidance: HOT core bodies, ACTIVE SPECIALIST bodies, and a DORMANT manifest. Do not attempt host access to undisclosed skill paths.
- Read project LEARNINGS.md and the Major learning candidates below before acting. Do not repeat a captured correction merely because a fresh worker lacks chat history.
- Prefer the smallest capable tool/skill before creating more orchestration. If a short deterministic script can retrieve/filter/dedupe/transform data more reliably than repeated model turns, use Tools-as-Code.
- For substantial UI/website creation, redesign, art-direction changes, or "generic/AI-looking/too safe/too loud" feedback, use design-direction-and-taste first. It is the single Major art-direction/taste authority; do not stack competing generic taste systems.
- For MCP/connectors/plugins, distinguish installed → configured → exposed → authenticated → permissioned → operational → integrated. Use mcp-integration-ops and prove the needed state with a representative real operation.
- For customer-facing website QA, use website-design-qa. Pair responsive-motion-systems for GSAP/ScrollTrigger/sticky/pinned/Three.js or viewport-motion work. Respect remote-first-web-development for browser preview/acceptance unless the owner explicitly permits a local exception.
- Reuse an existing tested skill when one matches. When a novel procedure succeeds and is likely reusable, Skillify rather than growing the permanent supervisor workflow.
- Before building an implementation, follow the injected reusable-asset discovery order. Shared assets stay project-independent; keep domain composition in a project wrapper. If a verified implementation becomes reusable, report one optional \`assetCandidate\` object in MAJOR_RESULT with \`id\`, \`kind\`, \`summary\`, relative \`locator\`, \`tags\`, and proposed \`scope\` (\`project-local\` or \`shared\`). Major records it as a project-local \`REUSE_CANDIDATE\`; it never self-promotes.
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
- PROMOTABLE = required pre-promotion evidence and review passed with no BLOCKER; merge/install may proceed before installation proof exists.
- READY = a representative real-world outcome has succeeded under the intended trust profile.
Never use these terms interchangeably.

DURABLE CONTROL:
You cannot access or mutate Major's global control state. Before ending, emit exactly one final
single-line result for the parent coordinator to validate and apply:
Normal supervisor done claims require structured pre-promotion evidence; task workflows may instead cite their canonical task ID for durable database proof.
  MAJOR_RESULT: {"status":"active","summary":"what now works and next critical path","assetCandidate":{"id":"reusable-id","kind":"module","summary":"what it implements","locator":"relative/path","tags":["tag"],"scope":"shared"}}
  MAJOR_RESULT: {"status":"done","summary":"objective completion evidence","promotionEvidence":{"focusedTests":"focused changed-behavior tests passed","cheapestCompileTypeOrBuild":"typecheck passed","criticalPathBehavior":"critical path passed","materialRiskChecks":[],"broaderValidation":{"triggers":[],"repositoryPolicyRequires":false,"performed":false},"review":{"level":"none","passed":true},"blockerFindings":0}}
  MAJOR_RESULT: {"status":"blocked","summary":"what is complete","ownerGate":"exact owner action"}
Do not mark done unless the end-to-end goal is demonstrably true. A done claim still requires independent grading before trust promotion.

ACTIVE MAJOR LEARNINGS:
${learningContext}

RESOLVED MAJOR SKILLS:
${skillContext}

${assetContext}

CURRENT PROJECT CONTEXT:
${context || '(No canonical project context files found. Inspect the repository directly.)'}
${hop ? `\n${hop.continuityBlock}\nActive subscription account: ${hop.accountLabel}\n` : ''}
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

/** Whether a runGoalCycle() call actually attempted a coordinator turn.
 * `false` covers every early-return path (already terminal, awaiting an
 * independent completion grade, or another integration owner already holds
 * this repo's lock) — those are not this call's failure or capacity state
 * to report, and a caller looping on them must not mistake them for
 * progress. */
export interface GoalCycleOutcome {
  ranCycle: boolean;
}

export function supervisorRunInsight(input: {
  goal: Pick<SupervisorGoal, 'id' | 'goal'>;
  settled?: Pick<SupervisorGoal, 'status' | 'lastSummary' | 'ownerGate'>;
  selection: Extract<CoordinatorSelection, { kind: 'route' }>;
  skills: string[];
  outcome: WorkerOutcome;
  report?: ReturnType<typeof parseWorkerReport>;
  totalDurationMs: number;
  stages?: {
    majorPreparationMs?: number;
    majorFinalizationMs?: number;
  };
  sourceHead?: string;
}) {
  const workerDurationMs = Number.isFinite(
    input.outcome.providerExecutionMs ?? input.outcome.durationMs,
  )
    ? Math.max(0, input.outcome.providerExecutionMs ?? input.outcome.durationMs)
    : null;
  const preparationMs = input.stages?.majorPreparationMs;
  const finalizationMs = input.stages?.majorFinalizationMs;
  const majorOverheadMs =
    preparationMs !== undefined || finalizationMs !== undefined
      ? (preparationMs ?? 0) + (finalizationMs ?? 0)
      : null;
  const qualityAssessment =
    input.outcome.status === 'failed' || input.outcome.status === 'timed_out'
      ? 'failed'
      : 'unknown';
  const acceptedAsset =
    input.report?.assetCandidate && input.outcome.workspaceMutated
      ? [input.report.assetCandidate.id]
      : [];
  const diagnostic = trim(input.outcome.stderr || input.outcome.stdout, 2_000);
  const classifiedOutcome =
    input.report?.status === 'blocked' || input.settled?.status === 'blocked'
      ? 'blocked'
      : input.outcome.status === 'succeeded'
        ? 'completed'
        : 'failed';
  const recurrenceEvidence =
    classifiedOutcome === 'blocked'
      ? (input.settled?.ownerGate ?? input.report?.ownerGate)
      : diagnostic;
  const recurrenceSignature =
    classifiedOutcome === 'completed'
      ? null
      : `${classifiedOutcome}:${createHash('sha256')
          .update(recurrenceEvidence || classifiedOutcome)
          .digest('hex')
          .slice(0, 16)}`;
  return {
    schema: RUN_INSIGHT_SCHEMA,
    recordedAt: new Date().toISOString(),
    goalId: input.goal.id,
    goal: input.goal.goal,
    outcome: classifiedOutcome,
    status: input.report?.status ?? input.settled?.status ?? 'unknown',
    runtime: 'major',
    worker: {
      coordinator: input.selection.host,
      provider: input.selection.provider,
      model: input.selection.modelRef,
    },
    ...(input.outcome.runId && input.sourceHead
      ? { runEvidence: { runId: input.outcome.runId, sourceHead: input.sourceHead } }
      : {}),
    ...(input.report?.independentReview
      ? { independentReview: input.report.independentReview }
      : {}),
    skills: input.skills,
    timing: {
      durationMs: input.totalDurationMs,
      productiveWorkMs: workerDurationMs,
      productiveWorkRatio:
        workerDurationMs === null || input.totalDurationMs === 0
          ? null
          : Math.min(1, workerDurationMs / input.totalDurationMs),
      // These values are populated from the host-path worker timers. Older
      // DSH receipts remain valid and intentionally keep null where they did
      // not record a stage.
      majorOverheadMs,
      infrastructureOverheadMs: input.outcome.infrastructureOverheadMs ?? null,
      stages: {
        majorPreparationMs: preparationMs ?? null,
        resourceWaitMs: input.outcome.resourceWaitMs ?? null,
        gatewaySetupMs: input.outcome.gatewaySetupMs ?? null,
        workerExecutionMs: workerDurationMs,
        providerExecutionMs: workerDurationMs,
        majorFinalizationMs: finalizationMs ?? null,
        reviewMs: null,
      },
    },
    productiveWork: input.report?.summary ?? '',
    effects: [],
    failures: input.outcome.status === 'succeeded' || !diagnostic ? [] : [diagnostic],
    recurrence: {
      signature: recurrenceSignature,
      priorOccurrences: null,
      evidence: recurrenceEvidence || null,
    },
    humanInterventions: input.settled?.ownerGate ? [input.settled.ownerGate] : [],
    quality: { assessment: qualityAssessment, evidence: [] },
    finalOutcome: input.settled?.lastSummary ?? input.report?.summary ?? diagnostic,
    reuseStrategy: {
      strategy: acceptedAsset.length ? 'explicit_worker_asset_candidate' : null,
      reusableAssets: acceptedAsset,
    },
    learning: {
      disposition: 'observation_only',
      promotionEligible: false,
      durableMeaningOwner: 'gbrain',
    },
    telemetry: { highVolume: 'disabled_by_default', export: 'optional_async_best_effort' },
  };
}

export async function runGoalCycle(
  goalId: string,
  options: { maxTimeoutMs?: number } = {},
): Promise<GoalCycleOutcome> {
  const goal = getGoal(goalId);
  if (!goal) throw new Error(`goal not found: ${goalId}`);
  if (goal.status === 'done' || goal.status === 'paused') return { ranCycle: false };
  if (goal.pendingCompletion) {
    console.error(`Goal ${goal.id} is awaiting an independent completion grade.`);
    return { ranCycle: false };
  }
  const releaseRepoLock = tryAcquireRepoCycleLock(goal.repoPath);
  if (!releaseRepoLock) {
    console.error(`Repository ${goal.repoPath} already has an active Major integration owner.`);
    return { ranCycle: false };
  }
  try {
    await runLockedGoalCycle(goal, options.maxTimeoutMs);
    return { ranCycle: true };
  } finally {
    releaseRepoLock();
  }
}

/** Bounded safety net so an authoritative-exhaustion loop can never hot-loop
 * forever even if capacity bookkeeping is wrong. Deliberately well above any
 * realistic near-term provider x model x account count rather than a tight
 * fit to today's four providers, so a legitimately larger capacity pool
 * cannot be mistaken for exhaustion. */
const FOREGROUND_CONTINUATION_HOP_LIMIT = 32;

/**
 * Run an already-authorized foreground goal forward to its next real
 * stopping point. One provider or account hitting an authoritative rate
 * limit or exhaustion is capacity unavailability, not a reason the goal
 * should stall: this immediately re-selects from the remaining capacity
 * pool and keeps driving the SAME goal, so a `major run --foreground`
 * invocation does not depend on being reissued by whichever session or
 * process happened to dispatch it.
 *
 * It stops the instant a cycle resolves for any other reason (success,
 * generic failure, done, blocked, or no capacity left at all), the cycle
 * made no observable progress (e.g. another integration owner is already
 * running against this repo), or the bounded hop/time budget is spent.
 * This is not unattended background looping: it is still one synchronous,
 * already-approved foreground call. Each hop's worker timeout is clamped to
 * whatever of the project's maxRunMinutes budget remains, rather than every
 * hop separately getting a fresh full allowance — this keeps a rotation
 * across several exhausted providers from stacking multiple full
 * maxRunMinutes durations end to end. It is a budget clamp, not a hard
 * real-time guarantee: runWorker's own resource-lease wait can still let one
 * hop run somewhat past its requested timeout under lease contention, the
 * same way a single non-looping foreground cycle always could.
 */
export interface ForegroundGoalOutcome {
  /** How many cycles actually ran (repo-lock contention or an early-return
   * goal state counts as zero, however many hops were attempted). A caller
   * that dispatched this and sees 0 knows nothing new happened this call --
   * e.g. another integration owner already had the repo lock -- instead of
   * mistaking a silent no-op for a completed run. */
  hops: number;
}

export async function runForegroundGoal(
  goalId: string,
  options: {
    maxRunMinutes?: number;
    /** Injectable for tests; defaults to the real single-cycle dispatch. */
    runCycle?: (
      goalId: string,
      cycleOptions?: { maxTimeoutMs?: number },
    ) => Promise<GoalCycleOutcome>;
  } = {},
): Promise<ForegroundGoalOutcome> {
  const runCycle = options.runCycle ?? runGoalCycle;
  const maxRunMinutes = Math.max(1, options.maxRunMinutes ?? 120);
  const deadline = Date.now() + maxRunMinutes * 60 * 1000;
  let hops = 0;
  for (let hop = 0; hop < FOREGROUND_CONTINUATION_HOP_LIMIT; hop++) {
    const remainingMs = deadline - Date.now();
    if (remainingMs <= 0) break;
    const { ranCycle } = await runCycle(goalId, { maxTimeoutMs: remainingMs });
    // The repo lock was held by another integration owner, or the goal hit
    // an early-return path (already done/paused/awaiting completion): this
    // call contributed nothing. Stop rather than hot-loop or fabricate a
    // "capacity rotation happened" cleanup for a cycle that never ran.
    if (!ranCycle) return { hops };
    hops += 1;
    const goal = getGoal(goalId);
    if (!goal?.retryImmediately) return { hops };
    if (goal.status !== 'active' && goal.status !== 'running') return { hops };
  }
  const stalled = getGoal(goalId);
  if (stalled?.retryImmediately) {
    updateGoal(goalId, {
      retryImmediately: false,
      lastSummary: trim(
        `${stalled.lastSummary ?? ''} Foreground continuation stopped after rotating through available capacity; checkpointing instead of hot-looping.`.trim(),
      ),
      nextRunAt: new Date(Date.now() + 60_000).toISOString(),
    });
  }
  return { hops };
}

async function runLockedGoalCycle(goal: SupervisorGoal, maxTimeoutMs?: number): Promise<void> {
  const cycleStartedAtMs = Date.now();
  const policy = getProjectPolicy(goal.project, goal.repoPath);
  const selection = routeGoalExecution(goal);
  if (selection.kind === 'checkpoint') {
    // No eligible capacity remains anywhere in the pool: a genuine stop, not
    // a hop the foreground continuation loop should chase further.
    const summary = `Provider routing checkpoint: ${selection.reason}`;
    updateGoal(goal.id, {
      status: 'active',
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary: summary,
      nextRunAt: new Date(Date.now() + 60_000).toISOString(),
      retryImmediately: false,
    });
    console.error(summary);
    return;
  }
  const routedSelection = selection;
  if (!hostAvailable(routedSelection.host)) {
    const executable = workerCommand(routedSelection.host, '').command;
    const summary =
      `Provider routing checkpoint: ${routedSelection.provider}/${routedSelection.modelRef} is persisted as ` +
      `available but the canonical CLI is missing at ${resolve(majorHome(), '..', '.local', 'bin', executable)}. ` +
      'Marking it unavailable and rerouting to the next candidate instead of selecting it again.';
    const unavailableState = openDb();
    try {
      recordModelOutcome(unavailableState.db, {
        providerName: routedSelection.provider,
        modelRef: routedSelection.modelRef,
        outcome: 'unknown',
      });
    } finally {
      unavailableState.sqlite.close();
    }
    updateGoal(goal.id, {
      status: 'active',
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary: summary,
      nextRunAt: new Date().toISOString(),
      // One more candidate was just removed from the pool; let the
      // foreground continuation loop try again immediately rather than
      // repeatedly re-selecting a CLI that isn't actually installed.
      retryImmediately: true,
    });
    console.error(summary);
    return;
  }
  const host = routedSelection.host;
  const capabilityResolution = resolveGoalCapabilities(goal);
  if (capabilityResolution.kind === 'checkpoint') {
    updateGoal(goal.id, {
      status: 'blocked',
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary: capabilityResolution.reason,
      nextRunAt: undefined,
      ownerGate: 'Review the Toolsmith checkpoint or register an approved capability.',
      retryImmediately: false,
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
    lastAccountLabel: routedSelection.accountLabel,
    // A new routed cycle is evidence that the prior owner gate has been
    // superseded. Keep owner gates attached only to the blocked cycle that
    // actually requires the human action.
    ownerGate: undefined,
    pendingCompletion: undefined,
  });

  const continuity = contextContinuity({
    nextHost: host,
    nextAccountLabel: routedSelection.accountLabel,
    ...(goal.lastCoordinator ? { lastCoordinator: goal.lastCoordinator } : {}),
    ...(goal.lastAccountLabel ? { lastAccountLabel: goal.lastAccountLabel } : {}),
    ...(goal.lastSessionRef ? { lastSessionRef: goal.lastSessionRef } : {}),
    ...(goal.lastSummary ? { lastSummary: goal.lastSummary } : {}),
  });
  if (!goal.promotionContract) {
    goal.promotionContract = deriveSupervisorPromotionContract({
      requiredOperations: goal.requiredOperations,
      autonomous: goal.autonomous,
    });
    updateGoal(goal.id, { promotionContract: goal.promotionContract });
  }
  const workerStartedAtMs = Date.now();
  let canonicalTask: CanonicalTaskBinding | undefined;
  const taskState = openDb();
  try {
    const resolvedTask = resolveCanonicalTaskBinding(taskState.db, goal.repoPath);
    if (resolvedTask.ok) canonicalTask = resolvedTask.binding;
  } finally {
    taskState.sqlite.close();
  }
  const outcome = await runWorker({
    host,
    taskId: goal.id,
    resourceId: `worker:${goal.project}`,
    prompt: coordinatorPrompt(goal, capabilityResolution.capabilities, {
      accountLabel: routedSelection.accountLabel,
      continuityBlock: continuity.promptBlock,
      ...(canonicalTask ? { canonicalTask } : {}),
    }),
    cwd: goal.repoPath,
    // Clamped to whatever foreground continuation budget remains, so a
    // rotation across several exhausted providers cannot stack multiple
    // full maxRunMinutes allowances into a much longer total wall-clock.
    timeoutMs: Math.min(Math.max(1, policy.maxRunMinutes) * 60 * 1000, maxTimeoutMs ?? Infinity),
    modelRef: routedSelection.modelRef,
    accountLabel: routedSelection.accountLabel,
    ...(continuity.resumeSessionRef ? { resumeSessionRef: continuity.resumeSessionRef } : {}),
  });
  const workerFinishedAtMs = Date.now();
  const sourceHead = exactRepositoryHead(goal.repoPath);
  let terminalReport: ReturnType<typeof parseWorkerReport> = undefined;
  const recordTerminalObservation = () => {
    const settled = getGoal(goal.id);
    try {
      const observationState = openDb();
      try {
        recordPerformanceObservation(observationState.db, {
          project: goal.project,
          source: 'major',
          receipt: supervisorRunInsight({
            goal,
            ...(settled ? { settled } : {}),
            selection: routedSelection,
            skills: routedSkillIds,
            outcome,
            ...(terminalReport ? { report: terminalReport } : {}),
            totalDurationMs: Math.max(0, Date.now() - cycleStartedAtMs),
            stages: {
              majorPreparationMs: Math.max(0, workerStartedAtMs - cycleStartedAtMs),
              majorFinalizationMs: Math.max(0, Date.now() - workerFinishedAtMs),
            },
            ...(sourceHead ? { sourceHead } : {}),
          }),
        });
      } finally {
        observationState.sqlite.close();
      }
    } catch {
      // Historical observation is best effort and cannot reverse user work.
    }
  };
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
        providerName: routedSelection.provider,
        modelRef: routedSelection.modelRef,
        outcome: modelOutcome,
      });
    } finally {
      outcomeState.sqlite.close();
    }
  }
  const after = getGoal(goal.id);
  if (!after) {
    recordTerminalObservation();
    return;
  }
  if (after.status === 'done' || after.status === 'blocked' || after.status === 'paused') {
    updateGoal(goal.id, { activePid: undefined, lastFinishedAt: new Date().toISOString() });
    recordTerminalObservation();
    return;
  }

  if (outcome.status === 'succeeded') {
    const report = parseWorkerReport(outcome.stdout);
    terminalReport = report;
    const mutationClaimRefusal = codexMutationClaimRefusal(outcome, report);
    if (mutationClaimRefusal) {
      // A rejected readiness claim is not a trusted source for capability-use
      // or learning self-reports. Refuse it before recording either one.
      updateGoal(goal.id, mutationClaimRefusalGoalPatch(after, mutationClaimRefusal, outcome));
      recordTerminalObservation();
      return;
    }
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
    if (report?.assetCandidate && outcome.workspaceMutated) {
      try {
        observeReusableAssetCandidate({
          ...report.assetCandidate,
          sourceProject: goal.repoPath,
          narrative: report.summary,
        });
      } catch (error) {
        learningWarning += ` Asset candidate capture deferred: ${trim(error instanceof Error ? error.message : String(error), 2_000)}`;
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
        retryImmediately: false,
        ...(outcome.sessionRef ? { lastSessionRef: outcome.sessionRef } : {}),
      });
      recordTerminalObservation();
      return;
    }
    if (report?.status === 'done') {
      const completionState = openDb();
      let promotionProof: ReturnType<typeof coordinatorDonePromotionProof>;
      try {
        promotionProof = coordinatorDonePromotionProof(completionState.db, goal, report);
      } finally {
        completionState.sqlite.close();
      }
      if (!promotionProof?.ok) {
        updateGoal(goal.id, {
          status: 'active',
          consecutiveFailures: 0,
          activePid: undefined,
          lastFinishedAt: new Date().toISOString(),
          lastSummary:
            `Worker done claim refused by canonical promotion proof: ` +
            `${promotionProof?.failures.join('; ') ?? 'proof unavailable'}${learningWarning}`,
          nextRunAt: new Date(Date.now() + 10_000).toISOString(),
          pendingCompletion: undefined,
          retryImmediately: false,
          ...(outcome.sessionRef ? { lastSessionRef: outcome.sessionRef } : {}),
        });
        recordTerminalObservation();
        return;
      }
      const claimedAt = new Date().toISOString();
      updateGoal(goal.id, {
        status: 'active',
        consecutiveFailures: 0,
        activePid: undefined,
        lastFinishedAt: claimedAt,
        lastSummary: `Worker completion claim awaiting independent validation: ${report.summary}${learningWarning}`,
        nextRunAt: undefined,
        pendingCompletion: {
          summary: report.summary,
          coordinator: host,
          claimedAt,
          ...(promotionProof.taskId ? { taskId: promotionProof.taskId } : {}),
          promotionCheckedAt: promotionProof.checkedAt,
          ...(sourceHead ? { sourceHead } : {}),
          ...('promotionEvidence' in promotionProof && promotionProof.promotionEvidence
            ? { promotionEvidence: promotionProof.promotionEvidence }
            : {}),
          promotionContract: structuredClone(
            goal.promotionContract ??
              deriveSupervisorPromotionContract({
                requiredOperations: goal.requiredOperations,
                autonomous: goal.autonomous,
              }),
          ),
        },
        retryImmediately: false,
        ...(outcome.sessionRef ? { lastSessionRef: outcome.sessionRef } : {}),
      });
      recordTerminalObservation();
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
      retryImmediately: false,
      ...(outcome.sessionRef ? { lastSessionRef: outcome.sessionRef } : {}),
    });
    recordTerminalObservation();
  } else {
    const patch = nonSuccessCyclePatch({
      modelOutcome,
      stderr: outcome.stderr,
      stdout: outcome.stdout,
      provider: routedSelection.provider,
      modelRef: routedSelection.modelRef,
      host,
      consecutiveFailures: after.consecutiveFailures,
    });
    updateGoal(goal.id, {
      status: patch.status,
      consecutiveFailures: patch.consecutiveFailures,
      activePid: undefined,
      lastFinishedAt: new Date().toISOString(),
      lastSummary:
        patch.retryImmediately && after.lastSummary
          ? trim(`${after.lastSummary}\n${patch.lastSummary}`)
          : patch.lastSummary,
      nextRunAt: new Date(Date.now() + patch.nextRunDelayMs).toISOString(),
      pendingCompletion: undefined,
      retryImmediately: patch.retryImmediately,
    });
    recordTerminalObservation();
  }
}

/** A provider report is never proof that files changed. Lima's returned-tree
 * comparison is the authority: when it explicitly observed no delta, Codex
 * may not label the implementation with the canonical BUILT readiness claim.
 * Read-only work may still legitimately report done without a project delta. */
export function codexMutationClaimRefusal(
  outcome: Pick<WorkerOutcome, 'host' | 'workspaceMutated'>,
  report: ReturnType<typeof parseWorkerReport>,
): string | undefined {
  if (outcome.host !== 'codex' || outcome.workspaceMutated !== false || !report) return undefined;
  if (!/^BUILT(?:\b|:)/.test(report.summary)) return undefined;
  return (
    'Rejected Codex mutation claim: the contained execution backend compared the returned workspace ' +
    'with its input and observed no project delta. The task remains active.'
  );
}

export function mutationClaimRefusalGoalPatch(
  goal: Pick<SupervisorGoal, 'consecutiveFailures'>,
  refusal: string,
  outcome: Pick<WorkerOutcome, 'sessionRef'>,
): Partial<SupervisorGoal> {
  const failure = nonSuccessCyclePatch({
    modelOutcome: undefined,
    stderr: refusal,
    stdout: '',
    provider: 'codex',
    modelRef: 'readiness-claim',
    host: 'codex',
    consecutiveFailures: goal.consecutiveFailures,
  });
  return {
    status: failure.status,
    consecutiveFailures: failure.consecutiveFailures,
    activePid: undefined,
    lastFinishedAt: new Date().toISOString(),
    lastSummary: failure.lastSummary,
    nextRunAt: new Date(Date.now() + failure.nextRunDelayMs).toISOString(),
    pendingCompletion: undefined,
    retryImmediately: failure.retryImmediately,
    ...(outcome.sessionRef ? { lastSessionRef: outcome.sessionRef } : {}),
  };
}

/**
 * Pure classification of a non-succeeded worker outcome, split out so the
 * distinction between authoritative provider state and a genuine work
 * failure is unit-testable without a live DB/CLI/Lima stack.
 *
 * A defined modelOutcome ('exhausted', 'rate_limited', or 'unknown' for an
 * auth/trust failure) means this exact provider/model was just recorded as
 * ineligible in the discovery store: it is authoritative capacity state,
 * not a work failure, so it must not count against consecutiveFailures or
 * apply the generic exponential backoff. It marks the goal immediately
 * retriable so the foreground continuation loop reroutes to the next
 * eligible provider/account without waiting on an external retrigger — the
 * pool only shrinks each hop, so this cannot loop past its bounded size.
 * An undefined modelOutcome carries no provider-state signal at all (a
 * generic bug, timeout, or failing test) and is treated as before: a
 * genuine failure that backs off and, after enough repeats, gives up.
 */
export function nonSuccessCyclePatch(input: {
  modelOutcome: ReturnType<typeof modelOutcomeForWorker>;
  stderr: string;
  stdout: string;
  provider: string;
  modelRef: string;
  host: WorkerHost;
  consecutiveFailures: number;
}): {
  status: 'active' | 'failed';
  consecutiveFailures: number;
  lastSummary: string;
  nextRunDelayMs: number;
  retryImmediately: boolean;
} {
  if (input.modelOutcome !== undefined && input.modelOutcome !== 'available') {
    const stateDescription =
      input.modelOutcome === 'unknown'
        ? 'unavailable (authentication/trust failure)'
        : input.modelOutcome;
    return {
      status: 'active',
      consecutiveFailures: input.consecutiveFailures,
      lastSummary:
        `Provider ${input.provider}/${input.modelRef} reported ${stateDescription}; ` +
        'marked unavailable and rerouting to the next available capacity.',
      nextRunDelayMs: 0,
      retryImmediately: true,
    };
  }
  const failures = input.consecutiveFailures + 1;
  return {
    status: failures >= 6 ? 'failed' : 'active',
    consecutiveFailures: failures,
    lastSummary: trim(input.stderr || input.stdout || `Coordinator ${input.host} failed.`),
    nextRunDelayMs: Math.min(60_000, failures * 10_000),
    retryImmediately: false,
  };
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
    try {
      reconcileAfterCancel();
    } catch {
      // best effort host reclaim on daemon cancel
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
      if (goal.liveWorker) {
        const fresh = isLiveWorkerFresh(goal.liveWorker);
        const ageMin = Math.round((Date.now() - Date.parse(goal.liveWorker.heartbeatAt)) / 60_000);
        lines.push(
          `live worker: ${goal.liveWorker.host}@${goal.liveWorker.sessionId} ` +
            (fresh ? `(heartbeat ${ageMin}m ago)` : '(stale, reclaimable)'),
        );
      }
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

/**
 * Header block for `major status`: kill-switch state, per-host Major
 * integration (rules/hook installed -- distinct from whether that host's own
 * CLI is present, which `major hosts` covers), execution-provider health,
 * fallback capacity, and last persisted Codex capacity. DB/snapshot-only;
 * never spawns or probes a live provider. Refresh is `major provider usage`.
 */
export function majorStatusOverview(): string {
  const opened = openDb();
  let infos: ProviderInfo[];
  try {
    infos = loadPersistedProviderInfos(opened.db);
  } finally {
    opened.sqlite.close();
  }
  const readiness = infos.map((info) => computeProviderReadiness(info));
  const healthy = readiness.filter((r) => r.state === 'READY');

  const hostsLine = SUPPORTED_HOSTS.map((host) => {
    const status = hostIntegrationStatus(host);
    const label =
      status.rulesInstalled && status.hookInstalled
        ? 'integrated'
        : status.rulesInstalled
          ? 'rules only'
          : 'not integrated';
    return `${host}(${label})`;
  }).join(' ');

  const providersLine =
    readiness.length > 0
      ? readiness.map((r) => `${r.provider}=${r.state}`).join(' ')
      : 'none discovered';
  const executionPath = executionPathStatus();

  return [
    `MAJOR: ${globalStopRequested() ? 'STOPPED (kill switch active)' : 'ACTIVE'}`,
    '',
    `Hosts:                ${hostsLine}`,
    `Execution path:       ${executionPath.path} (${executionPath.source})`,
    `Execution providers:  ${providersLine}`,
    `Fallback capacity:    ${healthy.length} healthy provider${healthy.length === 1 ? '' : 's'}`,
    formatCodexCapacityOverview(readCodexUsageReport()),
  ].join('\n');
}

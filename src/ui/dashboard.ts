import { resolve } from 'node:path';
import { openDb } from '../db/client.js';
import { loadPersistedProviderInfos } from '../providers/discovery-store.js';
import { computeProviderReadiness } from '../doctor/readiness.js';
import {
  listPerformanceObservations,
  performanceHistoryReport,
} from '../insights/performance-history.js';
import { listLearningCandidates } from '../learning/candidates.js';
import { auditSkillReachability, resolveSkills } from '../skills/resolver.js';
import { getProjectPolicy } from '../supervisor/policy.js';
import { readSupervisorState, resolveProject, resolveProjectForCwd } from '../supervisor/state.js';
import { resourceSnapshot } from '../supervisor/resources.js';
import { activeExecutionPathStatus, inspectMajorExecutionPath } from '../security/major-gateway.js';
import { hostIntegrationStatus, SUPPORTED_HOSTS } from '../context/host-integration.js';

export interface MajorDashboard {
  schema: 'major.dashboard.v1';
  generatedAt: string;
  project: { identity: string; repoPath: string } | null;
  objective: {
    id: string;
    goal: string;
    status: string;
    cycle: number;
    lastSummary?: string;
    ownerGate?: string;
  } | null;
  policy: {
    projectClass: string;
    trust: string;
    maxWorkers: number;
    maxRunMinutes: number;
    allowBackground: boolean;
  } | null;
  gbrain: {
    status: 'active' | 'degraded' | 'unavailable';
    projectBrainLoaded: boolean;
    retrievedMemoryCount: number;
    sources: string[];
  };
  context: {
    memories: string[];
    decisions: string[];
    unresolvedQuestions: string[];
  };
  workers: {
    status: 'working' | 'reviewing' | 'blocked' | 'available';
    host: string;
    provider: string;
    account?: string;
    model?: string;
    goalId: string;
  }[];
  execution: {
    selection: ReturnType<typeof activeExecutionPathStatus>;
    boundary: Awaited<ReturnType<typeof inspectMajorExecutionPath>>;
  };
  resources: ReturnType<typeof resourceSnapshot>['telemetry'];
  providers: {
    name: string;
    state: string;
    detail: string;
    models: string[];
  }[];
  hosts: {
    host: string;
    rulesInstalled: boolean;
    hookInstalled: boolean;
    lastAttachedAt?: string;
  }[];
  skills: {
    selected: { id: string; score: number; reason: string }[];
    internalReachable: number;
    internalTotal: number;
    duplicateIds: string[];
    orphanInternalSkills: string[];
  };
  learning: {
    status: string;
    occurrences: number;
    summary: string;
    evidence: string[];
  }[];
  history: ReturnType<typeof performanceHistoryReport>;
  recentRuns: {
    goalId: string;
    recordedAt: string;
    outcome?: string;
    worker?: string;
    durationMs?: number | null;
    productiveWorkRatio?: number | null;
    majorOverheadMs?: number | null;
    infrastructureOverheadMs?: number | null;
  }[];
}

function currentProject(cwd: string): { project: string; repoPath: string } | null {
  const attached = resolveProjectForCwd(cwd);
  if (attached) return attached;
  try {
    return resolveProject('current', cwd);
  } catch {
    return null;
  }
}

function currentObjective(project: { project: string; repoPath: string } | null) {
  if (!project) return null;
  const goals = readSupervisorState()
    .goals.filter(
      (goal) =>
        goal.project === project.project || resolve(goal.repoPath) === resolve(project.repoPath),
    )
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const goal = goals[0];
  if (!goal) return null;
  return {
    id: goal.id,
    goal: goal.goal,
    status: goal.status,
    cycle: goal.cycle,
    ...(goal.lastSummary ? { lastSummary: goal.lastSummary } : {}),
    ...(goal.ownerGate ? { ownerGate: goal.ownerGate } : {}),
  };
}

/** Read the existing control-plane stores. No worker, provider model call,
 * shell, or high-volume telemetry operation occurs on this path. */
export async function buildMajorDashboard(cwd = process.cwd()): Promise<MajorDashboard> {
  const project = currentProject(resolve(cwd));
  const objective = currentObjective(project);
  const policy = project ? getProjectPolicy(project.project, project.repoPath) : null;
  const selectedTask = objective?.goal ?? '';

  let providers: MajorDashboard['providers'] = [];
  let history: MajorDashboard['history'] = performanceHistoryReport([]);
  let recentRuns: MajorDashboard['recentRuns'] = [];
  let learningAvailable = true;
  if (project) {
    const opened = openDb();
    try {
      const infos = loadPersistedProviderInfos(opened.db);
      providers = infos.map((info) => {
        const readiness = computeProviderReadiness(info);
        return {
          name: info.name,
          state: readiness.state,
          detail: readiness.detail,
          models: info.models.map((model) => `${model.modelRef}:${model.availability}`),
        };
      });
      const observations = listPerformanceObservations(opened.db, project.project);
      history = performanceHistoryReport(observations);
      recentRuns = observations.slice(0, 12).map((receipt) => ({
        goalId: receipt.goalId,
        recordedAt: receipt.recordedAt,
        ...(receipt.outcome ? { outcome: receipt.outcome } : {}),
        ...(receipt.worker
          ? {
              worker: [receipt.worker.coordinator, receipt.worker.provider, receipt.worker.model]
                .filter(Boolean)
                .join('/'),
            }
          : {}),
        ...(receipt.timing?.durationMs !== undefined
          ? { durationMs: receipt.timing.durationMs }
          : {}),
        ...(receipt.timing?.productiveWorkRatio !== undefined
          ? { productiveWorkRatio: receipt.timing.productiveWorkRatio }
          : {}),
        ...(receipt.timing?.majorOverheadMs !== undefined
          ? { majorOverheadMs: receipt.timing.majorOverheadMs }
          : {}),
        ...(receipt.timing?.infrastructureOverheadMs !== undefined
          ? { infrastructureOverheadMs: receipt.timing.infrastructureOverheadMs }
          : {}),
      }));
    } finally {
      opened.sqlite.close();
    }
  }

  let selected: MajorDashboard['skills']['selected'] = [];
  let skillAudit = {
    internal: [],
    vendor: [],
    duplicateIds: [],
    orphanInternalSkills: [],
  } as ReturnType<typeof auditSkillReachability>;
  if (project) {
    skillAudit = auditSkillReachability(project.repoPath);
    if (selectedTask) {
      try {
        selected = resolveSkills({ task: selectedTask, cwd: project.repoPath }).skills.map(
          (skill) => ({
            id: skill.id,
            score: skill.score,
            reason: skill.reason,
          }),
        );
      } catch {
        selected = [];
      }
    }
  }

  let learning: MajorDashboard['learning'] = [];
  if (project) {
    try {
      learning = listLearningCandidates(project.project, undefined, project.repoPath)
        .filter((candidate) => candidate.status !== 'dismissed')
        .sort(
          (left, right) =>
            right.occurrences - left.occurrences || right.updatedAt.localeCompare(left.updatedAt),
        )
        .slice(0, 12)
        .map((candidate) => ({
          status: candidate.status,
          occurrences: candidate.occurrences,
          summary: candidate.summary,
          evidence: candidate.evidence.slice(0, 3),
        }));
    } catch {
      learningAvailable = false;
      learning = [];
    }
  }

  const state = readSupervisorState();
  const projectGoals = project
    ? state.goals
        .filter(
          (goal) =>
            goal.project === project.project ||
            resolve(goal.repoPath) === resolve(project.repoPath),
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 12)
    : [];
  const workerGoals = projectGoals.filter(
    (goal) =>
      goal.status === 'active' ||
      goal.status === 'running' ||
      goal.status === 'blocked' ||
      goal.status === 'paused' ||
      Boolean(goal.liveWorker || goal.activePid || goal.pendingCompletion),
  );
  const workers: MajorDashboard['workers'] = workerGoals.map((goal) => {
    const routing = goal.lastRoutingDecision;
    const account = routing?.accountLabel ?? goal.lastAccountLabel;
    const status: MajorDashboard['workers'][number]['status'] =
      goal.liveWorker || goal.activePid || goal.status === 'running'
        ? 'working'
        : goal.pendingCompletion
          ? 'reviewing'
          : goal.status === 'blocked' || goal.status === 'failed' || goal.status === 'paused'
            ? 'blocked'
            : 'available';
    return {
      status,
      host: routing?.host ?? goal.lastCoordinator ?? goal.preferredCoordinator,
      provider: routing?.provider ?? 'unknown',
      ...(account ? { account } : {}),
      ...(routing?.modelRef ? { model: routing.modelRef } : {}),
      goalId: goal.id,
    };
  });
  const decisions = projectGoals.flatMap((goal) =>
    goal.lastRoutingDecision
      ? [
          `${goal.lastRoutingDecision.provider}/${goal.lastRoutingDecision.modelRef}: ${goal.lastRoutingDecision.reason}`,
        ]
      : [],
  );
  const unresolvedQuestions = projectGoals.flatMap((goal) =>
    goal.ownerGate ? [`${goal.id}: ${goal.ownerGate}`] : [],
  );
  const attachments = [...state.sessions].reverse();
  return {
    schema: 'major.dashboard.v1',
    generatedAt: new Date().toISOString(),
    project: project ? { identity: project.project, repoPath: project.repoPath } : null,
    objective,
    policy: policy
      ? {
          projectClass: policy.projectClass,
          trust: policy.trust,
          maxWorkers: policy.maxWorkers,
          maxRunMinutes: policy.maxRunMinutes,
          allowBackground: policy.allowBackground,
        }
      : null,
    gbrain: {
      status: project ? (learningAvailable ? 'active' : 'degraded') : 'unavailable',
      projectBrainLoaded: Boolean(project),
      retrievedMemoryCount: learning.length,
      sources: [
        'supervisor-state',
        'project-policy',
        'skill-resolver',
        'run-insight-history',
        ...(learningAvailable ? ['GBrain/project-learning'] : []),
      ],
    },
    context: {
      memories: learning
        .slice(0, 6)
        .map((candidate) => `${candidate.occurrences}x: ${candidate.summary}`),
      decisions: decisions.length
        ? decisions
        : ['No durable routing decision recorded for this project.'],
      unresolvedQuestions,
    },
    workers,
    execution: {
      selection: activeExecutionPathStatus(),
      boundary: await inspectMajorExecutionPath(),
    },
    resources: resourceSnapshot().telemetry,
    providers,
    hosts: SUPPORTED_HOSTS.map((host) => {
      const status = hostIntegrationStatus(host);
      const attached = attachments.find((session) => session.host === host && session.sessionId);
      return {
        host,
        rulesInstalled: status.rulesInstalled,
        hookInstalled: status.hookInstalled,
        ...(attached?.attachedAt ? { lastAttachedAt: attached.attachedAt } : {}),
      };
    }),
    skills: {
      selected,
      internalReachable: skillAudit.internal.filter((skill) => skill.reachable).length,
      internalTotal: skillAudit.internal.length,
      duplicateIds: skillAudit.duplicateIds,
      orphanInternalSkills: skillAudit.orphanInternalSkills,
    },
    learning,
    history,
    recentRuns,
  };
}

export async function answerMajorMessage(
  message: string,
  cwd = process.cwd(),
): Promise<{ answer: string; dashboard: MajorDashboard }> {
  const dashboard = await buildMajorDashboard(cwd);
  const lower = message.toLowerCase();
  const formatMs = (value: number | null | undefined): string =>
    typeof value === 'number' && Number.isFinite(value) ? `${Math.round(value)} ms` : 'unknown';
  if (lower.includes('long') || lower.includes('time') || lower.includes('where')) {
    const latest = dashboard.recentRuns[0];
    const latestStages = latest
      ? dashboard.history.observedStageTiming.find((run) => run.goalId === latest.goalId)?.stages
      : undefined;
    const stages = latestStages
      ? Object.entries(latestStages)
          .filter(([, value]) => typeof value === 'number')
          .map(([name, value]) => `${name} ${formatMs(value)}`)
          .join(', ')
      : 'stage detail unavailable';
    return {
      answer: latest
        ? `The latest receipt took ${formatMs(latest.durationMs)}. Its productive ratio was ${latest.productiveWorkRatio ?? 'unknown'}, with infrastructure overhead ${formatMs(latest.infrastructureOverheadMs)} and Major overhead ${formatMs(latest.majorOverheadMs)}. Stage timing: ${stages}. Across ${dashboard.history.timeSpent.observedRuns} observed runs, accumulated infrastructure overhead is ${formatMs(dashboard.history.overhead.infrastructureOverheadMs)}.`
        : 'No durable run receipt exists for this project yet. Major will record stage timing, useful work, infrastructure overhead and productive ratio after the next significant run.',
      dashboard,
    };
  }
  if (lower.includes('skill')) {
    const selected = dashboard.skills.selected.map((skill) => skill.id).join(', ') || 'none';
    const observed = dashboard.history.skillPerformance
      .map((skill) => `${skill.skill}=${skill.effect} (${skill.runs} runs)`)
      .join(', ');
    return {
      answer: `Selected now: ${selected}. Repeated evidence: ${observed || 'none recorded'}. A one-off selection is marked insufficient_evidence and is not promoted as a causal help or hurt claim.`,
      dashboard,
    };
  }
  if (lower.includes('worker') || lower.includes('provider')) {
    const currentWorkers = dashboard.workers
      .map(
        (worker) =>
          `${worker.status} ${worker.host}/${worker.provider}${worker.account ? `/${worker.account}` : ''}`,
      )
      .join(', ');
    return {
      answer: `Current workers: ${currentWorkers || 'none'}. Provider readiness is live state. Best-worker evidence: ${dashboard.history.bestWorker ? `${dashboard.history.bestWorker.worker} (${dashboard.history.bestWorker.runs} runs)` : dashboard.history.bestWorkerEvidence}.`,
      dashboard,
    };
  }
  if (lower.includes('fail')) {
    return {
      answer: `Repeated failures: ${dashboard.history.repeatedFailures.length ? dashboard.history.repeatedFailures.map((failure) => `${failure.signature} (${failure.occurrences}x)`).join(', ') : 'none with at least two observed occurrences'}. Major keeps one-off failures as evidence without turning them into durable policy.`,
      dashboard,
    };
  }
  if (lower.includes('required me') || lower.includes('intervention') || lower.includes('human')) {
    return {
      answer: `Recorded user interventions: ${dashboard.history.humanInterventions.length ? dashboard.history.humanInterventions.join('; ') : 'none in the retained receipts'}. Owner gates remain visible under unresolved questions.`,
      dashboard,
    };
  }
  if (lower.includes('reuse') || lower.includes('before') || lower.includes('happen')) {
    return {
      answer: `Major retains ${dashboard.history.runs} run receipts. Reusable assets: ${dashboard.history.reuse.length ? dashboard.history.reuse.join(', ') : 'none recorded'}. Latest comparable change: ${dashboard.history.latestChange.result}. Recurrence is available in history.recurrence.`,
      dashboard,
    };
  }
  if (
    lower.includes('improve') ||
    lower.includes('latest change') ||
    lower.includes('quality') ||
    lower.includes('performance')
  ) {
    return {
      answer: `Latest comparable change: ${dashboard.history.latestChange.result}. Observed comparison: ${JSON.stringify(dashboard.history.latestChange)} Major reports improvement only when comparable outcome and quality evidence meet the repeated-evidence threshold.`,
      dashboard,
    };
  }
  return {
    answer:
      'This panel is Major’s intelligence surface. It reads the current objective, routing, skills, providers, resources, learning, and durable run history. Use the Major CLI for an execution dispatch.',
    dashboard,
  };
}

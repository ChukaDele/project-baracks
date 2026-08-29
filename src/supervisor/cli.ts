import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { allocateDevPort, listDevPorts } from '../dev/ports.js';
import {
  PROJECT_CLASSES,
  TRUST_LEVELS,
  assertExecutionAllowed,
  clearGlobalStop,
  configureProjectPolicy,
  getProjectPolicy,
  recordIndependentGrade,
  recordShadowGrade,
  requestGlobalStop,
  type ProjectClass,
  type TrustLevel,
} from './policy.js';
import {
  admitGoal,
  applyIndependentCompletionGrade,
  authorizeSessionWorkshop,
  bindGoalToProject,
  claimLiveWorker,
  getGoal,
  gitCommonDir,
  heartbeatLiveWorker,
  reconcileStaleGoalOwnership,
  resolveProject,
  resolveProjectForCwd,
  readSupervisorState,
  startGoal,
  updateGoal,
  WORKER_HOSTS,
  type GoalStatus,
  type WorkerHost,
} from './state.js';
import { assessSupervisorAdmissionRisk } from './worker-report.js';
import { resolveSupervisedWorkshopAuthority } from '../security/supervised-workshop.js';
import { autonomyMetrics } from './autonomy.js';
import { applyIndependentSkillValidation } from '../skills/lifecycle.js';
import { discloseSkills } from '../skills/resolver.js';
import {
  majorStatusOverview,
  runDaemon,
  runForegroundGoal,
  runGoalCycle,
  routeGoalExecution,
  supervisorSnapshot,
} from './runtime.js';
import { tryAcquireRepositoryWriterFence } from './repository-writer-fence.js';
import { runGatewayCommand, runWorker } from './worker.js';
import {
  RESOURCE_KINDS,
  cancelResourceRequest,
  formatResourceTelemetry,
  heartbeatResource,
  reclaimStaleResources,
  releaseResource,
  requestResource,
  resourceSnapshot,
  type ResourceKind,
} from './resources.js';
import { assertRemotePreviewUrl } from '../web/remote-preview.js';
import { redactText } from '../security/redact.js';
import { openDb } from '../db/client.js';
import { getIndependentReviewReceipt } from '../insights/performance-history.js';
import { createDecisionRequest, resolveDecision } from '../domain/decision-service.js';
import {
  decideProviderAction,
  providerActionDigest,
  type ApprovalCategory,
  type ProviderAction,
} from '../security/provider-approval-policy.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
}

function flags(args: string[], name: string): string[] {
  return args.flatMap((value, index) =>
    value === name && args[index + 1] ? [args[index + 1]!] : [],
  );
}

function hasFlag(args: string[], name: string): boolean {
  return args.includes(name);
}

function requireFlag(args: string[], name: string): string {
  const value = flag(args, name);
  if (!value) throw new Error(`missing required ${name}`);
  return value;
}

function validHost(value: string): WorkerHost {
  if (!WORKER_HOSTS.includes(value as WorkerHost)) {
    throw new Error(`unsupported provider: ${value}`);
  }
  return value as WorkerHost;
}

/** An attachment older than this is not trusted as "the current session":
 * long enough to cover a normal working session, short enough that a
 * months-old attachment can't quietly authorize a brand new admission. */
const RECENT_SESSION_MS = 24 * 60 * 60 * 1000;

/** Best-effort recovery of the session id an earlier `session attach`/`hook`
 * call already recorded for this host+project, so an ambient admission call
 * does not need its own separate identity scheme. */
function mostRecentSessionId(
  identity: { host?: WorkerHost; interactionOrigin?: string },
  repoPath: string,
): string | undefined {
  const commonDir = gitCommonDir(resolve(repoPath));
  const now = Date.now();
  const cutoff = now - RECENT_SESSION_MS;
  const match = [...readSupervisorState().sessions].reverse().find((session) => {
    if (!session.sessionId) return false;
    if (
      (identity.host !== undefined && session.host !== identity.host) ||
      (identity.interactionOrigin !== undefined &&
        session.interactionOrigin !== identity.interactionOrigin)
    ) {
      return false;
    }
    if (session.repoPath === undefined) return false;
    const attachedAtMs = Date.parse(session.attachedAt);
    // Fail closed: a malformed/missing timestamp must not read as "always
    // fresh" (NaN < cutoff is false), and a clock-skewed future timestamp
    // must not stay fresh forever either.
    if (!Number.isFinite(attachedAtMs)) return false;
    if (attachedAtMs < cutoff || attachedAtMs > now + 5 * 60 * 1000) return false;
    return (
      resolve(session.repoPath) === resolve(repoPath) ||
      (commonDir !== undefined && gitCommonDir(resolve(session.repoPath)) === commonDir)
    );
  });
  return match?.sessionId;
}

function validProjectClass(value: string): ProjectClass {
  if (!PROJECT_CLASSES.includes(value as ProjectClass)) {
    throw new Error(`unsupported project class: ${value}`);
  }
  return value as ProjectClass;
}

function validTrust(value: string): TrustLevel {
  if (!TRUST_LEVELS.includes(value as TrustLevel)) {
    throw new Error(`unsupported trust level: ${value}`);
  }
  return value as TrustLevel;
}

function validResourceKind(value: string): ResourceKind {
  if (!RESOURCE_KINDS.includes(value as ResourceKind)) {
    throw new Error(`unsupported resource kind: ${value}`);
  }
  return value as ResourceKind;
}

export async function runSupervisorCli(args: string[]): Promise<boolean> {
  const command = args[0];
  if (!command) return false;

  if (command === 'ui') {
    if (hasFlag(args, '--help') || hasFlag(args, '-h')) {
      console.log('major ui [--port <port>]  start the thin local Major intelligence surface');
      return true;
    }
    const portRaw = flag(args, '--port');
    const port = portRaw === undefined ? undefined : Number.parseInt(portRaw, 10);
    if (
      portRaw !== undefined &&
      (port === undefined || !Number.isInteger(port) || port < 0 || port > 65_535)
    ) {
      throw new Error('--port must be an integer from 0 to 65535');
    }
    const { startMajorUi } = await import('../ui/server.js');
    await startMajorUi({ ...(port !== undefined ? { port } : {}) });
    return true;
  }

  if (command === 'stop') {
    requestGlobalStop(flag(args, '--reason') ?? 'manual kill switch');
    console.log('Major global kill switch: ACTIVE');
    console.log('New worker execution is blocked.');
    return true;
  }

  if (command === 'start') {
    clearGlobalStop();
    console.log('Major global kill switch: CLEARED');
    return true;
  }

  if (command === 'autonomy' && args[1] === 'metrics') {
    const project = flag(args, '--project');
    const goals = readSupervisorState().goals.filter(
      (goal) => project === undefined || goal.project === project,
    );
    console.log(JSON.stringify(autonomyMetrics(goals), null, 2));
    return true;
  }

  if (command === 'resource' && args[1] === 'status') {
    const snapshot = resourceSnapshot();
    if (hasFlag(args, '--json')) console.log(JSON.stringify(snapshot, null, 2));
    else console.log(formatResourceTelemetry(snapshot.telemetry));
    return true;
  }

  if (command === 'resource' && args[1] === 'acquire') {
    const ttlMinutes = Number.parseFloat(flag(args, '--ttl-minutes') ?? '');
    const resourceProject = flag(args, '--project');
    const parentLeaseId = flag(args, '--parent');
    const pidRaw = flag(args, '--pid');
    const resourcePid = pidRaw ? Number.parseInt(pidRaw, 10) : undefined;
    if (Number.isFinite(ttlMinutes) && ttlMinutes <= 0) {
      throw new Error('--ttl-minutes must be greater than zero');
    }
    if (resourcePid !== undefined && (!Number.isFinite(resourcePid) || resourcePid <= 0)) {
      throw new Error('--pid must be a positive process id');
    }
    const result = requestResource({
      kind: validResourceKind(requireFlag(args, '--kind')),
      owner: requireFlag(args, '--owner'),
      ...(resourceProject ? { project: resourceProject } : {}),
      ...(parentLeaseId ? { parentLeaseId } : {}),
      ...(resourcePid !== undefined ? { pid: resourcePid } : {}),
      ...(Number.isFinite(ttlMinutes) ? { ttlMs: ttlMinutes * 60 * 1000 } : {}),
    });
    console.log(JSON.stringify(result, null, 2));
    return true;
  }

  if (command === 'resource' && args[1] === 'heartbeat') {
    const lease = heartbeatResource(requireFlag(args, '--lease'), requireFlag(args, '--fence'));
    console.log(JSON.stringify(lease, null, 2));
    return true;
  }

  if (command === 'resource' && args[1] === 'release') {
    const telemetry = releaseResource(requireFlag(args, '--lease'), requireFlag(args, '--fence'));
    if (hasFlag(args, '--json')) console.log(JSON.stringify(telemetry, null, 2));
    else console.log(formatResourceTelemetry(telemetry));
    return true;
  }

  if (command === 'resource' && args[1] === 'reclaim') {
    const result = reclaimStaleResources();
    if (hasFlag(args, '--json')) console.log(JSON.stringify(result, null, 2));
    else {
      console.log(`reclaimed stale leases: ${result.reclaimedLeaseIds.length}`);
      console.log(formatResourceTelemetry(result.telemetry));
    }
    return true;
  }

  if (command === 'resource' && args[1] === 'cancel') {
    const telemetry = cancelResourceRequest(requireFlag(args, '--request'));
    if (hasFlag(args, '--json')) console.log(JSON.stringify(telemetry, null, 2));
    else console.log(formatResourceTelemetry(telemetry));
    return true;
  }

  if (command === 'web' && args[1] === 'preflight') {
    const preview = assertRemotePreviewUrl(requireFlag(args, '--preview-url'));
    const githubUrl = requireFlag(args, '--github-url');
    if (!/^https:\/\/github\.com\/[^/]+\/[^/]+\/?$/.test(githubUrl)) {
      throw new Error(
        `remote web preflight requires a GitHub repository URL, received ${githubUrl}`,
      );
    }
    const productionBranch = flag(args, '--production-branch') ?? 'main';
    if (productionBranch !== 'main')
      throw new Error(
        `remote web preflight requires main as the production branch, received ${productionBranch}`,
      );
    console.log(
      `REMOTE WEB PREFLIGHT: PASS\npreview: ${preview.href}\ngithub: ${githubUrl}\nproduction branch: main`,
    );
    return true;
  }

  if (command === 'dev' && args[1] === 'port') {
    const project = resolveProject(args[2] ?? 'current');
    const assignment = await allocateDevPort({
      project: project.project,
      repoPath: project.repoPath,
      reassign: hasFlag(args, '--reassign'),
    });
    if (hasFlag(args, '--json')) console.log(JSON.stringify(assignment, null, 2));
    else console.log(assignment.port);
    return true;
  }

  if (command === 'dev' && args[1] === 'ports') {
    const assignments = listDevPorts();
    if (hasFlag(args, '--json')) console.log(JSON.stringify(assignments, null, 2));
    else if (assignments.length === 0) console.log('No Major dev ports assigned.');
    else {
      for (const assignment of assignments) {
        console.log(`${assignment.port}\t${assignment.project}\t${assignment.repoPath}`);
      }
    }
    return true;
  }

  if (command === 'project' && args[1] === 'configure') {
    const project = resolveProject(args[2] ?? 'current');
    const projectClass = validProjectClass(requireFlag(args, '--class'));
    const trust = validTrust(requireFlag(args, '--trust'));
    const policy = configureProjectPolicy({
      project: project.project,
      repoPath: project.repoPath,
      projectClass,
      trust,
      ...(hasFlag(args, '--allow-external-writes') ? { allowExternalWrites: true } : {}),
      ...(hasFlag(args, '--allow-paid-spend') ? { allowPaidSpend: true } : {}),
      ...(hasFlag(args, '--owner-approved') ? { ownerApprovedBuild: true } : {}),
    });
    console.log(JSON.stringify(policy, null, 2));
    return true;
  }

  if (command === 'project' && args[1] === 'show') {
    const project = resolveProject(args[2] ?? 'current');
    console.log(JSON.stringify(getProjectPolicy(project.project, project.repoPath), null, 2));
    return true;
  }

  if (command === 'project' && args[1] === 'shadow-grade') {
    const project = resolveProject(args[2] ?? 'current');
    const planner = validHost(requireFlag(args, '--planner'));
    const provider = validHost(requireFlag(args, '--provider'));
    const resultRaw = requireFlag(args, '--result');
    if (resultRaw !== 'pass' && resultRaw !== 'fail') {
      throw new Error(`grade result must be pass or fail, received: ${resultRaw}`);
    }
    const goalId = requireFlag(args, '--goal-id');
    const goal = bindGoalToProject(goalId, project.project, project.repoPath);
    if (!goal) {
      throw new Error(`goal ${goalId} does not belong to project ${project.project}`);
    }
    const gradeState = openDb();
    const policy = recordShadowGrade({
      db: gradeState.db,
      project: project.project,
      repoPath: project.repoPath,
      planner,
      provider,
      providerAccountLabel: requireFlag(args, '--provider-account'),
      reviewExecutionId: requireFlag(args, '--review-execution-id'),
      plannerExecutionId: requireFlag(args, '--planner-execution-id'),
      result: resultRaw,
      evidence: requireFlag(args, '--evidence'),
      goalId,
    });
    gradeState.sqlite.close();
    console.log(JSON.stringify(policy, null, 2));
    return true;
  }

  if (command === 'project' && args[1] === 'grade') {
    const project = resolveProject(args[2] ?? 'current');
    const reviewReceiptId = requireFlag(args, '--review-receipt-id');
    const goalId = requireFlag(args, '--goal-id');
    const goal = bindGoalToProject(goalId, project.project, project.repoPath);
    if (!goal) {
      throw new Error(`goal ${goalId} does not belong to project ${project.project}`);
    }
    if (!goal.lastCoordinator) {
      throw new Error(
        `goal ${goalId} has no recorded builder/coordinator yet; it cannot be independently graded`,
      );
    }
    const evidenceState = openDb();
    const review = getIndependentReviewReceipt(evidenceState.db, reviewReceiptId);
    if (!review || review.project !== project.project || review.goalId !== goalId) {
      throw new Error('grade receipt is not bound to this project and goal');
    }
    const provider = validHost(review.provider);
    const resultRaw = review.verdict;
    const evidence = review.evidence;
    if (!goal.pendingCompletion) {
      throw new Error('project grade requires a current pending completion claim');
    }
    if (!review.reviewedRunId) {
      evidenceState.sqlite.close();
      throw new Error('grade receipt lacks a canonical reviewed execution');
    }
    applyIndependentCompletionGrade({ goalId, receiptId: reviewReceiptId });
    const policy = recordIndependentGrade({
      db: evidenceState.db,
      project: project.project,
      repoPath: project.repoPath,
      provider,
      providerAccountLabel: review.providerAccountLabel ?? 'default',
      reviewExecutionId: review.runId,
      reviewedExecutionId: review.reviewedRunId,
      reviewedProvider: goal.pendingCompletion.coordinator,
      result: resultRaw,
      evidence,
      goalId,
      reviewReceiptId,
    });
    evidenceState.sqlite.close();
    if (resultRaw === 'pass') {
      applyIndependentSkillValidation({
        project: project.project,
        repoPath: project.repoPath,
        goalId,
        provider,
        evidence,
      });
    }
    console.log(JSON.stringify(policy, null, 2));
    return true;
  }

  if (command === 'run' && args[1] && !args.includes('--task')) {
    const projectArg = args[1];
    const goalIdArg = flag(args, '--goal-id');
    const project = resolveProject(projectArg);
    const policy = getProjectPolicy(project.project, project.repoPath);
    const preferredRaw = flag(args, '--coordinator');
    const requestedAutonomy = hasFlag(args, '--autonomous');
    const requiredOperations = [...new Set(flags(args, '--capability'))];
    if (requestedAutonomy && !policy.allowBackground) {
      throw new Error(
        `project ${project.project} is ${policy.projectClass}/${policy.trust}; unattended execution is not allowed`,
      );
    }
    if (
      goalIdArg &&
      (flag(args, '--goal') || preferredRaw || requestedAutonomy || requiredOperations.length > 0)
    ) {
      throw new Error(
        '--goal-id dispatches an already-admitted goal as-is; it cannot be combined with --goal, ' +
          '--coordinator, --autonomous, or --capability, which only take effect when a goal is ' +
          'first created via --goal',
      );
    }
    // --goal-id dispatches an already-admitted goal (e.g. from `goal admit`)
    // as-is: it must not go through startGoal's redefine-on-reuse semantics,
    // which would overwrite the preserved outcome text and reset
    // ownerGate/pendingCompletion/retryImmediately. bindGoalToProject is the
    // existing, already-reviewed way to find a goal and confirm it belongs
    // to this project -- it does still rebind the goal's own project/
    // repoPath/updatedAt fields to the values resolved here (a no-op when
    // they already match, but a real identity move if this is invoked from
    // a different worktree of the same repository than where the goal was
    // admitted).
    const goal = goalIdArg
      ? (() => {
          const bound = bindGoalToProject(goalIdArg, project.project, project.repoPath);
          if (!bound) {
            throw new Error(`goal ${goalIdArg} does not belong to project ${project.project}`);
          }
          return bound;
        })()
      : startGoal({
          project: project.project,
          repoPath: project.repoPath,
          goal: requireFlag(args, '--goal'),
          autonomous: requestedAutonomy,
          admissionRiskAssessment: assessSupervisorAdmissionRisk({
            outcome: requireFlag(args, '--goal'),
            requiredOperations,
            policy,
          }),
          ...(requiredOperations.length > 0 ? { requiredOperations } : {}),
          ...(preferredRaw ? { preferredCoordinator: validHost(preferredRaw) } : {}),
        });
    console.log(`Major goal active: ${goal.id}`);
    console.log(`project: ${goal.project}`);
    console.log(`repo: ${goal.repoPath}`);
    console.log(
      `policy: ${policy.projectClass}/${policy.trust} maxWorkers=${policy.maxWorkers} maxRunMinutes=${policy.maxRunMinutes} ownerApproved=${policy.ownerApprovedBuild ? 'yes' : 'no'}`,
    );
    console.log(`autonomous: ${goal.autonomous ? 'yes' : 'no'}`);

    if (policy.trust === 'observe') {
      if (hasFlag(args, '--foreground') || requestedAutonomy) {
        throw new Error(
          `project ${project.project} is observe-only: Major may persist the goal and propose a shadow plan, but it may not dispatch workers`,
        );
      }
      console.log('mode: SHADOW / OBSERVE');
      console.log(
        `Major will not dispatch workers. In the active agent session, produce a "MAJOR SHADOW PLAN" for this goal, then have a separate review execution grade that plan against the work actually performed. Persist distinct planner/reviewer execution IDs plus provider/account provenance with the grade. Three consecutive passing shadow grades are required before assist mode can be enabled unless the owner explicitly fast-tracks the project to build with --owner-approved.`,
      );
      return true;
    }

    if (hasFlag(args, '--foreground')) {
      console.log(
        'supervisor: running this goal in the foreground until it is done, blocked, or ' +
          `out of eligible capacity (up to ${policy.maxRunMinutes} minutes)`,
      );
      const outcome = await runForegroundGoal(goal.id, { maxRunMinutes: policy.maxRunMinutes });
      console.log(`MAJOR_FOREGROUND_DISPATCH: ${JSON.stringify(outcome)}`);
      if (outcome.hops === 0) {
        console.log(
          'supervisor: no cycle actually ran this call — another Major process already holds ' +
            "this repository's integration-owner lock. Nothing new was dispatched; wait for " +
            'that run to finish rather than treating this call as having done the work.',
        );
      }
    } else if (goal.autonomous) {
      console.log('supervisor: queued for an explicitly started Major daemon');
    } else {
      console.log('supervisor: goal registered; no background work started');
    }
    return true;
  }

  if (command === 'status') {
    const project =
      flag(args, '--project') ?? args.slice(1).find((value) => !value.startsWith('-'));
    if (hasFlag(args, '--json')) {
      const goals = readSupervisorState().goals.filter(
        (goal) => project === undefined || goal.project === project,
      );
      console.log(
        JSON.stringify(
          {
            activeGoalCount: goals.filter(
              (goal) => goal.status === 'active' || goal.status === 'running',
            ).length,
            goals,
            resourceTelemetry: resourceSnapshot().telemetry,
          },
          null,
          2,
        ),
      );
      return true;
    }
    console.log(majorStatusOverview());
    console.log('');
    console.log(supervisorSnapshot(project));
    console.log(formatResourceTelemetry(resourceSnapshot().telemetry));
    return true;
  }

  if (command === 'goal' && args[1] === 'admit') {
    const cwd = resolve(flag(args, '--cwd') ?? process.cwd());
    const hostValue = flag(args, '--host');
    const interactionOrigin = flag(args, '--interaction-origin');
    if (!hostValue && !interactionOrigin) {
      throw new Error('goal admit requires --host for an external host or --interaction-origin');
    }
    const host = hostValue ? validHost(hostValue) : undefined;
    const ownershipIdentity = interactionOrigin ?? host!;
    const outcome = requireFlag(args, '--outcome');
    const project = resolveProjectForCwd(cwd);
    if (!project) {
      console.log(
        JSON.stringify({ admitted: false, reason: `no registered Git project at ${cwd}` }, null, 2),
      );
      return true;
    }
    const policy = getProjectPolicy(project.project, project.repoPath);
    if (policy.trust !== 'build' || !policy.ownerApprovedBuild || policy.allowBackground) {
      console.log(
        JSON.stringify(
          {
            admitted: false,
            reason:
              `${project.project} is ${policy.projectClass}/${policy.trust}; automatic ` +
              'admission requires owner-approved build without background authority',
          },
          null,
          2,
        ),
      );
      return true;
    }
    const sessionId =
      flag(args, '--session-id') ??
      mostRecentSessionId(
        {
          ...(host ? { host } : {}),
          ...(interactionOrigin ? { interactionOrigin } : {}),
        },
        project.repoPath,
      );
    if (!sessionId) {
      throw new Error(
        'goal admit requires --session-id (no matching attached session found; run `major session attach`/`session hook` first)',
      );
    }
    // Create-or-resume, atomically: reuse the existing active goal for this
    // project rather than starting a fresh one for every admitted message,
    // preserving its durable outcome text unless --refine explicitly says
    // the objective itself changed (not merely the latest implementation
    // step). admitGoal() does the find-or-create in one state mutation so
    // two concurrent admissions can never race each other into overwriting
    // one another's outcome.
    const admittedGoal = admitGoal({
      project: project.project,
      repoPath: project.repoPath,
      outcome,
      admissionRiskAssessment: assessSupervisorAdmissionRisk({ outcome, policy }),
      assessPreservedOutcome: (preservedOutcome) =>
        assessSupervisorAdmissionRisk({ outcome: preservedOutcome, policy }),
      ...(host ? { preferredCoordinator: host } : {}),
      refine: hasFlag(args, '--refine'),
    });
    const workerLeases = resourceSnapshot().leases.filter(
      (lease) => lease.kind === 'worker' && lease.project === project.project,
    );
    const ownership = reconcileStaleGoalOwnership({
      goalId: admittedGoal.goal.id,
      project: project.project,
      repoPath: project.repoPath,
      host: ownershipIdentity,
      sessionId,
      hasActiveWorkerLease: workerLeases.length > 0,
    });
    const goal = ownership.goal;
    const claimResult = claimLiveWorker(goal.id, { host: ownershipIdentity, sessionId });
    let authorityExpiresAt: string;
    try {
      authorityExpiresAt = resolveSupervisedWorkshopAuthority(project.repoPath).expiresAt;
    } catch {
      authorityExpiresAt = authorizeSessionWorkshop({
        host: ownershipIdentity,
        cwd: project.repoPath,
        project: project.project,
        repoPath: project.repoPath,
        sessionId,
        expiresAt: new Date(Date.now() + 480 * 60_000).toISOString(),
      }).workshopAuthorization!.expiresAt;
    }
    console.log(
      JSON.stringify(
        {
          admitted: true,
          goalId: goal.id,
          created: admittedGoal.created,
          outcome: goal.goal,
          authority: { status: 'active', expiresAt: authorityExpiresAt },
          ownLiveWork: claimResult.owned,
          liveWorker: claimResult.claim,
          ...(interactionOrigin ? { interactionOrigin } : {}),
          ...(ownership.reconciled
            ? { ownershipReconciled: goal.lastOwnershipReconciliation }
            : {}),
          guidance: claimResult.owned
            ? 'proceed as the current worker for this goal'
            : `another session already holds live work on this goal (${claimResult.claim.host} ` +
              `since ${claimResult.claim.claimedAt}); coordinate before mutating — check git ` +
              'status and avoid parallel edits',
        },
        null,
        2,
      ),
    );
    return true;
  }

  if (command === 'goal' && args[1] === 'heartbeat') {
    const id = requireFlag(args, '--id');
    const host = validHost(requireFlag(args, '--host'));
    const sessionId = requireFlag(args, '--session-id');
    const ok = heartbeatLiveWorker(id, { host, sessionId });
    console.log(JSON.stringify({ heartbeat: ok }, null, 2));
    return true;
  }

  if (command === 'goal' && args[1] === 'report') {
    const id = requireFlag(args, '--id');
    const statusRaw = requireFlag(args, '--status');
    const allowed: GoalStatus[] = ['active', 'blocked', 'failed', 'paused'];
    if (!allowed.includes(statusRaw as GoalStatus)) {
      throw new Error(`invalid goal status: ${statusRaw}`);
    }
    const summary = requireFlag(args, '--summary');
    const ownerGate = flag(args, '--owner-gate');
    const patch: Parameters<typeof updateGoal>[1] = {
      status: statusRaw as GoalStatus,
      lastSummary: redactText(summary).slice(0, 12_000),
      lastFinishedAt: new Date().toISOString(),
      ownerGate: ownerGate ? redactText(ownerGate).slice(0, 4_000) : undefined,
      pendingCompletion: undefined,
      activePid: undefined,
      // An external report supersedes whatever the last automatic cycle left
      // behind; it must not leave a stale immediate-retry flag pointing at a
      // capacity rotation this report just overrode.
      retryImmediately: false,
    };
    updateGoal(id, patch);
    console.log(`goal ${id}: ${statusRaw}`);
    return true;
  }

  // Internal bridge for compositional runtimes. It deliberately accepts no
  // provider override: Major remains the provider/model/account authority.
  if (command === 'goal' && args[1] === 'route-execution') {
    const id = requireFlag(args, '--id');
    const goal = getGoal(id);
    if (!goal) throw new Error(`unknown goal: ${id}`);
    const environment = requireFlag(args, '--environment');
    if (environment !== 'local' && environment !== 'lima') {
      throw new Error(`unsupported native execution environment: ${environment}`);
    }
    const policy = getProjectPolicy(goal.project, goal.repoPath);
    const selection = routeGoalExecution(goal, { eligibleHosts: ['codex'] });
    let resolvedSkills: Array<{ id: string; source: string; content: string }> = [];
    let skillDisclosure: ReturnType<typeof discloseSkills>['metrics'] | undefined;
    let skillResolutionDegraded = false;
    if (selection.kind === 'route') {
      try {
        const disclosure = discloseSkills({ task: goal.goal, cwd: goal.repoPath });
        resolvedSkills = disclosure.bodies.map((skill) => ({
          id: skill.id,
          source: skill.source,
          content: skill.content,
        }));
        skillDisclosure = disclosure.metrics;
      } catch {
        skillResolutionDegraded = true;
      }
    }
    console.log(
      JSON.stringify(
        {
          ...selection,
          maxRunMinutes: policy.maxRunMinutes,
          resolvedSkills,
          skillDisclosure,
          skillResolutionDegraded,
        },
        null,
        2,
      ),
    );
    return true;
  }

  if (command === 'delegate') {
    const provider = validHost(requireFlag(args, '--provider'));
    const cwd = resolve(requireFlag(args, '--cwd'));
    const project = resolveProjectForCwd(cwd);
    if (!project) throw new Error(`cannot delegate outside a registered git project: ${cwd}`);
    const policy = getProjectPolicy(project.project, project.repoPath);
    assertExecutionAllowed(policy);
    const prompt = requireFlag(args, '--prompt');
    const approval = flag(args, '--approval');
    const modelRef = flag(args, '--model');
    let approvalAuthority: {
      decisions: { category: ApprovalCategory; decisionId: string; actionDigest: string }[];
    } = { decisions: [] };
    if (approval) {
      const separator = approval.indexOf('=');
      const category = approval.slice(0, separator) as ApprovalCategory;
      const reference = approval.slice(separator + 1);
      const [decisionId, actionDigest] = reference.split(':');
      const categories: ApprovalCategory[] = [
        'command_execution',
        'dependency_install',
        'external_integration',
        'push',
        'deploy',
      ];
      if (
        separator < 1 ||
        !categories.includes(category) ||
        !decisionId ||
        !/^[a-f0-9]{64}$/.test(actionDigest ?? '')
      ) {
        throw new Error('--approval must be <category>=<DecisionRequest id>:<action digest>');
      }
      approvalAuthority = { decisions: [{ category, decisionId, actionDigest: actionDigest! }] };
    }
    const worktree = flag(args, '--worktree');
    let runCwd = cwd;
    if (worktree) {
      const safe = worktree.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'task';
      const projectName = basename(cwd);
      const root = join(homedir(), '.major', 'worktrees', projectName);
      mkdirSync(root, { recursive: true });
      const stamp = Date.now();
      runCwd = join(root, `${stamp}-${safe}`);
      const branch = `major/${stamp}-${safe}`;
      const git = await runGatewayCommand({
        executable: 'git',
        args: ['worktree', 'add', '-b', branch, runCwd],
        cwd,
        timeoutMs: 5 * 60 * 1000,
        extraAllowedRoots: [root],
      });
      if (git.status !== 'succeeded') {
        throw new Error(
          `worktree setup failed: ${git.stderr || git.stdout || 'unknown git error'}`,
        );
      }
      console.error(`Major worktree: ${runCwd} (${branch})`);
    }
    const writerFence = worktree ? undefined : tryAcquireRepositoryWriterFence(project.repoPath);
    if (!worktree && !writerFence) {
      throw new Error(
        `repository ${project.repoPath} already has an active Major integration owner`,
      );
    }
    try {
      const outcome = await runWorker({
        host: provider,
        cwd: runCwd,
        prompt,
        approvalAuthority,
        ...(writerFence ? { writerFence } : {}),
        ...(modelRef ? { modelRef } : {}),
      });
      process.stdout.write(outcome.stdout);
      if (outcome.stderr) process.stderr.write(outcome.stderr);
      if (outcome.status !== 'succeeded') process.exitCode = 1;
    } finally {
      writerFence?.release();
    }
    return true;
  }

  if (command === 'decision' && args[1] === 'request') {
    const project = resolveProject(flag(args, '--project') ?? 'current');
    const provider = validHost(requireFlag(args, '--provider'));
    const category = requireFlag(args, '--category') as ApprovalCategory;
    const categories: ApprovalCategory[] = [
      'command_execution',
      'dependency_install',
      'external_integration',
      'push',
      'deploy',
    ];
    if (!categories.includes(category))
      throw new Error(`unsupported approval category: ${category}`);
    const minutes = Number.parseInt(flag(args, '--expires-minutes') ?? '30', 10);
    let action: ProviderAction;
    try {
      action = JSON.parse(requireFlag(args, '--action-json')) as ProviderAction;
    } catch {
      throw new Error('--action-json must be the exact JSON action emitted by Major');
    }
    if (!action || typeof action !== 'object' || typeof action.kind !== 'string') {
      throw new Error('--action-json must contain a provider action kind');
    }
    const classified = decideProviderAction({
      host: provider,
      action,
      authority: { decisions: [] },
    });
    if (classified.outcome !== 'approval_required' || classified.category !== category) {
      throw new Error(`action JSON does not require approval category '${category}'`);
    }
    const actionDigest = providerActionDigest(action);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 120) {
      throw new Error('--expires-minutes must be between 1 and 120');
    }
    const opened = openDb();
    try {
      const decision = createDecisionRequest(opened.db, {
        category,
        question: requireFlag(args, '--question'),
        contextJson: JSON.stringify({
          scope: { provider, purpose: `provider-action:${project.project}`, actionDigest },
        }),
        expiresAt: new Date(Date.now() + minutes * 60_000).toISOString(),
      });
      console.log(JSON.stringify({ ...decision, actionDigest }, null, 2));
    } finally {
      opened.sqlite.close();
    }
    return true;
  }

  if (command === 'decision' && args[1] === 'resolve') {
    const status = requireFlag(args, '--status');
    if (status !== 'approved' && status !== 'rejected') {
      throw new Error('--status must be approved or rejected');
    }
    const opened = openDb();
    try {
      const decision = resolveDecision(
        opened.db,
        requireFlag(args, '--id'),
        status,
        flag(args, '--resolution'),
      );
      console.log(JSON.stringify(decision, null, 2));
    } finally {
      opened.sqlite.close();
    }
    return true;
  }

  if (command === 'supervisor' && args[1] === 'cycle') {
    await runGoalCycle(requireFlag(args, '--goal-id'));
    return true;
  }

  if (command === 'supervisor' && args[1] === 'daemon') {
    await runDaemon();
    return true;
  }

  if (command === 'goal' && args[1] === 'show') {
    const goal = getGoal(requireFlag(args, '--id'));
    console.log(goal ? JSON.stringify(goal, null, 2) : 'goal not found');
    return true;
  }

  return false;
}

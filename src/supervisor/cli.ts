import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { allocateDevPort, listDevPorts } from '../dev/ports.js';
import {
  LEARNING_SCOPES,
  LEARNING_SOURCES,
  captureLearning,
  listLearningCandidates,
  type LearningScope,
  type LearningSource,
} from '../learning/candidates.js';
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
  attachSession,
  getGoal,
  resolveProject,
  resolveProjectForCwd,
  startGoal,
  updateGoal,
  WORKER_HOSTS,
  type GoalStatus,
  type WorkerHost,
} from './state.js';
import { runDaemon, runGoalCycle, supervisorSnapshot } from './runtime.js';
import { runGatewayCommand, runWorker } from './worker.js';
import {
  RESOURCE_KINDS,
  cancelResourceRequest,
  formatResourceTelemetry,
  heartbeatResource,
  releaseResource,
  requestResource,
  resourceSnapshot,
  type ResourceKind,
} from './resources.js';
import { assertRemotePreviewUrl } from '../web/remote-preview.js';

function flag(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
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

function validLearningSource(value: string): LearningSource {
  if (!LEARNING_SOURCES.includes(value as LearningSource)) {
    throw new Error(`unsupported learning source: ${value}`);
  }
  return value as LearningSource;
}

function validLearningScope(value: string): LearningScope {
  if (!LEARNING_SCOPES.includes(value as LearningScope)) {
    throw new Error(`unsupported learning scope: ${value}`);
  }
  return value as LearningScope;
}

function validResourceKind(value: string): ResourceKind {
  if (!RESOURCE_KINDS.includes(value as ResourceKind)) {
    throw new Error(`unsupported resource kind: ${value}`);
  }
  return value as ResourceKind;
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return '';
  process.stdin.setEncoding('utf8');
  let text = '';
  for await (const chunk of process.stdin) text += String(chunk);
  return text;
}

export async function runSupervisorCli(args: string[]): Promise<boolean> {
  const command = args[0];
  if (!command) return false;

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
    const lease = heartbeatResource(requireFlag(args, '--lease'));
    console.log(JSON.stringify(lease, null, 2));
    return true;
  }

  if (command === 'resource' && args[1] === 'release') {
    const telemetry = releaseResource(requireFlag(args, '--lease'));
    if (hasFlag(args, '--json')) console.log(JSON.stringify(telemetry, null, 2));
    else console.log(formatResourceTelemetry(telemetry));
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

  if (command === 'learn' && args[1] === 'capture') {
    const project = resolveProject(flag(args, '--project') ?? 'current');
    const candidate = captureLearning({
      source: validLearningSource(requireFlag(args, '--source')),
      summary: requireFlag(args, '--summary'),
      scope: validLearningScope(flag(args, '--scope') ?? 'undecided'),
      project: project.project,
      repoPath: project.repoPath,
      ...(flag(args, '--evidence') ? { evidence: flag(args, '--evidence') } : {}),
    });
    console.log(JSON.stringify(candidate, null, 2));
    return true;
  }

  if (command === 'learn' && args[1] === 'list') {
    const projectArg = flag(args, '--project');
    const project = projectArg ? resolveProject(projectArg).project : undefined;
    const candidates = listLearningCandidates(project);
    if (hasFlag(args, '--json')) console.log(JSON.stringify(candidates, null, 2));
    else if (candidates.length === 0) console.log('No Major learning candidates.');
    else {
      for (const candidate of candidates) {
        console.log(
          `${candidate.occurrences}x\t${candidate.scope}\t${candidate.source}\t${candidate.summary}`,
        );
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
    const goal = getGoal(goalId);
    if (!goal || goal.project !== project.project) {
      throw new Error(`goal ${goalId} does not belong to project ${project.project}`);
    }
    const policy = recordShadowGrade({
      project: project.project,
      repoPath: project.repoPath,
      planner,
      provider,
      result: resultRaw,
      evidence: requireFlag(args, '--evidence'),
      goalId,
    });
    console.log(JSON.stringify(policy, null, 2));
    return true;
  }

  if (command === 'project' && args[1] === 'grade') {
    const project = resolveProject(args[2] ?? 'current');
    const provider = validHost(requireFlag(args, '--provider'));
    const resultRaw = requireFlag(args, '--result');
    if (resultRaw !== 'pass' && resultRaw !== 'fail') {
      throw new Error(`grade result must be pass or fail, received: ${resultRaw}`);
    }
    const goalId = requireFlag(args, '--goal-id');
    const goal = getGoal(goalId);
    if (!goal || goal.project !== project.project) {
      throw new Error(`goal ${goalId} does not belong to project ${project.project}`);
    }
    if (!goal.lastCoordinator) {
      throw new Error(
        `goal ${goalId} has no recorded builder/coordinator yet; it cannot be independently graded`,
      );
    }
    if (goal.lastCoordinator === provider) {
      throw new Error(
        `independent grade refused: ${provider} was the last coordinator for goal ${goalId}`,
      );
    }
    const policy = recordIndependentGrade({
      project: project.project,
      repoPath: project.repoPath,
      provider,
      result: resultRaw,
      evidence: requireFlag(args, '--evidence'),
      goalId,
    });
    console.log(JSON.stringify(policy, null, 2));
    return true;
  }

  if (command === 'run' && args[1] && !args.includes('--task')) {
    const projectArg = args[1];
    const goalText = requireFlag(args, '--goal');
    const project = resolveProject(projectArg);
    const policy = getProjectPolicy(project.project, project.repoPath);
    const preferredRaw = flag(args, '--coordinator');
    const requestedAutonomy = hasFlag(args, '--autonomous');
    if (requestedAutonomy && !policy.allowBackground) {
      throw new Error(
        `project ${project.project} is ${policy.projectClass}/${policy.trust}; unattended execution is not allowed`,
      );
    }
    const goal = startGoal({
      project: project.project,
      repoPath: project.repoPath,
      goal: goalText,
      autonomous: requestedAutonomy,
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
        `Major will not dispatch workers. In the active agent session, produce a "MAJOR SHADOW PLAN" for this goal, then have a different provider grade that plan against the work actually performed. Three consecutive passing shadow grades are required before assist mode can be enabled unless the owner explicitly fast-tracks the project to build with --owner-approved.`,
      );
      return true;
    }

    if (hasFlag(args, '--foreground')) {
      console.log('supervisor: running one visible foreground cycle');
      await runGoalCycle(goal.id);
    } else if (goal.autonomous) {
      console.log('supervisor: queued for an explicitly started Major daemon');
    } else {
      console.log('supervisor: goal registered; no background work started');
    }
    return true;
  }

  if (command === 'status') {
    console.log(supervisorSnapshot(args[1]));
    console.log(formatResourceTelemetry(resourceSnapshot().telemetry));
    return true;
  }

  if (command === 'goal' && args[1] === 'report') {
    const id = requireFlag(args, '--id');
    const statusRaw = requireFlag(args, '--status');
    const allowed: GoalStatus[] = ['active', 'blocked', 'done', 'failed', 'paused', 'running'];
    if (!allowed.includes(statusRaw as GoalStatus)) {
      throw new Error(`invalid goal status: ${statusRaw}`);
    }
    const summary = requireFlag(args, '--summary');
    const ownerGate = flag(args, '--owner-gate');
    const patch: Parameters<typeof updateGoal>[1] = {
      status: statusRaw as GoalStatus,
      lastSummary: summary,
      lastFinishedAt: new Date().toISOString(),
      ownerGate,
    };
    updateGoal(id, patch);
    console.log(`goal ${id}: ${statusRaw}`);
    return true;
  }

  if (command === 'session' && (args[1] === 'attach' || args[1] === 'hook')) {
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
          // Keep defaults; hook context is advisory.
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
    const active = project
      ? supervisorSnapshot(project.project)
      : 'No git project detected in this session.';
    const policy = project ? getProjectPolicy(project.project, project.repoPath) : undefined;
    const resources = formatResourceTelemetry(resourceSnapshot().telemetry);
    console.log(
      `MAJOR CONTROL PLANE: ACTIVE\nhost: ${host}\ncwd: ${resolve(cwd)}\n${policy ? `policy: ${policy.projectClass}/${policy.trust} maxWorkers=${policy.maxWorkers} ownerApproved=${policy.ownerApprovedBuild ? 'yes' : 'no'}\n` : ''}${active}\n\nRESOURCE GUARD\n${resources}\nsubagent depth: 1\nbrowser hard cap: 2\nconcurrent build cap: 1\n\nMajor is the default control plane. Reserve shared capacity before workers, browsers, or builds; queued work must wait. Owner-approved build projects may coordinate normal reversible engineering work immediately; client data remains project-local and destructive/irreversible owner gates still apply.`,
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
    const outcome = await runWorker({ host: provider, cwd: runCwd, prompt });
    process.stdout.write(outcome.stdout);
    if (outcome.stderr) process.stderr.write(outcome.stderr);
    if (outcome.status !== 'succeeded') process.exitCode = 1;
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

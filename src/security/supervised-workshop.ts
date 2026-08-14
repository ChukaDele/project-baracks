import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { getProjectPolicy, globalStopRequested } from '../supervisor/policy.js';
import {
  gitCommonDir,
  majorHome,
  readSupervisorState,
  resolveProjectForCwd,
  type SessionAttachment,
} from '../supervisor/state.js';

export interface SupervisedWorkshopExecutionAuthority {
  readonly kind: 'supervised_workshop';
  readonly attachmentId: string;
  readonly sessionId: string;
  readonly project: string;
  readonly repoPath: string;
  readonly expiresAt: string;
}

const HANDOFF_PROVIDERS = ['claude', 'codex', 'cursor', 'antigravity'] as const;

export function authorizeSupervisedWorkshopCredentialHandoff(input: {
  cwd: string;
  sessionId: string;
  provider: string;
  releaseSha: string;
  destinationInstance: string;
}): SupervisedWorkshopExecutionAuthority {
  if (!HANDOFF_PROVIDERS.includes(input.provider as (typeof HANDOFF_PROVIDERS)[number])) {
    throw new Error(`unsupported Workshop credential provider: ${input.provider}`);
  }
  if (!/^[a-f0-9]{40}$/.test(input.releaseSha)) {
    throw new Error('Workshop credential handoff requires a full release SHA');
  }
  if (input.destinationInstance !== `major-worker-${input.releaseSha.slice(0, 12)}`) {
    throw new Error('Workshop credential handoff destination does not match release SHA');
  }
  const authority = resolveSupervisedWorkshopAuthority(input.cwd);
  if (authority.sessionId !== input.sessionId) {
    throw new Error('Workshop credential handoff session does not match active authority');
  }
  const path = join(majorHome(), 'workshop-audit.jsonl');
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  appendFileSync(
    path,
    `${JSON.stringify({
      event: 'provider-credential-handoff-authorized',
      sessionId: authority.sessionId,
      project: authority.project,
      provider: input.provider,
      releaseSha: input.releaseSha,
      destinationInstance: input.destinationInstance,
      at: new Date().toISOString(),
    })}\n`,
    { mode: 0o600 },
  );
  return authority;
}

function matchesProject(session: SessionAttachment, project: string, repoPath: string): boolean {
  if (session.project !== project || !session.repoPath) return false;
  const expected = gitCommonDir(resolve(repoPath));
  return expected !== undefined && gitCommonDir(resolve(session.repoPath)) === expected;
}

function authorityFrom(session: SessionAttachment): SupervisedWorkshopExecutionAuthority {
  const authorization = session.workshopAuthorization;
  if (!authorization || !session.sessionId || !session.project || !session.repoPath) {
    throw new Error('supervised Workshop session is incomplete');
  }
  return {
    kind: 'supervised_workshop',
    attachmentId: session.id,
    sessionId: session.sessionId,
    project: session.project,
    repoPath: session.repoPath,
    expiresAt: authorization.expiresAt,
  };
}

export function resolveSupervisedWorkshopAuthority(
  cwd: string,
  now: () => Date = () => new Date(),
): SupervisedWorkshopExecutionAuthority {
  if (globalStopRequested()) throw new Error('Major global kill switch is active');
  const project = resolveProjectForCwd(cwd);
  if (!project) throw new Error(`supervised Workshop requires a registered Git project: ${cwd}`);
  const policy = getProjectPolicy(project.project, project.repoPath);
  if (policy.trust !== 'build' || !policy.ownerApprovedBuild || policy.allowBackground) {
    throw new Error(
      `supervised Workshop requires owner-approved build policy without background authority for ${project.project}`,
    );
  }
  const at = now().getTime();
  const session = [...readSupervisorState().sessions]
    .reverse()
    .find(
      (candidate) =>
        candidate.workshopAuthorization?.status === 'active' &&
        Date.parse(candidate.workshopAuthorization.expiresAt) > at &&
        matchesProject(candidate, project.project, project.repoPath),
    );
  if (!session) {
    throw new Error(`no active supervised Workshop session authorizes ${project.project}`);
  }
  return authorityFrom(session);
}

export function assertSupervisedWorkshopAuthority(
  authority: SupervisedWorkshopExecutionAuthority,
  cwd: string,
  now: () => Date = () => new Date(),
): void {
  const current = resolveSupervisedWorkshopAuthority(cwd, now);
  if (
    current.attachmentId !== authority.attachmentId ||
    current.sessionId !== authority.sessionId ||
    current.project !== authority.project ||
    current.repoPath !== authority.repoPath ||
    current.expiresAt !== authority.expiresAt
  ) {
    throw new Error('supervised Workshop authority no longer matches the active session');
  }
}

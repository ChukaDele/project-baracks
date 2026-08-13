import { appendFileSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import type { ExecuteHandle, ProviderEvent } from '../providers/types.js';
import { isCapabilityAvailable } from './capabilities.js';
import { darwinSeatbeltContainment } from './containment.js';
import { ExecutionGateway, type ExecutionPolicyDecision } from './gateway.js';
import { TrustedExecutableRegistry } from './trusted-executables.js';
import { providerReadOnlyRoots } from './provider-access.js';
import { LimaBackend } from '../execution/lima-backend.js';
import { loadLimaExecutionConfig } from '../execution/lima-config.js';
import type { BackendProviderRequest } from '../execution/backend.js';
import type { ApprovalCategory, ProviderApprovalAuthority } from './provider-approval-policy.js';
import { openDb } from '../db/client.js';
import { consumeApprovedDecision, isApprovedDecision } from '../domain/decision-service.js';
import { resolveProjectForCwd } from '../supervisor/state.js';
import { assertActiveResourceLease } from '../supervisor/resources.js';
import { globalStopRequested } from '../supervisor/policy.js';
import {
  admitStagedValidationLease,
  assertStagedValidationCaseRequest,
  assertStagedValidationScope,
  getStagedValidationLease,
  recoverStaleValidationLeases,
  revokeStagedValidationLease,
  settleStagedValidationLease,
  stagedValidationEventsDigest,
  stagedValidationWorkspaceDigest,
  stagedValidationRequestDigest,
  type StagedValidationExecutionAuthority,
} from './staged-validation.js';
import { verifyGithubStagedValidationAuthority } from './github-attestation.js';

class StagedEventQueue implements AsyncIterable<ProviderEvent> {
  private readonly values: ProviderEvent[] = [];
  private readonly waiters: Array<(value: IteratorResult<ProviderEvent>) => void> = [];
  private closed = false;
  push(value: ProviderEvent): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value, done: false });
    else this.values.push(value);
  }
  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ value: undefined, done: true });
  }
  [Symbol.asyncIterator](): AsyncIterator<ProviderEvent> {
    return {
      next: () => {
        const value = this.values.shift();
        if (value) return Promise.resolve({ value, done: false });
        if (this.closed) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export interface MajorGatewayRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  allowedRoots: readonly string[];
  timeoutMs?: number;
  parseLine?: (line: string) => ProviderEvent | null;
  detectRateLimit?: (text: string) => boolean;
  detectExhaustion?: (text: string) => boolean;
  extractSessionRef?: (event: ProviderEvent) => string | undefined;
  extractUsage?: (event: ProviderEvent) => unknown;
  resourceLeaseId?: string;
  /** Product-owned one-use release validation authority. Never set by normal workers. */
  stagedValidationAuthority?: StagedValidationExecutionAuthority;
  providerRequest?: Omit<BackendProviderRequest, 'approvalAuthority'> & {
    approvalAuthority: ProviderApprovalAuthority;
  };
}

export function majorExecutionBackend(configPath?: string): LimaBackend {
  return new LimaBackend(loadLimaExecutionConfig(configPath));
}

export function verifyProviderDecision(input: {
  cwd: string;
  provider: BackendProviderRequest['host'];
  category: ApprovalCategory;
  decisionId: string;
  actionDigest: string;
  consumerId: string;
}): boolean {
  const project = resolveProjectForCwd(input.cwd);
  if (!project) return false;
  const opened = openDb();
  try {
    const approved = isApprovedDecision(opened.db, input.decisionId, {
      category: input.category,
      scope: {
        provider: input.provider,
        purpose: `provider-action:${project.project}`,
        actionDigest: input.actionDigest,
      },
      requireExpiry: true,
      requireUnconsumed: true,
    });
    return approved && consumeApprovedDecision(opened.db, input.decisionId, input.consumerId);
  } finally {
    opened.sqlite.close();
  }
}

/** Fixed, read-only host probe used by the global admission guard on macOS. */
function majorHome(): string {
  return process.env.MAJOR_HOME ? resolve(process.env.MAJOR_HOME) : join(homedir(), '.major');
}

function recordExecution(decision: ExecutionPolicyDecision): void {
  const dir = majorHome();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  appendFileSync(join(dir, 'execution-policy.jsonl'), `${JSON.stringify(decision)}\n`, {
    mode: 0o600,
  });
}

export function trustedExecutableRegistry(executable: string): TrustedExecutableRegistry {
  const registry = new TrustedExecutableRegistry();
  const name = basename(executable);
  const pinnedPath = name === 'git' ? '/usr/bin/git' : join(homedir(), '.local', 'bin', name);
  if (executable.includes('/') && resolve(executable) !== resolve(pinnedPath)) {
    throw new Error(`Major refuses unpinned executable path ${executable}; expected ${pinnedPath}`);
  }
  registry.pin(pinnedPath);
  return registry;
}

/** Production adapter for the single canonical execution gateway. */
export function executeMajorCommand(request: MajorGatewayRequest): ExecuteHandle {
  const executable = basename(request.executable);
  const runtimeHome = majorHome();
  const staged = request.stagedValidationAuthority;
  const backendEnabled =
    (isCapabilityAvailable('live-agent-execution') || Boolean(staged)) && executable !== 'git';
  let admittedStaged = false;
  let stagedExpiresAt: string | undefined;
  let stagedExpectedStatus: 'succeeded' | 'cancelled' | undefined;
  let stagedExecutionConfigPath: string | undefined;
  if (staged) {
    if (globalStopRequested()) throw new Error('Major global kill switch is active');
    if (executable === 'git' || !request.providerRequest) {
      throw new Error('staged validation permits only structured provider execution');
    }
    const digest = stagedValidationRequestDigest({
      executable,
      args: request.args,
      cwd: request.cwd,
      providerRequest: request.providerRequest,
    });
    const opened = openDb();
    try {
      const lease = getStagedValidationLease(opened.db, staged.leaseId);
      const project = resolveProjectForCwd(request.cwd);
      const projectIdentityHash = createHash('sha256')
        .update(project?.project ?? `local:${resolve(request.cwd)}`)
        .digest('hex');
      const projectRootHash = createHash('sha256').update(realpathSync(request.cwd)).digest('hex');
      if (!request.resourceLeaseId || !lease.resourceLeaseId) {
        throw new Error('staged validation requires its exact worker resource lease');
      }
      assertStagedValidationScope(lease, {
        provider: request.providerRequest.host,
        projectIdentityHash,
        projectRootHash,
        requestDigest: digest,
        resourceLeaseId: request.resourceLeaseId,
      });
      assertStagedValidationCaseRequest(opened.db, lease, {
        executable,
        args: request.args,
        cwd: request.cwd,
        providerRequest: request.providerRequest,
      });
      if (
        request.allowedRoots.length !== 1 ||
        realpathSync(request.allowedRoots[0]!) !== realpathSync(request.cwd)
      ) {
        throw new Error('staged validation permits only its fixed workspace root');
      }
      if (staged.requestDigest !== digest) {
        throw new Error('staged validation authority request digest does not match execution');
      }
      const executingRoot = realpathSync(resolve(import.meta.dirname, '..', '..'));
      if (executingRoot !== realpathSync(lease.releaseRoot)) {
        throw new Error('staged validation lease is not bound to the executing runtime');
      }
      const release = JSON.parse(readFileSync(join(executingRoot, 'release.json'), 'utf8')) as {
        repository?: string;
        branch?: string;
        sha?: string;
        treeHash?: string;
        sourceCheckout?: string;
      };
      execFileSync(
        process.execPath,
        [join(executingRoot, 'scripts', 'major-runtime-manifest.mjs'), 'verify', executingRoot],
        { encoding: 'utf8', env: {} },
      );
      const runtimeManifestHash = createHash('sha256')
        .update(readFileSync(join(executingRoot, 'runtime-manifest.json')))
        .digest('hex');
      if (
        release.repository !== lease.releaseRepository ||
        release.branch !== lease.releaseBranch ||
        release.sha !== lease.releaseSha ||
        release.treeHash !== lease.releaseTreeHash ||
        realpathSync(release.sourceCheckout ?? '') !== lease.releaseSourceCheckout ||
        runtimeManifestHash !== lease.releaseManifestHash
      ) {
        throw new Error('executing immutable runtime does not match staged validation lease');
      }
      const liveSha = execFileSync(
        '/usr/bin/git',
        ['-C', lease.releaseSourceCheckout, 'rev-parse', 'HEAD'],
        {
          encoding: 'utf8',
          env: {},
        },
      ).trim();
      const liveBranch = execFileSync(
        '/usr/bin/git',
        ['-C', lease.releaseSourceCheckout, 'rev-parse', '--abbrev-ref', 'HEAD'],
        { encoding: 'utf8', env: {} },
      ).trim();
      const liveTree = execFileSync(
        '/usr/bin/git',
        ['-C', lease.releaseSourceCheckout, 'rev-parse', 'HEAD^{tree}'],
        { encoding: 'utf8', env: {} },
      ).trim();
      const liveStatus = execFileSync(
        '/usr/bin/git',
        ['-C', lease.releaseSourceCheckout, 'status', '--porcelain', '--untracked-files=all'],
        { encoding: 'utf8', env: {} },
      ).trim();
      if (
        liveSha !== lease.releaseSha ||
        liveBranch !== lease.releaseBranch ||
        createHash('sha256').update(liveTree).digest('hex') !== lease.releaseTreeHash ||
        liveStatus !== ''
      ) {
        throw new Error('staged validation release checkout no longer matches its exact binding');
      }
      execFileSync(
        '/bin/bash',
        [
          join(lease.releaseSourceCheckout, 'scripts', 'verify-major-staged-candidate.sh'),
          executingRoot,
        ],
        {
          encoding: 'utf8',
          env: { PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin' },
          timeout: 10 * 60 * 1000,
        },
      );
      const githubAuthority = verifyGithubStagedValidationAuthority({
        releaseSha: lease.releaseSha,
        caseId: lease.caseId as Parameters<
          typeof verifyGithubStagedValidationAuthority
        >[0]['caseId'],
        provider: lease.provider as BackendProviderRequest['host'],
      });
      if (
        githubAuthority.leaseId !== lease.authorityLeaseId ||
        githubAuthority.artifactDigest !== lease.authorityArtifactDigest ||
        githubAuthority.validationNonce !== lease.authorityValidationNonce ||
        githubAuthority.expiresAt !== lease.authorityExpiresAt
      ) {
        throw new Error('staged validation does not match its GitHub authority');
      }
      assertActiveResourceLease({
        leaseId: lease.resourceLeaseId,
        kind: 'worker',
        owner: lease.workerId,
        pid: process.pid,
      });
      admitStagedValidationLease(opened.db, staged);
      admittedStaged = true;
      stagedExpiresAt = lease.expiresAt;
      stagedExpectedStatus = lease.expectedExecutionStatus;
      stagedExecutionConfigPath = join(lease.releaseRoot, 'execution.json');
    } finally {
      opened.sqlite.close();
    }
  }
  const roots = [...new Set(request.allowedRoots.map((root) => resolve(root)))];
  let baseEnv: NodeJS.ProcessEnv = {};
  if (!backendEnabled) {
    const projectKey = createHash('sha256').update(resolve(request.cwd)).digest('hex').slice(0, 24);
    const executionRoot = join(runtimeHome, 'execution', projectKey);
    const runtimeTmp = join(executionRoot, 'tmp');
    const runtimeCache = join(executionRoot, 'cache');
    const runtimeConfig = join(executionRoot, 'config');
    const runtimeData = join(executionRoot, 'data');
    for (const path of [runtimeTmp, runtimeCache, runtimeConfig, runtimeData]) {
      mkdirSync(path, { recursive: true, mode: 0o700 });
    }
    roots.push(executionRoot);
    baseEnv = {
      ...process.env,
      ...(executable === 'git' ? { HOME: executionRoot, GIT_CONFIG_NOSYSTEM: '1' } : {}),
      MAJOR_HOME: runtimeHome,
      TMPDIR: runtimeTmp,
      XDG_CACHE_HOME: runtimeCache,
      XDG_CONFIG_HOME: runtimeConfig,
      XDG_DATA_HOME: runtimeData,
      ...(request.resourceLeaseId ? { MAJOR_RESOURCE_LEASE_ID: request.resourceLeaseId } : {}),
    };
  }
  const trustedExecutables = backendEnabled
    ? executable === 'git'
      ? trustedExecutableRegistry(request.executable)
      : new TrustedExecutableRegistry()
    : new TrustedExecutableRegistry();
  const trusted =
    backendEnabled && executable === 'git'
      ? trustedExecutables.verify(request.executable)
      : undefined;
  const backend = backendEnabled ? majorExecutionBackend(stagedExecutionConfigPath) : undefined;
  const approvalConsumerId = `provider-action-${randomUUID()}`;
  const gateway = new ExecutionGateway({
    allowedRoots: roots,
    ...(trusted
      ? {
          readOnlyRoots: [dirname(trusted.canonicalPath), ...providerReadOnlyRoots(executable)],
        }
      : {}),
    commandPolicy: {
      allowedExecutables: [executable],
      protectedBranches: ['main', 'master'],
    },
    trustedExecutables,
    ...(backend ? { backend } : { containment: darwinSeatbeltContainment() }),
    ...(request.providerRequest
      ? {
          verifyProviderDecision: (category: ApprovalCategory, decisionId: string) =>
            verifyProviderDecision({
              cwd: request.cwd,
              provider: request.providerRequest!.host,
              category,
              decisionId,
              actionDigest:
                request.providerRequest!.approvalAuthority.decisions.find(
                  (decision) => decision.decisionId === decisionId,
                )?.actionDigest ?? '',
              consumerId: approvalConsumerId,
            }),
        }
      : {}),
    baseEnv,
    envAllowlist: [
      'MAJOR_HOME',
      'MAJOR_RESOURCE_LEASE_ID',
      'CODEX_HOME',
      'CLAUDE_CONFIG_DIR',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_CACHE_HOME',
      'GIT_CONFIG_NOSYSTEM',
    ],
    recordDecision: recordExecution,
  });

  try {
    const handle = gateway.execute({
      executable: request.executable,
      args: request.args,
      cwd: request.cwd,
      ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
      ...(request.parseLine ? { parseLine: request.parseLine } : {}),
      ...(request.detectRateLimit ? { detectRateLimit: request.detectRateLimit } : {}),
      ...(request.detectExhaustion ? { detectExhaustion: request.detectExhaustion } : {}),
      ...(request.extractSessionRef ? { extractSessionRef: request.extractSessionRef } : {}),
      ...(request.extractUsage ? { extractUsage: request.extractUsage } : {}),
      ...(request.resourceLeaseId ? { resourceLeaseId: request.resourceLeaseId } : {}),
      ...(request.providerRequest ? { providerRequest: request.providerRequest } : {}),
      ...(staged ? { executionAuthority: staged } : {}),
    });
    if (!staged) return handle;
    const expiryTimer = setTimeout(
      () => handle.cancel(),
      Math.max(0, Date.parse(stagedExpiresAt!) - Date.now()),
    );
    expiryTimer.unref();
    const stopWatcher = setInterval(() => {
      if (globalStopRequested()) handle.cancel();
      const opened = openDb();
      try {
        const lease = getStagedValidationLease(opened.db, staged.leaseId);
        if (lease.status !== 'running') handle.cancel();
      } catch {
        handle.cancel();
      } finally {
        opened.sqlite.close();
      }
    }, 500);
    stopWatcher.unref();
    const stagedEvents: ProviderEvent[] = [];
    const events = new StagedEventQueue();
    const eventPump = (async () => {
      try {
        for await (const event of handle.events) {
          stagedEvents.push(event);
          events.push(event);
        }
      } finally {
        events.close();
      }
    })();
    const outcome = (async () => {
      try {
        const result = await handle.outcome;
        await eventPump;
        const opened = openDb();
        try {
          settleStagedValidationLease(opened.db, {
            authority: staged,
            status:
              result.status === stagedExpectedStatus && result.cleanup === 'complete'
                ? 'validating'
                : result.status === 'cancelled' || result.status === 'timed_out'
                  ? 'cancelled'
                  : 'failed',
            ...(result.runId ? { runId: result.runId } : {}),
            outcomeReason: `${result.status}; cleanup=${result.cleanup ?? 'unknown'}`,
            evidenceHash: createHash('sha256')
              .update(
                JSON.stringify({
                  status: result.status,
                  runId: result.runId ?? null,
                  errorKind: result.errorKind ?? null,
                  cleanup: result.cleanup ?? null,
                  exitCode: result.exitCode,
                  modelSelection: result.modelSelection ?? null,
                  requestedModel: result.requestedModel ?? null,
                  actualModel: result.actualModel ?? null,
                  sessionEvidence: result.sessionRef ? 'present' : 'absent',
                  usageEvidence: result.usage === undefined ? 'absent' : 'present',
                }),
              )
              .digest('hex'),
            ...(result.sessionRef
              ? {
                  resultSessionRefHash: createHash('sha256')
                    .update(result.sessionRef)
                    .digest('hex'),
                }
              : {}),
            ...(result.actualModel ? { resultModel: result.actualModel } : {}),
            resultEventHash: stagedValidationEventsDigest(stagedEvents),
            resultEventCount: stagedEvents.length,
            resultWorkspaceHash: stagedValidationWorkspaceDigest(request.cwd),
          });
        } finally {
          opened.sqlite.close();
        }
        return result;
      } catch (error) {
        const opened = openDb();
        try {
          recoverStaleValidationLeases(opened.db);
          try {
            revokeStagedValidationLease(
              opened.db,
              staged.leaseId,
              'staged validation failed before durable settlement',
            );
          } catch {
            // Expired or terminal leases remain closed and cannot be revived.
          }
        } finally {
          opened.sqlite.close();
        }
        throw error;
      } finally {
        clearTimeout(expiryTimer);
        clearInterval(stopWatcher);
      }
    })();
    return { events, cancel: () => handle.cancel(), outcome };
  } catch (error) {
    if (staged && admittedStaged) {
      const opened = openDb();
      try {
        revokeStagedValidationLease(
          opened.db,
          staged.leaseId,
          'staged validation admission failed before provider execution',
        );
      } finally {
        opened.sqlite.close();
      }
    }
    throw error;
  }
}

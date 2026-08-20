import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { openDb } from '../db/client.js';
import { createDecisionRequest } from '../domain/decision-service.js';
import { executeMajorCommand } from '../security/major-gateway.js';
import { isCapabilityAvailable } from '../security/capabilities.js';
import { loadLimaExecutionConfig } from '../execution/lima-config.js';
import { redactText } from '../security/redact.js';
import {
  EXHAUSTION_PATTERN,
  providerArgs,
  providerExecutable,
  RATE_LIMIT_PATTERN,
} from '../providers/commands.js';
import { globalStopRequested } from './policy.js';
import {
  heartbeatResource,
  releaseResource,
  requestResource,
  waitForResource,
  type ResourceLease,
} from './resources.js';
import { gitCommonDir, resolveProjectForCwd, type WorkerHost } from './state.js';
import { AMBIGUOUS_WORKER_REPORT_ENVELOPE, preserveWorkerReportEnvelope } from './worker-report.js';
import type { ExecuteOutcome, ProviderEvent } from '../providers/types.js';
import {
  extractProviderSessionRef,
  extractProviderUsage,
  parseProviderEventLine,
} from '../providers/evidence.js';
import type { ProviderApprovalAuthority } from '../security/provider-approval-policy.js';
import type { ApprovalCategory } from '../security/provider-approval-policy.js';
import { resolveSupervisedWorkshopAuthority } from '../security/supervised-workshop.js';
import { hashSourceWorkspaceTree } from '../execution/workspace-transfer.js';

export function captureProviderApprovalRequest(input: {
  cwd: string;
  host: WorkerHost;
  data: unknown;
}): unknown {
  const data = input.data as {
    outcome?: string;
    category?: ApprovalCategory;
    actionDigest?: string;
  };
  if (
    data.outcome !== 'approval_required' ||
    !data.category ||
    !/^[a-f0-9]{64}$/.test(data.actionDigest ?? '')
  ) {
    return input.data;
  }
  const project = resolveProjectForCwd(input.cwd);
  if (!project) return input.data;
  const opened = openDb();
  try {
    const request = createDecisionRequest(opened.db, {
      category: data.category,
      question: `Allow this exact ${data.category} action for ${input.host}?`,
      contextJson: JSON.stringify({
        scope: {
          provider: input.host,
          purpose: `provider-action:${project.project}`,
          actionDigest: data.actionDigest,
        },
      }),
      expiresAt: new Date(Date.now() + 30 * 60 * 1000).toISOString(),
    });
    return { ...data, decisionId: request.id };
  } finally {
    opened.sqlite.close();
  }
}

export interface WorkerOutcome {
  host: WorkerHost;
  status: 'succeeded' | 'failed' | 'timed_out';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  rateLimited: boolean;
  exhausted: boolean;
  runId?: string;
  errorKind?: ExecuteOutcome['errorKind'];
  cleanup?: ExecuteOutcome['cleanup'];
  workspaceMutated?: boolean;
  sessionRef?: string;
  usage?: unknown;
  modelSelection?: ExecuteOutcome['modelSelection'];
  requestedModel?: string;
  actualModel?: string;
}

export interface GatewayCommandOutcome {
  status: 'succeeded' | 'failed' | 'timed_out';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  rateLimited: boolean;
  exhausted: boolean;
  runId?: string;
  errorKind?: ExecuteOutcome['errorKind'];
  cleanup?: ExecuteOutcome['cleanup'];
  workspaceMutated?: boolean;
  sessionRef?: string;
  usage?: unknown;
  modelSelection?: ExecuteOutcome['modelSelection'];
  requestedModel?: string;
  actualModel?: string;
}

const OUTPUT_LIMIT = 200_000;

export function workerCommand(
  host: WorkerHost,
  prompt: string,
  modelRef?: string,
  resumeSessionRef?: string,
): { command: string; args: string[] } {
  return {
    command: providerExecutable(host),
    args: providerArgs(host, {
      prompt,
      modelRef,
      outputMode: 'batch',
      ...(resumeSessionRef ? { resumeSessionRef } : {}),
    }),
  };
}

function appendLimited(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  return next.length <= OUTPUT_LIMIT ? next : next.slice(next.length - OUTPUT_LIMIT);
}

function trustedExecutableInstalled(name: string): boolean {
  return existsSync(join(homedir(), '.local', 'bin', name));
}

export function hostAvailable(host: WorkerHost): boolean {
  const executable = workerCommand(host, '').command;
  if (isCapabilityAvailable('live-agent-execution')) {
    try {
      return existsSync(loadLimaExecutionConfig().limactlPath);
    } catch {
      return false;
    }
  }
  return executable.includes('/') ? existsSync(executable) : trustedExecutableInstalled(executable);
}

export function gatewayAllowedRoots(
  cwd: string,
  extraAllowedRoots: readonly string[] = [],
): string[] {
  const root = resolve(cwd);
  const commonDir = gitCommonDir(root);
  return [
    ...new Set([
      root,
      ...(commonDir ? [commonDir] : []),
      ...extraAllowedRoots.map((allowedRoot) => resolve(allowedRoot)),
    ]),
  ];
}

export async function runGatewayCommand(input: {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
  extraAllowedRoots?: readonly string[];
  resourceLeaseId?: string;
  resourceLeaseTtlMs?: number;
  providerRequest?: {
    host: WorkerHost;
    prompt: string;
    allowGuestMutation: boolean;
    workspaceHash?: string;
    approvalAuthority: ProviderApprovalAuthority;
    modelRef?: string;
    resumeSessionRef?: string;
    accountLabel?: string;
  };
}): Promise<GatewayCommandOutcome> {
  const started = Date.now();
  let stdout = '';
  let reportEnvelope = '';
  let reportEnvelopeCount = 0;
  try {
    if (globalStopRequested()) throw new Error('Major global kill switch is active');
    const handle = executeMajorCommand({
      executable: input.executable,
      args: input.args,
      cwd: resolve(input.cwd),
      allowedRoots: gatewayAllowedRoots(input.cwd, input.extraAllowedRoots),
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.resourceLeaseId ? { resourceLeaseId: input.resourceLeaseId } : {}),
      ...(input.providerRequest ? { providerRequest: input.providerRequest } : {}),
      parseLine: parseProviderEventLine,
      detectRateLimit: (value) => RATE_LIMIT_PATTERN.test(value),
      detectExhaustion: (value) => EXHAUSTION_PATTERN.test(value),
      ...(input.providerRequest
        ? {
            extractSessionRef: (event: ProviderEvent) =>
              extractProviderSessionRef(input.providerRequest!.host, event),
            extractUsage: extractProviderUsage,
          }
        : {}),
    });

    const stopWatcher = setInterval(() => {
      if (globalStopRequested()) handle.cancel();
    }, 1_000);
    stopWatcher.unref();
    const leaseHeartbeat =
      input.resourceLeaseId && input.resourceLeaseTtlMs
        ? setInterval(
            () => {
              try {
                heartbeatResource(input.resourceLeaseId!, input.resourceLeaseTtlMs);
              } catch {
                handle.cancel();
              }
            },
            5 * 60 * 1000,
          )
        : undefined;
    leaseHeartbeat?.unref();

    try {
      for await (const event of handle.events) {
        if (event.type === 'approval-decision' && input.providerRequest) {
          event.data = captureProviderApprovalRequest({
            cwd: input.cwd,
            host: input.providerRequest.host,
            data: event.data,
          });
        }
        const raw = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
        const preserved = preserveWorkerReportEnvelope(raw);
        if (preserved) {
          reportEnvelopeCount += 1;
          reportEnvelope = preserved;
        }
        stdout = appendLimited(stdout, `${redactText(raw)}\n`);
      }
      const outcome = await handle.outcome;
      return {
        status:
          outcome.status === 'succeeded'
            ? 'succeeded'
            : outcome.status === 'timed_out'
              ? 'timed_out'
              : 'failed',
        exitCode: outcome.exitCode,
        stdout:
          reportEnvelopeCount === 0
            ? stdout
            : appendLimited(
                stdout,
                `${reportEnvelopeCount === 1 ? reportEnvelope : AMBIGUOUS_WORKER_REPORT_ENVELOPE}\n`,
              ),
        stderr:
          outcome.stderrTail ??
          (globalStopRequested() ? 'Major global kill switch cancelled execution.' : ''),
        durationMs: Date.now() - started,
        rateLimited: outcome.rateLimited,
        exhausted: outcome.exhausted,
        ...(outcome.runId ? { runId: outcome.runId } : {}),
        ...(outcome.errorKind ? { errorKind: outcome.errorKind } : {}),
        ...(outcome.cleanup ? { cleanup: outcome.cleanup } : {}),
        ...(outcome.workspaceMutated !== undefined
          ? { workspaceMutated: outcome.workspaceMutated }
          : {}),
        ...(outcome.sessionRef ? { sessionRef: outcome.sessionRef } : {}),
        ...(outcome.usage !== undefined ? { usage: outcome.usage } : {}),
        ...(outcome.modelSelection ? { modelSelection: outcome.modelSelection } : {}),
        ...(outcome.requestedModel ? { requestedModel: outcome.requestedModel } : {}),
        ...(outcome.actualModel ? { actualModel: outcome.actualModel } : {}),
      };
    } finally {
      clearInterval(stopWatcher);
      if (leaseHeartbeat) clearInterval(leaseHeartbeat);
    }
  } catch (error) {
    return {
      status: 'failed',
      exitCode: null,
      stdout:
        reportEnvelopeCount === 0
          ? stdout
          : appendLimited(
              stdout,
              `${reportEnvelopeCount === 1 ? reportEnvelope : AMBIGUOUS_WORKER_REPORT_ENVELOPE}\n`,
            ),
      stderr: redactText(error instanceof Error ? error.message : String(error)),
      durationMs: Date.now() - started,
      rateLimited: false,
      exhausted: false,
    };
  }
}

export async function runWorker(input: {
  host: WorkerHost;
  prompt: string;
  cwd: string;
  timeoutMs?: number;
  modelRef?: string;
  accountLabel?: string;
  resumeSessionRef?: string;
  approvalAuthority?: ProviderApprovalAuthority;
}): Promise<WorkerOutcome> {
  const started = Date.now();
  const leaseTtlMs = Math.max(input.timeoutMs ?? 0, 30 * 60 * 1000) + 5 * 60 * 1000;
  const request = requestResource({
    kind: 'worker',
    owner: `major:${input.host}:${process.pid}:${randomUUID()}`,
    project: basename(resolve(input.cwd)),
    pid: process.pid,
    ttlMs: leaseTtlMs,
  });
  if (request.status === 'rejected') {
    return {
      host: input.host,
      status: 'failed',
      exitCode: null,
      stdout: '',
      stderr: `Major resource guard refused worker: ${request.reason}`,
      durationMs: Date.now() - started,
      rateLimited: false,
      exhausted: false,
    };
  }

  let lease: ResourceLease | undefined;
  try {
    lease =
      request.status === 'active'
        ? request.lease
        : await waitForResource(request.request, input.timeoutMs);
    const spec = workerCommand(input.host, input.prompt, input.modelRef, input.resumeSessionRef);
    const allowGuestMutation = allowGuestMutationForHost(input.host, input.cwd);
    const workspaceHash = mutationWorkspaceHashForHost(input.host, input.cwd, allowGuestMutation);
    const outcome = await runGatewayCommand({
      executable: spec.command,
      args: spec.args,
      cwd: input.cwd,
      resourceLeaseId: lease.id,
      resourceLeaseTtlMs: leaseTtlMs,
      providerRequest: {
        host: input.host,
        prompt: input.prompt,
        allowGuestMutation,
        ...(workspaceHash ? { workspaceHash } : {}),
        // Batch CLI providers expose no per-tool approval callback. Ordinary
        // worker runs therefore carry no sensitive-action authority.
        approvalAuthority: input.approvalAuthority ?? { decisions: [] },
        ...(input.modelRef ? { modelRef: input.modelRef } : {}),
        ...(input.accountLabel ? { accountLabel: input.accountLabel } : {}),
        ...(input.resumeSessionRef ? { resumeSessionRef: input.resumeSessionRef } : {}),
      },
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });
    return { host: input.host, ...outcome };
  } catch (error) {
    return {
      host: input.host,
      status: 'failed',
      exitCode: null,
      stdout: '',
      stderr: redactText(error instanceof Error ? error.message : String(error)),
      durationMs: Date.now() - started,
      rateLimited: false,
      exhausted: false,
    };
  } finally {
    if (lease) releaseResource(lease.id);
  }
}

export function allowGuestMutationForHost(host: WorkerHost, cwd: string): boolean {
  if (host === 'claude' || host === 'cursor') return true;
  if (host !== 'codex') return false;
  try {
    resolveSupervisedWorkshopAuthority(cwd);
    return true;
  } catch {
    return false;
  }
}

/** Only Codex needs the new source digest because its mutation authority is
 * conditional on the live Workshop. Claude and Cursor retain their existing
 * Lima mutation path without a new synchronous full-tree traversal. */
export function mutationWorkspaceHashForHost(
  host: WorkerHost,
  cwd: string,
  allowGuestMutation: boolean,
): string | undefined {
  return host === 'codex' && allowGuestMutation ? hashSourceWorkspaceTree(cwd) : undefined;
}

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { executeMajorCommand } from '../security/major-gateway.js';
import { globalStopRequested } from './policy.js';
import {
  releaseResource,
  requestResource,
  waitForResource,
  type ResourceLease,
} from './resources.js';
import type { WorkerHost } from './state.js';

export interface WorkerOutcome {
  host: WorkerHost;
  status: 'succeeded' | 'failed' | 'timed_out';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  rateLimited: boolean;
  exhausted: boolean;
}

export interface GatewayCommandOutcome {
  status: 'succeeded' | 'failed' | 'timed_out';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  rateLimited: boolean;
  exhausted: boolean;
}

const OUTPUT_LIMIT = 200_000;

export function workerCommand(
  host: WorkerHost,
  prompt: string,
  modelRef?: string,
): { command: string; args: string[] } {
  switch (host) {
    case 'claude': {
      const permissionMode = process.env.MAJOR_CLAUDE_PERMISSION_MODE ?? 'auto';
      const args = [
        '-p',
        prompt,
        '--output-format',
        'json',
        '--max-turns',
        '80',
        '--permission-mode',
        permissionMode,
      ];
      if (modelRef && modelRef !== 'auto') args.push('--model', modelRef);
      return {
        command: 'claude',
        args,
      };
    }
    case 'codex': {
      const args = ['exec', '--json'];
      if (modelRef && modelRef !== 'auto') args.push('--model', modelRef);
      args.push(prompt);
      return { command: 'codex', args };
    }
    case 'cursor': {
      const args = ['-p', '--force', '--output-format', 'json'];
      if (modelRef && modelRef !== 'auto') args.push('--model', modelRef);
      args.push(prompt);
      return { command: 'cursor-agent', args };
    }
    case 'antigravity': {
      const args: string[] = [];
      if (modelRef && modelRef !== 'auto') args.push('--model', modelRef);
      args.push('-p', prompt);
      return { command: 'agy', args };
    }
  }
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
  return executable.includes('/') ? existsSync(executable) : trustedExecutableInstalled(executable);
}

export async function runGatewayCommand(input: {
  executable: string;
  args: readonly string[];
  cwd: string;
  timeoutMs?: number;
  extraAllowedRoots?: readonly string[];
  resourceLeaseId?: string;
}): Promise<GatewayCommandOutcome> {
  const started = Date.now();
  let stdout = '';
  try {
    if (globalStopRequested()) throw new Error('Major global kill switch is active');
    const handle = executeMajorCommand({
      executable: input.executable,
      args: input.args,
      cwd: resolve(input.cwd),
      allowedRoots: [resolve(input.cwd), ...(input.extraAllowedRoots ?? [])],
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.resourceLeaseId ? { resourceLeaseId: input.resourceLeaseId } : {}),
      parseLine: (line) => ({ type: 'stdout', data: line }),
      detectRateLimit: (value) =>
        /rate.?limit|overloaded|429|too many requests|slow down/i.test(value),
      detectExhaustion: (value) =>
        /usage limit|quota exceeded|out of credits|allowance|plan limit/i.test(value),
    });

    const stopWatcher = setInterval(() => {
      if (globalStopRequested()) handle.cancel();
    }, 1_000);
    stopWatcher.unref();

    try {
      for await (const event of handle.events) {
        const text = typeof event.data === 'string' ? event.data : JSON.stringify(event.data);
        stdout = appendLimited(stdout, `${text}\n`);
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
        stdout,
        stderr:
          outcome.stderrTail ??
          (globalStopRequested() ? 'Major global kill switch cancelled execution.' : ''),
        durationMs: Date.now() - started,
        rateLimited: outcome.rateLimited,
        exhausted: outcome.exhausted,
      };
    } finally {
      clearInterval(stopWatcher);
    }
  } catch (error) {
    return {
      status: 'failed',
      exitCode: null,
      stdout,
      stderr: error instanceof Error ? error.message : String(error),
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
}): Promise<WorkerOutcome> {
  const started = Date.now();
  const request = requestResource({
    kind: 'worker',
    owner: `major:${input.host}:${process.pid}:${randomUUID()}`,
    project: basename(resolve(input.cwd)),
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
    const spec = workerCommand(input.host, input.prompt, input.modelRef);
    const outcome = await runGatewayCommand({
      executable: spec.command,
      args: spec.args,
      cwd: input.cwd,
      resourceLeaseId: lease.id,
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
    });
    return { host: input.host, ...outcome };
  } catch (error) {
    return {
      host: input.host,
      status: 'failed',
      exitCode: null,
      stdout: '',
      stderr: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
      rateLimited: false,
      exhausted: false,
    };
  } finally {
    if (lease) releaseResource(lease.id);
  }
}

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
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
}

export interface GatewayCommandOutcome {
  status: 'succeeded' | 'failed' | 'timed_out';
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
}

const OUTPUT_LIMIT = 200_000;

function majorRepoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
}

function commandFor(host: WorkerHost, prompt: string): { command: string; args: string[] } {
  switch (host) {
    case 'claude': {
      const permissionMode = process.env.MAJOR_CLAUDE_PERMISSION_MODE ?? 'auto';
      return {
        command: 'claude',
        args: [
          '-p',
          prompt,
          '--output-format',
          'json',
          '--max-turns',
          '80',
          '--permission-mode',
          permissionMode,
        ],
      };
    }
    case 'codex':
      return { command: 'codex', args: ['exec', '--json', prompt] };
    case 'cursor':
      return {
        command: 'cursor-agent',
        args: ['-p', '--force', '--output-format', 'json', prompt],
      };
    case 'antigravity': {
      const python = join(homedir(), '.major', 'antigravity-venv', 'bin', 'python');
      const helper = join(majorRepoRoot(), 'scripts', 'major-antigravity-worker.py');
      return { command: python, args: [helper, '--prompt', prompt] };
    }
  }
}

function appendLimited(current: string, chunk: string): string {
  const next = `${current}${chunk}`;
  return next.length <= OUTPUT_LIMIT ? next : next.slice(next.length - OUTPUT_LIMIT);
}

function executableOnPath(name: string): boolean {
  const path = process.env.PATH ?? '';
  return path.split(':').some((part) => existsSync(join(part, name)));
}

export function hostAvailable(host: WorkerHost): boolean {
  if (host === 'antigravity') {
    return existsSync(join(homedir(), '.major', 'antigravity-venv', 'bin', 'python'));
  }
  const executable = commandFor(host, '').command;
  return executable.includes('/') ? existsSync(executable) : executableOnPath(executable);
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
      allowedRoots: [
        resolve(input.cwd),
        majorRepoRoot(),
        join(homedir(), '.major'),
        ...(input.extraAllowedRoots ?? []),
      ],
      ...(input.timeoutMs !== undefined ? { timeoutMs: input.timeoutMs } : {}),
      ...(input.resourceLeaseId ? { resourceLeaseId: input.resourceLeaseId } : {}),
      parseLine: (line) => ({ type: 'stdout', data: line }),
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
    };
  }
}

export async function runWorker(input: {
  host: WorkerHost;
  prompt: string;
  cwd: string;
  timeoutMs?: number;
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
    };
  }

  let lease: ResourceLease | undefined;
  try {
    lease =
      request.status === 'active'
        ? request.lease
        : await waitForResource(request.request, input.timeoutMs);
    const spec = commandFor(input.host, input.prompt);
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
    };
  } finally {
    if (lease) releaseResource(lease.id);
  }
}

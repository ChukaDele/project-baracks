import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { WorkerHost } from './state.js';

export interface WorkerOutcome {
  host: WorkerHost;
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
    case 'claude':
      return {
        command: 'claude',
        args: ['-p', prompt, '--output-format', 'json', '--max-turns', '80', '--permission-mode', 'dontAsk'],
      };
    case 'codex':
      return { command: 'codex', args: ['exec', '--json', prompt] };
    case 'cursor':
      return { command: 'cursor-agent', args: ['-p', '--output-format', 'json', '-f', prompt] };
    case 'antigravity': {
      const python = join(homedir(), '.major', 'antigravity-venv', 'bin', 'python');
      const helper = join(majorRepoRoot(), 'scripts', 'major-antigravity-worker.py');
      return { command: python, args: [helper, '--prompt', prompt] };
    }
  }
}

function appendLimited(current: string, chunk: Buffer): string {
  const next = `${current}${chunk.toString('utf8')}`;
  return next.length <= OUTPUT_LIMIT ? next : next.slice(next.length - OUTPUT_LIMIT);
}

export function hostAvailable(host: WorkerHost): boolean {
  if (host === 'antigravity') {
    return existsSync(join(homedir(), '.major', 'antigravity-venv', 'bin', 'python'));
  }
  const executable = commandFor(host, '').command;
  const path = process.env.PATH ?? '';
  return path.split(':').some((part) => existsSync(join(part, executable)));
}

export async function runWorker(input: {
  host: WorkerHost;
  prompt: string;
  cwd: string;
  timeoutMs?: number;
}): Promise<WorkerOutcome> {
  const started = Date.now();
  const spec = commandFor(input.host, input.prompt);
  if (spec.command.includes('/') && !existsSync(spec.command)) {
    return {
      host: input.host,
      status: 'failed',
      exitCode: null,
      stdout: '',
      stderr: `worker runtime not installed: ${spec.command}`,
      durationMs: Date.now() - started,
    };
  }

  return new Promise((resolveOutcome) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const child = spawn(spec.command, spec.args, {
      cwd: resolve(input.cwd),
      env: process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    child.stdout.on('data', (chunk: Buffer) => {
      stdout = appendLimited(stdout, chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = appendLimited(stderr, chunk);
    });
    child.on('error', (error) => {
      stderr = appendLimited(stderr, Buffer.from(error.message));
    });
    const timeoutMs = input.timeoutMs ?? 45 * 60 * 1000;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => child.kill('SIGKILL'), 5_000).unref();
    }, timeoutMs);
    timer.unref();
    child.on('close', (exitCode) => {
      clearTimeout(timer);
      resolveOutcome({
        host: input.host,
        status: timedOut ? 'timed_out' : exitCode === 0 ? 'succeeded' : 'failed',
        exitCode,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    });
  });
}

import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { assertCapabilityAvailable } from '../security/capabilities.js';
import { assertWithinRoots } from '../security/paths.js';
import { redactText } from '../security/redact.js';
import type { ExecuteHandle, ExecuteOutcome, ProviderEvent } from './types.js';

/** Minimal async queue bridging child-process events to an AsyncIterable. */
class EventQueue<T> implements AsyncIterable<T> {
  private buffer: T[] = [];
  private waiters: ((r: IteratorResult<T>) => void)[] = [];
  private closed = false;

  push(item: T): void {
    if (this.closed) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ value: item, done: false });
    else this.buffer.push(item);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ value: undefined as never, done: true });
    }
  }

  [Symbol.asyncIterator](): AsyncIterator<T> {
    return {
      next: (): Promise<IteratorResult<T>> => {
        const item = this.buffer.shift();
        if (item !== undefined) return Promise.resolve({ value: item, done: false });
        if (this.closed) return Promise.resolve({ value: undefined as never, done: true });
        return new Promise((resolve) => this.waiters.push(resolve));
      },
    };
  }
}

export interface StreamingSpawnSpec {
  executable: string;
  args: string[];
  cwd: string;
  /**
   * Exact child environment. Mandatory: children never inherit the parent
   * environment implicitly — callers must pass a sanitised env (the
   * execution gateway builds one via src/security/env.ts).
   */
  env: Record<string, string>;
  timeoutMs?: number;
  /** When set, cwd must resolve inside one of these roots. */
  allowedRoots?: readonly string[];
  /**
   * Spawn as a process-group leader so the WHOLE descendant tree can be
   * signalled and terminated together (not only the direct child). Set by the
   * execution gateway's process-tree containment.
   */
  detached?: boolean;
  /** Map one stdout line (usually NDJSON) to an event; null skips the line. */
  parseLine?: (line: string) => ProviderEvent | null;
  /** Provider-specific detection over stderr + parsed events. */
  detectRateLimit?: (text: string) => boolean;
  detectExhaustion?: (text: string) => boolean;
  /** Extract a resumable session ref from a parsed event. */
  extractSessionRef?: (event: ProviderEvent) => string | undefined;
  extractUsage?: (event: ProviderEvent) => unknown;
}

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1000;

function defaultParseLine(line: string): ProviderEvent | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as { type?: string };
    return { type: parsed.type ?? 'message', data: parsed };
  } catch {
    return { type: 'raw', data: trimmed };
  }
}

/**
 * QUARANTINED — always refuses. This is the raw streaming spawn engine for
 * agent runs; live agent execution is unavailable in this build, so the gate
 * below throws before any process can be created, unconditionally. The
 * machinery is retained, compiled and type-checked for milestone M1
 * (docs/deferred-security-milestones.md) but is unreachable until then.
 */
export function executeStreaming(spec: StreamingSpawnSpec): ExecuteHandle {
  assertCapabilityAvailable('live-agent-execution');
  if (spec.allowedRoots) assertWithinRoots(spec.cwd, spec.allowedRoots);

  const queue = new EventQueue<ProviderEvent>();
  const parseLine = spec.parseLine ?? defaultParseLine;
  const stderrChunks: string[] = [];
  let sessionRef: string | undefined;
  let usage: unknown;
  let cancelled = false;
  let timedOut = false;

  const detached = spec.detached ?? false;
  const child = spawn(spec.executable, spec.args, {
    cwd: spec.cwd,
    env: spec.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
    // A detached child is its own process-group leader; killing the negative
    // pid then signals the entire group — the whole descendant tree.
    detached,
  });

  // Signal the whole process group when detached, so descendants launched by
  // the agent CLI are terminated too — never just the direct child.
  const signalTree = (signal: NodeJS.Signals) => {
    try {
      if (detached && typeof child.pid === 'number') process.kill(-child.pid, signal);
      else child.kill(signal);
    } catch {
      /* group already gone */
    }
  };
  const killChild = () => {
    signalTree('SIGTERM');
    setTimeout(() => signalTree('SIGKILL'), 5000).unref();
  };

  const timeout = setTimeout(() => {
    timedOut = true;
    killChild();
  }, spec.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  timeout.unref();

  const stdout = createInterface({ input: child.stdout });
  stdout.on('line', (line) => {
    const event = parseLine(line);
    if (!event) return;
    const ref = spec.extractSessionRef?.(event);
    if (ref) sessionRef = ref;
    const eventUsage = spec.extractUsage?.(event);
    if (eventUsage !== undefined) usage = eventUsage;
    queue.push(event);
  });

  child.stderr.on('data', (chunk: Buffer) => {
    stderrChunks.push(chunk.toString('utf8'));
    if (stderrChunks.length > 200) stderrChunks.shift();
  });

  const outcome = new Promise<ExecuteOutcome>((resolve) => {
    const finish = (exitCode: number | null) => {
      clearTimeout(timeout);
      queue.close();
      const stderrText = stderrChunks.join('');
      const status: ExecuteOutcome['status'] = cancelled
        ? 'cancelled'
        : timedOut
          ? 'timed_out'
          : exitCode === 0
            ? 'succeeded'
            : 'failed';
      const result: ExecuteOutcome = {
        status,
        exitCode,
        rateLimited: spec.detectRateLimit?.(stderrText) ?? false,
        exhausted: spec.detectExhaustion?.(stderrText) ?? false,
        stderrTail: redactText(stderrText.slice(-2000)),
      };
      if (sessionRef !== undefined) result.sessionRef = sessionRef;
      if (usage !== undefined) result.usage = usage;
      resolve(result);
    };
    child.on('close', (code) => finish(code));
    child.on('error', () => finish(null));
  });

  return {
    events: queue,
    cancel: () => {
      cancelled = true;
      killChild();
    },
    outcome,
  };
}

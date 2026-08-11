import { appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import type { ExecuteHandle, ProviderEvent } from '../providers/types.js';
import { darwinSeatbeltContainment } from './containment.js';
import { ExecutionGateway, type ExecutionPolicyDecision } from './gateway.js';
import { TrustedExecutableRegistry } from './trusted-executables.js';

export interface MajorGatewayRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  allowedRoots: readonly string[];
  timeoutMs?: number;
  parseLine?: (line: string) => ProviderEvent | null;
  resourceLeaseId?: string;
}

/** Fixed, read-only host probe used by the global admission guard on macOS. */
export function readSystemMemoryAvailablePercent(): number | undefined {
  if (process.platform !== 'darwin') return undefined;
  try {
    const output = execFileSync('/usr/bin/memory_pressure', ['-Q'], {
      encoding: 'utf8',
      timeout: 2_000,
      env: {},
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const match = output.match(/System-wide memory free percentage:\s*(\d+)%/);
    return match?.[1] ? Number.parseInt(match[1], 10) : undefined;
  } catch {
    return undefined;
  }
}

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

function resolveTrustedExecutable(executable: string): TrustedExecutableRegistry {
  const registry = new TrustedExecutableRegistry();
  const name = basename(executable);
  if (executable.includes('/')) {
    registry.trust(name, executable, 'pinned');
    return registry;
  }
  const resolved = registry.resolveForReport(name, process.env.PATH);
  if (!resolved) throw new Error(`Major worker executable not found on PATH: ${name}`);
  registry.trust(name, resolved, 'pinned');
  return registry;
}

/** Production adapter for the single canonical execution gateway. */
export function executeMajorCommand(request: MajorGatewayRequest): ExecuteHandle {
  const executable = basename(request.executable);
  const projectKey = createHash('sha256').update(resolve(request.cwd)).digest('hex').slice(0, 24);
  const runtimeHome = majorHome();
  const executionRoot = join(runtimeHome, 'execution', projectKey);
  const runtimeTmp = join(executionRoot, 'tmp');
  mkdirSync(runtimeTmp, { recursive: true, mode: 0o700 });
  const roots = [...new Set([...request.allowedRoots.map((root) => resolve(root)), executionRoot])];

  const baseEnv: NodeJS.ProcessEnv = {
    ...process.env,
    MAJOR_HOME: runtimeHome,
    TMPDIR: runtimeTmp,
    ...(request.resourceLeaseId ? { MAJOR_RESOURCE_LEASE_ID: request.resourceLeaseId } : {}),
  };
  const gateway = new ExecutionGateway({
    allowedRoots: roots,
    commandPolicy: {
      allowedExecutables: [executable],
      protectedBranches: ['main', 'master'],
    },
    trustedExecutables: resolveTrustedExecutable(request.executable),
    containment: darwinSeatbeltContainment(),
    baseEnv,
    envAllowlist: [
      'MAJOR_HOME',
      'MAJOR_RESOURCE_LEASE_ID',
      'CODEX_HOME',
      'CLAUDE_CONFIG_DIR',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_CACHE_HOME',
    ],
    recordDecision: recordExecution,
  });

  return gateway.execute({
    executable: request.executable,
    args: request.args,
    cwd: request.cwd,
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(request.parseLine ? { parseLine: request.parseLine } : {}),
  });
}

import { appendFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
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
  providerRequest?: BackendProviderRequest;
}

export function majorExecutionBackend(): LimaBackend {
  return new LimaBackend(loadLimaExecutionConfig());
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
  const backendEnabled = isCapabilityAvailable('live-agent-execution') && executable !== 'git';
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
  const trustedExecutables = isCapabilityAvailable('live-agent-execution')
    ? executable === 'git'
      ? trustedExecutableRegistry(request.executable)
      : new TrustedExecutableRegistry()
    : new TrustedExecutableRegistry();
  const trusted =
    isCapabilityAvailable('live-agent-execution') && executable === 'git'
      ? trustedExecutables.verify(request.executable)
      : undefined;
  const backend = backendEnabled ? majorExecutionBackend() : undefined;
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

  return gateway.execute({
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
  });
}

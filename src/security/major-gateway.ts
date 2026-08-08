import { appendFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { executeMajorStreaming } from '../providers/exec.js';
import type { ExecuteHandle, ProviderEvent } from '../providers/types.js';
import { checkArgv } from './commands.js';
import { processTreeContainment } from './containment.js';
import { sanitizeEnv } from './env.js';
import { assertWithinRootsCanonical, canonicalize, isWithinRoots } from './paths.js';
import { TrustedExecutableRegistry } from './trusted-executables.js';

export interface MajorGatewayRequest {
  executable: string;
  args: readonly string[];
  cwd: string;
  allowedRoots: readonly string[];
  timeoutMs?: number;
  parseLine?: (line: string) => ProviderEvent | null;
}

function executableName(executable: string): string {
  return basename(executable);
}

function canonicalRoots(roots: readonly string[]): string[] {
  return roots.flatMap((root) => {
    try {
      return [canonicalize(root)];
    } catch {
      return [resolve(root)];
    }
  });
}

function assertAbsoluteArgumentsContained(args: readonly string[], roots: readonly string[]): void {
  const allowed = canonicalRoots(roots);
  for (const arg of args) {
    if (!isAbsolute(arg)) continue;
    let candidate = resolve(arg);
    try {
      candidate = canonicalize(arg);
    } catch {
      // Non-existent paths such as a new worktree use the lexical absolute path.
    }
    if (!isWithinRoots(candidate, allowed)) {
      throw new Error(`Major execution argument escapes allowed roots: ${arg}`);
    }
  }
}

function resolveTrustedExecutable(executable: string): string {
  const registry = new TrustedExecutableRegistry();
  const name = executableName(executable);
  let spawnPath = executable;
  if (!executable.includes('/')) {
    const resolved = registry.resolveForReport(name, process.env.PATH);
    if (!resolved) throw new Error(`Major worker executable not found on PATH: ${name}`);
    spawnPath = resolved;
  }
  registry.trust(name, spawnPath, 'pinned');
  return registry.verify(executable.includes('/') ? executable : name).spawnPath;
}

function recordExecution(input: {
  executable: string;
  cwd: string;
  allowed: boolean;
  reason: string;
  strippedEnv: readonly string[];
}): void {
  const dir = join(homedir(), '.major');
  mkdirSync(dir, { recursive: true });
  const record = {
    at: new Date().toISOString(),
    executable: input.executable,
    cwd: input.cwd,
    allowed: input.allowed,
    reason: input.reason,
    strippedEnv: input.strippedEnv,
  };
  appendFileSync(join(dir, 'execution-policy.jsonl'), `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/**
 * Major 0.3's successor execution boundary.
 *
 * This intentionally optimizes for the user's chosen MVP/autonomy posture:
 * project/worktree root confinement at the gateway, a strict top-level
 * executable allowlist, no shell command strings, stripped API/secret env,
 * trusted executable identity, and whole-process-tree termination. It does not
 * wait for the old v1 filesystem/network sandbox milestone before allowing
 * normal reversible local development.
 */
export function executeMajorCommand(request: MajorGatewayRequest): ExecuteHandle {
  const cwd = assertWithinRootsCanonical(request.cwd, request.allowedRoots);
  const executable = executableName(request.executable);
  const commandCheck = checkArgv(request.executable, request.args, {
    allowedExecutables: [executable],
    protectedBranches: ['main', 'master'],
  });
  if (!commandCheck.allowed) {
    recordExecution({
      executable,
      cwd,
      allowed: false,
      reason: commandCheck.reason,
      strippedEnv: [],
    });
    throw new Error(`Major execution refused: ${commandCheck.reason}`);
  }

  assertAbsoluteArgumentsContained(request.args, request.allowedRoots);
  const spawnPath = resolveTrustedExecutable(request.executable);
  const sanitized = sanitizeEnv(process.env, {
    allowlist: [
      'MAJOR_HOME',
      'CODEX_HOME',
      'CLAUDE_CONFIG_DIR',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_CACHE_HOME',
    ],
  });
  const containment = processTreeContainment();
  if (!containment.enforced) throw new Error('Major process-tree containment is unavailable');

  recordExecution({
    executable: spawnPath,
    cwd,
    allowed: true,
    reason: containment.mechanism,
    strippedEnv: sanitized.stripped,
  });

  return executeMajorStreaming({
    executable: spawnPath,
    args: [...request.args],
    cwd,
    env: sanitized.env,
    allowedRoots: request.allowedRoots,
    detached: true,
    ...(request.timeoutMs !== undefined ? { timeoutMs: request.timeoutMs } : {}),
    ...(request.parseLine ? { parseLine: request.parseLine } : {}),
  });
}

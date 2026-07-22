import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { executeStreaming } from './exec.js';
import { loadModelRegistry, registryModels, type ModelRegistry } from './registry.js';
import type { ExecuteHandle, ExecuteRequest, ProviderAdapter, ProviderInfo } from './types.js';

const RATE_LIMIT_PATTERN = /rate.?limit|overloaded|429|too many requests/i;
const EXHAUSTION_PATTERN =
  /usage limit|out of credits|allowance (reached|exhausted)|quota exceeded/i;

export function which(executable: string): string | undefined {
  try {
    const out = execFileSync('which', [executable], { encoding: 'utf8' }).trim();
    return out || undefined;
  } catch {
    return undefined;
  }
}

export function cliVersion(executable: string): string | undefined {
  try {
    return execFileSync(executable, ['--version'], { encoding: 'utf8', timeout: 15000 }).trim();
  } catch {
    return undefined;
  }
}

export interface ClaudeCodeOptions {
  executable?: string;
  registry?: ModelRegistry;
  allowedRoots?: readonly string[];
}

export class ClaudeCodeProvider implements ProviderAdapter {
  readonly name = 'claude-code';
  private readonly executable: string;
  private readonly registry: ModelRegistry;
  private readonly allowedRoots: readonly string[] | undefined;

  constructor(options: ClaudeCodeOptions = {}) {
    this.executable = options.executable ?? process.env.MAJOR_CLAUDE_BIN ?? 'claude';
    this.registry = options.registry ?? loadModelRegistry();
    this.allowedRoots = options.allowedRoots;
  }

  async discover(): Promise<ProviderInfo> {
    const resolved = which(this.executable);
    const version = resolved ? cliVersion(resolved) : undefined;
    const installed = Boolean(resolved && version);
    // Heuristic only: Claude Code does not expose a non-interactive auth
    // status command; presence of its state file is a best-effort signal.
    const authenticated = installed ? existsSync(join(homedir(), '.claude.json')) : false;
    const info: ProviderInfo = {
      name: this.name,
      installed,
      authenticated,
      models: registryModels(this.registry, this.name, { visible: installed, authenticated }),
    };
    if (resolved !== undefined) info.executable = resolved;
    if (version !== undefined) info.version = version;
    return info;
  }

  async probe(): Promise<ProviderInfo> {
    // Deliberately identical to discover(): safe, no tokens consumed.
    return this.discover();
  }

  execute(request: ExecuteRequest): ExecuteHandle {
    const args = ['-p', request.prompt, '--output-format', 'stream-json', '--verbose'];
    if (request.modelRef) args.push('--model', request.modelRef);
    if (request.resumeSessionRef) args.push('--resume', request.resumeSessionRef);
    const spec: Parameters<typeof executeStreaming>[0] = {
      executable: which(this.executable) ?? this.executable,
      args,
      cwd: request.cwd,
      detectRateLimit: (text) => RATE_LIMIT_PATTERN.test(text),
      detectExhaustion: (text) => EXHAUSTION_PATTERN.test(text),
      extractSessionRef: (event) => {
        const data = event.data as { session_id?: string } | undefined;
        return data?.session_id;
      },
      extractUsage: (event) => {
        const data = event.data as { type?: string; usage?: unknown } | undefined;
        return data?.type === 'result' ? data.usage : undefined;
      },
    };
    if (request.timeoutMs !== undefined) spec.timeoutMs = request.timeoutMs;
    if (this.allowedRoots !== undefined) spec.allowedRoots = this.allowedRoots;
    return executeStreaming(spec);
  }
}

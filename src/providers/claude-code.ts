import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionGateway } from '../security/gateway.js';
import { loadModelRegistry, registryModels, type ModelRegistry } from './registry.js';
import type { ExecuteHandle, ExecuteRequest, ProviderAdapter, ProviderInfo } from './types.js';

const RATE_LIMIT_PATTERN = /rate.?limit|overloaded|429|too many requests/i;
const EXHAUSTION_PATTERN =
  /usage limit|out of credits|allowance (reached|exhausted)|quota exceeded/i;

export interface ClaudeCodeOptions {
  /** Every spawn — probe or execution — goes through this gateway. */
  gateway: ExecutionGateway;
  executable?: string;
  registry?: ModelRegistry;
}

export class ClaudeCodeProvider implements ProviderAdapter {
  readonly name = 'claude-code';
  private readonly gateway: ExecutionGateway;
  private readonly executable: string;
  private readonly registry: ModelRegistry;

  constructor(options: ClaudeCodeOptions) {
    this.gateway = options.gateway;
    this.executable = options.executable ?? process.env.MAJOR_CLAUDE_BIN ?? 'claude';
    this.registry = options.registry ?? loadModelRegistry();
  }

  async discover(): Promise<ProviderInfo> {
    const resolved = this.gateway.probeSync('which', [this.executable]);
    const version = resolved ? this.gateway.probeSync(resolved, ['--version']) : undefined;
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
    const spec: Parameters<ExecutionGateway['execute']>[0] = {
      executable: this.gateway.probeSync('which', [this.executable]) ?? this.executable,
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
    return this.gateway.execute(spec);
  }
}

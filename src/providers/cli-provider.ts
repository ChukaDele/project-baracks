import type { ExecutionGateway } from '../security/gateway.js';
import { loadModelRegistry, registryModels, type ModelRegistry } from './registry.js';
import type { ExecuteHandle, ExecuteRequest, ProviderAdapter, ProviderInfo } from './types.js';
import { EXHAUSTION_PATTERN, RATE_LIMIT_PATTERN } from './commands.js';

export interface CliProviderOptions {
  name: string;
  executable: string;
  gateway: ExecutionGateway;
  args: (request: ExecuteRequest) => string[];
  registry?: ModelRegistry;
}

/** Shared adapter for provider CLIs whose runtime output can be treated as a
 * streamed line protocol. Discovery remains process-free until M1 opens. */
export class CliProvider implements ProviderAdapter {
  readonly name: string;
  private readonly executable: string;
  private readonly gateway: ExecutionGateway;
  private readonly args: (request: ExecuteRequest) => string[];
  private readonly registry: ModelRegistry;

  constructor(options: CliProviderOptions) {
    this.name = options.name;
    this.executable = options.executable;
    this.gateway = options.gateway;
    this.args = options.args;
    this.registry = options.registry ?? loadModelRegistry();
  }

  async discover(): Promise<ProviderInfo> {
    const resolved = this.gateway.resolveExecutable(this.executable);
    const info: ProviderInfo = {
      name: this.name,
      installed: false,
      authenticated: false,
      executableUnverified: true,
      models: registryModels(this.registry, this.name, { visible: false, authenticated: false }),
    };
    if (resolved !== undefined) info.executable = resolved;
    return info;
  }

  async probe(): Promise<ProviderInfo> {
    return this.discover();
  }

  execute(request: ExecuteRequest): ExecuteHandle {
    const spec: Parameters<ExecutionGateway['execute']>[0] = {
      executable: this.executable,
      args: this.args(request),
      cwd: request.cwd,
      detectRateLimit: (text) => RATE_LIMIT_PATTERN.test(text),
      detectExhaustion: (text) => EXHAUSTION_PATTERN.test(text),
    };
    if (request.timeoutMs !== undefined) spec.timeoutMs = request.timeoutMs;
    return this.gateway.execute(spec);
  }
}

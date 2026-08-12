import type { ExecutionGateway } from '../security/gateway.js';
import { loadModelRegistry, registryModels, type ModelRegistry } from './registry.js';
import type { ExecuteHandle, ExecuteRequest, ProviderAdapter, ProviderInfo } from './types.js';
import { EXHAUSTION_PATTERN, RATE_LIMIT_PATTERN, type ProviderCommandHost } from './commands.js';
import {
  extractProviderSessionRef,
  extractProviderUsage,
  parseProviderEventLine,
} from './evidence.js';

export interface CliProviderOptions {
  name: string;
  host: ProviderCommandHost;
  executable: string;
  gateway: ExecutionGateway;
  args: (request: ExecuteRequest) => string[];
  allowGuestMutation?: boolean;
  registry?: ModelRegistry;
}

/** Shared adapter for provider CLIs whose runtime output can be treated as a
 * streamed line protocol. Discovery remains process-free while M1 is closed. */
export class CliProvider implements ProviderAdapter {
  readonly name: string;
  private readonly executable: string;
  private readonly host: ProviderCommandHost;
  private readonly gateway: ExecutionGateway;
  private readonly args: (request: ExecuteRequest) => string[];
  private readonly registry: ModelRegistry;
  private readonly allowGuestMutation: boolean;

  constructor(options: CliProviderOptions) {
    this.name = options.name;
    this.host = options.host;
    this.executable = options.executable;
    this.gateway = options.gateway;
    this.args = options.args;
    this.registry = options.registry ?? loadModelRegistry();
    this.allowGuestMutation = options.allowGuestMutation ?? false;
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
      providerRequest: {
        host: this.host,
        prompt: request.prompt,
        allowGuestMutation: this.allowGuestMutation,
        approvalAuthority: { approvedCategories: [] },
        ...(request.modelRef ? { modelRef: request.modelRef } : {}),
        ...(request.resumeSessionRef ? { resumeSessionRef: request.resumeSessionRef } : {}),
      },
      detectRateLimit: (text) => RATE_LIMIT_PATTERN.test(text),
      detectExhaustion: (text) => EXHAUSTION_PATTERN.test(text),
      parseLine: parseProviderEventLine,
      extractSessionRef: (event) => extractProviderSessionRef(this.host, event),
      extractUsage: extractProviderUsage,
    };
    if (request.timeoutMs !== undefined) spec.timeoutMs = request.timeoutMs;
    return this.gateway.execute(spec);
  }
}

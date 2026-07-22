import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ExecutionGateway } from '../security/gateway.js';
import { loadModelRegistry, registryModels, type ModelRegistry } from './registry.js';
import type { ExecuteHandle, ExecuteRequest, ProviderAdapter, ProviderInfo } from './types.js';

const RATE_LIMIT_PATTERN = /rate.?limit|429|too many requests|slow down/i;
const EXHAUSTION_PATTERN = /usage limit|quota exceeded|out of credits|plan limit/i;

export interface CodexOptions {
  /** Every spawn — probe or execution — goes through this gateway. */
  gateway: ExecutionGateway;
  executable?: string;
  registry?: ModelRegistry;
}

export class CodexProvider implements ProviderAdapter {
  readonly name = 'codex';
  private readonly gateway: ExecutionGateway;
  private readonly executable: string;
  private readonly registry: ModelRegistry;

  constructor(options: CodexOptions) {
    this.gateway = options.gateway;
    this.executable = options.executable ?? process.env.MAJOR_CODEX_BIN ?? 'codex';
    this.registry = options.registry ?? loadModelRegistry();
  }

  async discover(): Promise<ProviderInfo> {
    // Establish the executable for discovery/reporting: an explicitly
    // configured path is PINNED as the trusted canonical installation (with a
    // stable identity); a bare name is only RESOLVED on PATH for reporting and
    // read-only probes — PATH resolution never confers execution trust. Live
    // execution therefore requires an explicitly pinned installation and is
    // refused for a merely PATH-resolved binary.
    const resolved = this.executable.includes('/')
      ? this.gateway.pinExecutable(this.executable)
      : this.gateway.probeSync('which', [this.executable]);
    const version = resolved ? this.gateway.probeSync(resolved, ['--version']) : undefined;
    const installed = Boolean(resolved && version);
    // Codex stores credentials in ~/.codex/auth.json after `codex login`.
    const authenticated = installed && existsSync(join(homedir(), '.codex', 'auth.json'));
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
    return this.discover();
  }

  execute(request: ExecuteRequest): ExecuteHandle {
    const args = request.resumeSessionRef
      ? ['exec', 'resume', request.resumeSessionRef, '--json', request.prompt]
      : ['exec', '--json', request.prompt];
    if (request.modelRef) args.splice(1, 0, '--model', request.modelRef);
    const spec: Parameters<ExecutionGateway['execute']>[0] = {
      // The gateway resolves this through the trusted-executable registry;
      // an unregistered or shadowed installation is refused at spawn time.
      executable: this.executable,
      args,
      cwd: request.cwd,
      detectRateLimit: (text) => RATE_LIMIT_PATTERN.test(text),
      detectExhaustion: (text) => EXHAUSTION_PATTERN.test(text),
      extractSessionRef: (event) => {
        const data = event.data as
          { session_id?: string; thread_id?: string; msg?: { session_id?: string } } | undefined;
        return data?.session_id ?? data?.thread_id ?? data?.msg?.session_id;
      },
      extractUsage: (event) => {
        const data = event.data as { msg?: { type?: string; info?: unknown } } | undefined;
        return data?.msg?.type === 'token_count' ? data.msg.info : undefined;
      },
    };
    if (request.timeoutMs !== undefined) spec.timeoutMs = request.timeoutMs;
    return this.gateway.execute(spec);
  }
}
